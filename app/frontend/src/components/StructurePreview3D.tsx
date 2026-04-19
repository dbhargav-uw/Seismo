import {
  ContactShadows,
  Edges,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Instance,
  Instances,
  OrbitControls,
} from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ElementRef, type MutableRefObject, type RefObject, useEffect, useMemo, useRef } from 'react';
import type { Mesh, Object3D } from 'three';

import type { StructureSpec } from '../api/types';
import { deriveStructureGeometry } from '../features/structure/geometry';
import { terrainSourceLabel } from '../features/structure/terrain';
import { TerrainMesh } from './TerrainMesh';
import {
  autoExaggeration,
  collapseFailureStoryIdx,
  collapseSettled,
  computeCollapseColumnFrame,
  computeCollapseSlabFrame,
  computeFloorDisplacements,
  interpolateHistoryAt,
  visualSwayPeriodS,
} from '../features/structure/responseShape';
import type {
  ColumnGrid,
  NormalizedStructure,
  SlabInfo,
  StructureEnvelope,
  StructurePalette,
  StructureWarning,
} from '../features/structure/types';
import { isResultStale, useViabilityStore } from '../features/viability/store';

/**
 * Maximum column instances the GPU buffer is sized for.
 * derive() clamps bays to [2, 12] per direction → max columns = (12+1)² = 169.
 * Each column is now rendered as N per-story segments so the column tops can
 * follow the deflected slab shape; worst case = 80 stories × 169 columns =
 * 13,520. 14,000 leaves headroom; ~896 KB GPU buffer at 64 B per matrix.
 */
const MAX_COLUMN_INSTANCES = 14_000;

type ControlsRef = ElementRef<typeof OrbitControls>;

const SYSTEM_LABELS: Record<StructureSpec['system'], string> = {
  concrete_moment_frame: 'Concrete moment frame',
  steel_moment_frame: 'Steel moment frame',
  wood_light_frame: 'Wood light frame',
  masonry: 'Masonry',
};

const tintHex = (hex: string, factor: number): string => {
  const v = (h: string): number =>
    Math.max(0, Math.min(255, Math.round(parseInt(h, 16) * factor)));
  const r = v(hex.slice(1, 3));
  const g = v(hex.slice(3, 5));
  const b = v(hex.slice(5, 7));
  return `rgb(${r}, ${g}, ${b})`;
};

const fmt = (n: number, digits = 1): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

interface CameraRigProps {
  envelope: StructureEnvelope;
  controlsRef: RefObject<ControlsRef | null>;
}

/**
 * Imperatively re-frames the camera + OrbitControls target whenever the
 * normalized envelope changes. The `<Canvas camera={…}>` prop only takes
 * effect at first mount, so we keep that prop static and let this rig
 * handle every subsequent geometry change.
 */
const CameraRig = ({ envelope, controlsRef }: CameraRigProps): null => {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  const targetY = (envelope.height * envelope.bboxScale) / 2;
  const fitDistance = Math.max(40, targetY * 3.5);

  useEffect(() => {
    camera.position.set(fitDistance, fitDistance * 0.85, fitDistance);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, targetY, 0);
      controls.update();
    } else {
      camera.lookAt(0, targetY, 0);
    }
    invalidate();
  }, [camera, controlsRef, fitDistance, targetY, invalidate]);

  return null;
};

const SceneLighting = (): JSX.Element => (
  <>
    <ambientLight intensity={0.55} />
    <directionalLight
      position={[18, 28, 12]}
      intensity={1.05}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-camera-near={1}
      shadow-camera-far={140}
      shadow-camera-left={-40}
      shadow-camera-right={40}
      shadow-camera-top={40}
      shadow-camera-bottom={-40}
    />
    <directionalLight position={[-20, 22, -14]} intensity={0.35} />
  </>
);

interface SlabsProps {
  slabs: SlabInfo[];
  envelope: StructureEnvelope;
  palette: StructurePalette;
  /** Parent-owned ref array; each slab mesh registers itself by index for the
   *  ResponseAnimator to mutate position.x per frame. Order matches `slabs`. */
  meshRefs: MutableRefObject<(Mesh | null)[]>;
  /** Override the default near-black/sky-blue edge color, used to flag
   *  partial-response runs in warn-orange. */
  edgeColorOverride?: string;
}

const Slabs = ({
  slabs,
  envelope,
  palette,
  meshRefs,
  edgeColorOverride,
}: SlabsProps): JSX.Element => (
  <group>
    {slabs.map((s, i) => {
      const color = s.isRoof ? palette.roof : palette.slab;
      const defaultEdge = s.isRoof ? '#0369a1' : '#0b0f17';
      const edgeColor = edgeColorOverride ?? defaultEdge;
      return (
        <mesh
          key={s.z}
          ref={(m: Mesh | null) => {
            meshRefs.current[i] = m;
          }}
          position={[0, s.z - s.thickness / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[envelope.x, s.thickness, envelope.y]} />
          <meshStandardMaterial color={color} metalness={0.1} roughness={0.7} />
          <Edges color={edgeColor} threshold={15} scale={1.001} />
        </mesh>
      );
    })}
  </group>
);

interface AnimatorProps {
  slabRefs: MutableRefObject<(Mesh | null)[]>;
  /** One ref per (column × story) segment, indexed `colIdx * stories + storyIdx`. */
  segmentRefs: MutableRefObject<(Object3D | null)[]>;
  /** Plan-position per column, in meters; same array used to render column segments. */
  columnPositions: readonly [number, number][];
  storyHeightM: number;
  /** Uniform slab thickness in meters; needed to reset slab y on mode changes
   *  and to compute pancake-stack landing positions in collapse mode. */
  slabThicknessM: number;
  planXM: number;
  planYM: number;
}

/** Reset every mutable slab + column-segment transform to the static
 *  un-deformed baseline. Used on mode change and on unmount. */
const resetTransforms = (
  slabRefs: MutableRefObject<(Mesh | null)[]>,
  segmentRefs: MutableRefObject<(Object3D | null)[]>,
  columnPositions: readonly (readonly [number, number])[],
  stories: number,
  storyHeightM: number,
  slabThicknessM: number,
): void => {
  const slabs = slabRefs.current;
  for (let k = 0; k < slabs.length; k++) {
    const m = slabs[k];
    if (m) {
      m.position.x = 0;
      m.position.y = (k + 1) * storyHeightM - slabThicknessM / 2;
    }
  }
  const segs = segmentRefs.current;
  for (let colIdx = 0; colIdx < columnPositions.length; colIdx++) {
    const px = columnPositions[colIdx]?.[0] ?? 0;
    const pz = columnPositions[colIdx]?.[1] ?? 0;
    for (let storyIdx = 0; storyIdx < stories; storyIdx++) {
      const seg = segs[colIdx * stories + storyIdx];
      if (!seg) continue;
      seg.position.x = px;
      seg.position.y = (storyIdx + 0.5) * storyHeightM;
      seg.position.z = pz;
      seg.rotation.x = 0;
      seg.rotation.z = 0;
    }
  }
};

/**
 * Per-frame deflected-shape animation driven by the OpenSees response.
 *
 * Three modes:
 *   - `'shape'`    : slabs sway as `factor * dispProfile[k] * sin(ωt)`, where
 *                    `dispProfile` is the calibrated first-mode shape.
 *   - `'playback'` : slabs follow the real OpenSees per-floor displacement
 *                    history, linearly interpolated at real-time elapsed
 *                    seconds, looping every `total_duration` seconds.
 *   - `'collapse'` : conceptual pancake fall — slabs above the failure plane
 *                    drop under gravity onto the standing portion; columns
 *                    above separate, tilt outward, and drift away. Linear
 *                    elastic OpenSees cannot predict collapse — this is
 *                    visualization of *what kind of failure this drift level
 *                    would represent*, not a simulation of it.
 *
 * All three share the slab+column-segment write loop: compute one frame per
 * render, then push to the Three.js objects. Column segments tilt to bridge
 * adjacent slab offsets so the building deforms as one coherent system.
 *
 * No React state updates per frame; we mutate position/rotation directly on
 * the Three.js objects. `state.invalidate()` keeps the demand-mode render
 * loop fed; on unmount or mode change, every mutated transform is reset.
 */
const ResponseAnimator = ({
  slabRefs,
  segmentRefs,
  columnPositions,
  storyHeightM,
  slabThicknessM,
  planXM,
  planYM,
}: AnimatorProps): null => {
  const result = useViabilityStore((s) => s.result);
  const exaggerationMode = useViabilityStore((s) => s.responseExaggeration);
  const mode = useViabilityStore((s) => s.responseMode);
  const collapseReplayToken = useViabilityStore((s) => s.collapseReplayToken);
  const invalidate = useThree((s) => s.invalidate);
  const mountTimeRef = useRef<number | null>(null);
  const collapseStartRef = useRef<number | null>(null);
  const swayHandoffRef = useRef<number[] | null>(null);

  const { dispProfile, omega, factor, stories, history, historyDtS, totalDuration } =
    useMemo(() => {
      const empty = {
        dispProfile: [] as number[],
        omega: 0,
        factor: 0,
        stories: 0,
        history: null as readonly (readonly number[])[] | null,
        historyDtS: 0,
        totalDuration: 0,
      };
      if (
        !result?.peak_idr_per_story ||
        result.peak_roof_disp_m == null ||
        result.eigen_T1_s == null
      ) {
        return empty;
      }
      const dispM = computeFloorDisplacements({
        peak_idr_per_story: result.peak_idr_per_story,
        peak_roof_disp_m: result.peak_roof_disp_m,
        story_height_m: storyHeightM,
      });
      const baseFactor =
        exaggerationMode === 'auto'
          ? autoExaggeration({
              peak_roof_disp_m: result.peak_roof_disp_m,
              plan_x_m: planXM,
              plan_y_m: planYM,
            })
          : exaggerationMode;
      // Partial-response runs sway at 85% amplitude — non-text cue that the
      // motion is degraded, in addition to the warn-orange slab edges.
      const ampScale = result.converged === false ? 0.85 : 1.0;
      const omegaRad = (2 * Math.PI) / visualSwayPeriodS(result.eigen_T1_s);
      const hist = result.floor_disp_history_m ?? null;
      const hdt = result.history_dt_s ?? 0;
      const dur = hist && hdt > 0 ? Math.max((hist.length - 1) * hdt, hdt) : 0;
      return {
        dispProfile: dispM,
        omega: omegaRad,
        factor: baseFactor * ampScale,
        stories: dispM.length,
        history: hist,
        historyDtS: hdt,
        totalDuration: dur,
      };
    }, [result, exaggerationMode, storyHeightM, planXM, planYM]);

  const failureStoryIdx = useMemo(
    () =>
      result?.peak_idr_per_story
        ? collapseFailureStoryIdx(result.peak_idr_per_story)
        : -1,
    [result],
  );

  // Reset per-mode timers and visual baseline whenever the mode, result, or
  // collapse-replay token changes. Stops collapse y/z/rotation.x from bleeding
  // into shape/playback (and vice versa); per-frame writes overwrite again
  // immediately. Bumping `collapseReplayToken` while staying in collapse mode
  // restarts the sequence from t=0 with a fresh sway handoff.
  useEffect(() => {
    mountTimeRef.current = null;
    collapseStartRef.current = null;
    swayHandoffRef.current = null;
    resetTransforms(
      slabRefs,
      segmentRefs,
      columnPositions,
      stories,
      storyHeightM,
      slabThicknessM,
    );
    invalidate();
  }, [
    mode,
    result,
    collapseReplayToken,
    slabRefs,
    segmentRefs,
    columnPositions,
    stories,
    storyHeightM,
    slabThicknessM,
    invalidate,
  ]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (mode === 'collapse' && failureStoryIdx >= 0 && stories > 0) {
      if (collapseStartRef.current == null) {
        collapseStartRef.current = t;
        // Capture the current shape-frame as the swayHandoff so the standing
        // portion freezes mid-sway instead of snapping straight on entry.
        const sin = Math.sin(omega * t);
        const handoff = new Array<number>(stories);
        for (let k = 0; k < stories; k++) {
          handoff[k] = factor * (dispProfile[k] ?? 0) * sin;
        }
        swayHandoffRef.current = handoff;
      }
      const collapseElapsed = t - collapseStartRef.current;
      const handoff = swayHandoffRef.current ?? [];
      const geo = {
        failureStoryIdx,
        nStories: stories,
        storyHeightM,
        slabThicknessM,
      };
      const slabFrame = computeCollapseSlabFrame(collapseElapsed, geo, handoff);
      const colFrame = computeCollapseColumnFrame(
        collapseElapsed,
        geo,
        columnPositions,
        handoff,
      );

      const slabs = slabRefs.current;
      const nSlabs = Math.min(slabs.length, slabFrame.length);
      for (let k = 0; k < nSlabs; k++) {
        const m = slabs[k];
        const f = slabFrame[k];
        if (m && f) {
          m.position.x = f.x;
          m.position.y = f.y;
        }
      }

      const segs = segmentRefs.current;
      const nSegs = Math.min(segs.length, colFrame.length);
      for (let i = 0; i < nSegs; i++) {
        const seg = segs[i];
        const f = colFrame[i];
        if (seg && f) {
          seg.position.x = f.x;
          seg.position.y = f.y;
          seg.position.z = f.z;
          seg.rotation.x = f.rotX;
          seg.rotation.z = f.rotZ;
        }
      }

      // Stop self-perpetuating once the pile has settled — held collapsed
      // state needs no further frames until mode changes or unmount.
      if (!collapseSettled(collapseElapsed, geo)) {
        state.invalidate();
      }
      return;
    }

    let perFloorOffset: number[];
    if (mode === 'playback' && history && historyDtS > 0 && totalDuration > 0) {
      if (mountTimeRef.current == null) mountTimeRef.current = t;
      const elapsed = (t - mountTimeRef.current) % totalDuration;
      const sample = interpolateHistoryAt(history, historyDtS, elapsed);
      perFloorOffset = new Array(stories);
      for (let k = 0; k < stories; k++) {
        perFloorOffset[k] = factor * (sample[k] ?? 0);
      }
    } else {
      // Shape mode (default + fallback when history is unavailable).
      const sin = Math.sin(omega * t);
      perFloorOffset = new Array(stories);
      for (let k = 0; k < stories; k++) {
        perFloorOffset[k] = factor * (dispProfile[k] ?? 0) * sin;
      }
    }

    const slabs = slabRefs.current;
    const nSlabs = Math.min(slabs.length, perFloorOffset.length);
    for (let k = 0; k < nSlabs; k++) {
      const m = slabs[k];
      if (m) m.position.x = perFloorOffset[k] ?? 0;
    }

    const segs = segmentRefs.current;
    for (let colIdx = 0; colIdx < columnPositions.length; colIdx++) {
      const px = columnPositions[colIdx]?.[0] ?? 0;
      for (let storyIdx = 0; storyIdx < stories; storyIdx++) {
        const seg = segs[colIdx * stories + storyIdx];
        if (!seg) continue;
        const bottom = storyIdx === 0 ? 0 : (perFloorOffset[storyIdx - 1] ?? 0);
        const top = perFloorOffset[storyIdx] ?? 0;
        seg.position.x = px + (bottom + top) / 2;
        seg.rotation.z = -Math.atan2(top - bottom, storyHeightM);
      }
    }

    state.invalidate();
  });

  useEffect(() => {
    return () => {
      resetTransforms(
        slabRefs,
        segmentRefs,
        columnPositions,
        stories,
        storyHeightM,
        slabThicknessM,
      );
      invalidate();
    };
  }, [
    slabRefs,
    segmentRefs,
    columnPositions,
    stories,
    storyHeightM,
    slabThicknessM,
    invalidate,
  ]);

  return null;
};

interface ColumnsProps {
  columns: ColumnGrid;
  palette: StructurePalette;
  /** Number of per-column segments to render (one per story). When animation
   *  is mounted, the animator tilts each segment between its bottom and top
   *  floor offsets. With no animation, segments stack vertically and read as
   *  a single tall column visually. */
  stories: number;
  storyHeightM: number;
  /** Parent-owned ref array; each segment registers itself by index
   *  `colIdx * stories + storyIdx`. Same indexing the animator uses. */
  segmentRefs: MutableRefObject<(Object3D | null)[]>;
}

const Columns = ({
  columns,
  palette,
  stories,
  storyHeightM,
  segmentRefs,
}: ColumnsProps): JSX.Element => {
  const tinted = useMemo(
    () => tintHex(palette.column, palette.columnTint),
    [palette.column, palette.columnTint],
  );
  // Per-story segments give each story-tall column piece its own transform so
  // the animator can tilt it to bridge adjacent slab offsets. Buffer geometry
  // is constant; the limit is sized once for the worst-case stories × columns.
  return (
    <Instances limit={MAX_COLUMN_INSTANCES} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={tinted} metalness={0.2} roughness={0.55} />
      {columns.positions.flatMap((p, colIdx) =>
        Array.from({ length: stories }, (_, storyIdx) => (
          <Instance
            key={`${colIdx}-${storyIdx}`}
            ref={(inst: Object3D | null) => {
              segmentRefs.current[colIdx * stories + storyIdx] = inst;
            }}
            position={[p[0], (storyIdx + 0.5) * storyHeightM, p[1]]}
            scale={[columns.sectionSize, storyHeightM, columns.sectionSize]}
          />
        )),
      )}
    </Instances>
  );
};

/** Pick a round scale-bar length such that its on-screen size stays roughly
 *  constant regardless of building dimensions. `bboxScale` collapses short and
 *  tall structures into a comparable world footprint; we target ~15 world
 *  units of bar length and snap to a human-readable tier. */
const niceScaleMeters = (bboxScale: number): number => {
  const target = 15 / Math.max(bboxScale, 1e-6);
  const tiers = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  for (const t of tiers) if (t >= target) return t;
  return tiers[tiers.length - 1] ?? 1000;
};

interface ScaleReferenceProps {
  bboxScale: number;
  planXM: number;
}

/** A small horizontal bar with end ticks and a "N m" label, placed just
 *  outside the building footprint on the camera-right side so the HTML
 *  label floats clear of the bottom-left HUD cards. Orientation is along
 *  Z so the label reads from the default camera angle without clipping the
 *  building. The bar length is nice-rounded to a human-readable tier; the
 *  HTML label keeps a constant pixel size so it stays legible at any zoom. */
const ScaleReference = ({ bboxScale, planXM }: ScaleReferenceProps): JSX.Element => {
  const barLengthM = niceScaleMeters(bboxScale);
  const xOffset = planXM / 2 + 2;
  const tickHeightM = 1.0;
  const barThicknessM = 0.25;
  return (
    <group position={[xOffset, barThicknessM / 2, 0]}>
      <mesh>
        <boxGeometry args={[barThicknessM, barThicknessM, barLengthM]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.15} roughness={0.5} />
      </mesh>
      <mesh position={[0, tickHeightM / 2, -barLengthM / 2]}>
        <boxGeometry args={[barThicknessM, tickHeightM, barThicknessM]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.15} roughness={0.5} />
      </mesh>
      <mesh position={[0, tickHeightM / 2, +barLengthM / 2]}>
        <boxGeometry args={[barThicknessM, tickHeightM, barThicknessM]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.15} roughness={0.5} />
      </mesh>
      <Html position={[0, tickHeightM + 1.0, 0]} center>
        <div className="text-[11px] font-medium text-slate-100 bg-ink/90 backdrop-blur border border-slate-300/40 rounded px-2 py-0.5 shadow-lg pointer-events-none whitespace-nowrap">
          {barLengthM} m
        </div>
      </Html>
    </group>
  );
};

interface GroundSlabProps {
  envelope: StructureEnvelope;
  palette: StructurePalette;
}

const GroundSlab = ({ envelope, palette }: GroundSlabProps): JSX.Element => (
  <mesh position={[0, -0.05, 0]} receiveShadow>
    <boxGeometry args={[envelope.x * 1.04, 0.1, envelope.y * 1.04]} />
    <meshStandardMaterial color={palette.slab} metalness={0.05} roughness={0.9} />
    <Edges color="#0b0f17" threshold={15} scale={1.001} />
  </mesh>
);

interface HudProps {
  normalized: NormalizedStructure;
}

const tonalForMismatch = (pct: number | null): string => {
  if (pct == null) return 'text-muted';
  const a = Math.abs(pct);
  if (a > 50) return 'text-warn';
  if (a > 20) return 'text-accent';
  return 'text-ok';
};

const HudOverlay = ({ normalized }: HudProps): JSX.Element => {
  const { spec, metrics, warnings } = normalized;
  const nonFatal = warnings.filter((w) => w.severity !== 'fatal');
  const terrain = useViabilityStore((s) => s.terrain);
  const scaleBarM = niceScaleMeters(normalized.envelope.bboxScale);
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-3 left-[68px] bg-ink/85 backdrop-blur border border-line rounded-lg p-3 shadow-lg text-xs min-w-[210px]">
        <div className="text-muted uppercase tracking-wider text-[10px] mb-1">System</div>
        <div className="font-medium mb-2">{SYSTEM_LABELS[spec.system]}</div>
        <div className="border-t border-line/60 pt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
          <span className="text-muted">Stories</span>
          <span>{spec.stories}</span>
          <span className="text-muted">Story h</span>
          <span>{fmt(spec.story_height_m)} m</span>
          <span className="text-muted">Plan</span>
          <span>
            {fmt(spec.plan_x_m)} × {fmt(spec.plan_y_m)} m
          </span>
        </div>
      </div>

      <div className="absolute top-3 right-24 flex flex-col items-end gap-1.5">
        {terrain && (
          <div
            className={`backdrop-blur border rounded-lg px-2.5 py-1.5 shadow-lg text-[11px] ${
              terrain.synthetic_for_demo
                ? 'bg-ink/85 border-warn/40 text-warn'
                : 'bg-ink/85 border-line text-muted'
            }`}
            title={`Terrain window ±${Math.round(terrain.window_m / 2)} m · elevation ${fmt(terrain.center_elevation_m, 0)} m at site`}
          >
            Terrain · {terrainSourceLabel(terrain)}
          </div>
        )}
        <div
          className="bg-ink/85 backdrop-blur border border-line rounded-lg px-2.5 py-1.5 shadow-lg text-[10px] text-muted leading-tight"
          title="Scale reference in the 3D view. Bar length adapts to keep the marker on-screen as the structure changes."
        >
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wider text-[9px]">Scale</span>
            <span className="inline-flex items-center gap-1 text-slate-200">
              <span className="inline-block h-[2px] w-8 bg-slate-300 align-middle" />
              {scaleBarM} m
            </span>
          </div>
          <div className="mt-0.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0">
            <span>Footprint</span>
            <span className="text-slate-200">{fmt(spec.plan_x_m)} × {fmt(spec.plan_y_m)} m</span>
            <span>Height</span>
            <span className="text-slate-200">{fmt(metrics.totalHeight)} m</span>
            {terrain && (
              <>
                <span>Terrain</span>
                <span className="text-slate-200">{Math.round(terrain.window_m)} m window</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 bg-ink/85 backdrop-blur border border-line rounded-lg p-3 shadow-lg text-xs grid grid-cols-2 gap-x-4 gap-y-0.5 min-w-[260px]">
        <div className="text-muted uppercase tracking-wider text-[10px] col-span-2 mb-1">
          Derived metrics
        </div>
        <span className="text-muted">Height</span>
        <span>{fmt(metrics.totalHeight)} m</span>
        <span className="text-muted">Footprint</span>
        <span>{fmt(metrics.footprintArea, 0)} m²</span>
        <span className="text-muted">Plan aspect</span>
        <span>{fmt(metrics.planAspect, 2)} : 1</span>
        <span className="text-muted">Slenderness</span>
        <span>{fmt(metrics.slenderness, 2)}</span>
        <span className="text-muted">Total mass</span>
        <span>{fmt(metrics.totalMass, 0)} t</span>
        <span className="text-muted">Density</span>
        <span>{fmt(metrics.massDensity, 2)} t/m²</span>
        <span className="text-muted">Derived T</span>
        <span className={tonalForMismatch(metrics.periodMismatchPct)}>
          {fmt(metrics.derivedPeriod, 2)} s
        </span>
      </div>

      {nonFatal.length > 0 && (
        <div className="absolute bottom-3 right-24 bg-ink/85 backdrop-blur border border-warn/40 rounded-lg px-3 py-2 shadow-lg text-[11px] max-w-[260px]">
          <div className="text-warn font-medium mb-0.5">Heads up</div>
          {nonFatal.map((w) => (
            <div key={`${w.field}-${w.severity}`} className="text-muted">
              · {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const InvalidOverlay = ({
  warnings,
}: {
  warnings: StructureWarning[];
}): JSX.Element => (
  <div className="h-full flex flex-col items-center justify-center text-center p-6 gap-2">
    <span className="pill bg-bad/10 text-bad border border-bad/40 mb-2">
      Invalid structure
    </span>
    <p className="text-sm text-muted">Fix these inputs to render the preview:</p>
    <ul className="text-xs text-bad space-y-1 mt-2">
      {warnings.map((w) => (
        <li key={w.field}>· {w.message}</li>
      ))}
    </ul>
  </div>
);

export const StructurePreview3D = (): JSX.Element => {
  const structure = useViabilityStore((s) => s.structure);
  const result = useViabilityStore((s) => s.result);
  const responseVizEnabled = useViabilityStore((s) => s.responseVizEnabled);
  const responseMode = useViabilityStore((s) => s.responseMode);
  const stale = useViabilityStore(isResultStale);

  const normalized = useMemo(() => deriveStructureGeometry(structure), [structure]);
  const controlsRef = useRef<ControlsRef | null>(null);
  const slabRefs = useRef<(Mesh | null)[]>([]);
  const segmentRefs = useRef<(Object3D | null)[]>([]);

  if (!normalized.isValid) {
    return (
      <InvalidOverlay
        warnings={normalized.warnings.filter((w) => w.severity === 'fatal')}
      />
    );
  }

  const { envelope, palette, columns, slabs } = normalized;

  const shapePrereq =
    result?.physics_backend === 'opensees' &&
    result.peak_idr_per_story != null &&
    result.peak_idr_per_story.length > 0 &&
    result.peak_roof_disp_m != null &&
    result.eigen_T1_s != null;
  const playbackPrereq =
    shapePrereq &&
    result?.floor_disp_history_m != null &&
    result.floor_disp_history_m.length > 0 &&
    result.history_dt_s != null &&
    result.history_dt_s > 0;
  const modePrereq = responseMode === 'playback' ? playbackPrereq : shapePrereq;
  const animationActive = responseVizEnabled && !stale && modePrereq;

  const slabEdgeOverride =
    result?.physics_backend === 'opensees' && result.converged === false
      ? '#f59e0b'
      : undefined;

  return (
    <div className="h-full relative">
      <Canvas
        frameloop="demand"
        camera={{ position: [60, 50, 60], fov: 35, near: 0.1, far: 1000 }}
        shadows
        gl={{ antialias: true, alpha: true }}
      >
        <SceneLighting />

        <group scale={envelope.bboxScale}>
          <Slabs
            slabs={slabs}
            envelope={envelope}
            palette={palette}
            meshRefs={slabRefs}
            {...(slabEdgeOverride !== undefined && { edgeColorOverride: slabEdgeOverride })}
          />
          <Columns
            columns={columns}
            palette={palette}
            stories={normalized.stories.length}
            storyHeightM={structure.story_height_m}
            segmentRefs={segmentRefs}
          />
          <GroundSlab envelope={envelope} palette={palette} />
          <TerrainMesh />
          <ScaleReference bboxScale={envelope.bboxScale} planXM={structure.plan_x_m} />
          {animationActive && (
            <ResponseAnimator
              slabRefs={slabRefs}
              segmentRefs={segmentRefs}
              columnPositions={columns.positions}
              storyHeightM={structure.story_height_m}
              slabThicknessM={slabs[0]?.thickness ?? 0.2}
              planXM={structure.plan_x_m}
              planYM={structure.plan_y_m}
            />
          )}
        </group>

        <Grid
          args={[200, 200]}
          cellSize={2}
          cellThickness={0.6}
          cellColor="#1f2937"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#1e293b"
          fadeDistance={90}
          fadeStrength={2.5}
          infiniteGrid
        />

        <ContactShadows
          position={[0, 0.005, 0]}
          opacity={0.55}
          blur={2.5}
          far={60}
          resolution={512}
          frames={1}
        />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan={false}
          maxPolarAngle={Math.PI * 0.49}
          minDistance={20}
          maxDistance={2000}
        />

        <CameraRig envelope={envelope} controlsRef={controlsRef} />

        <GizmoHelper alignment="top-right" margin={[64, 56]}>
          <GizmoViewport
            axisColors={['#ef4444', '#22c55e', '#38bdf8']}
            labelColor="#e2e8f0"
          />
        </GizmoHelper>
      </Canvas>

      <HudOverlay normalized={normalized} />
    </div>
  );
};
