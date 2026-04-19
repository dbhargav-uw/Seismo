/**
 * Pure math for the OpenSees-backed response visualization in
 * `StructurePreview3D`. No React, no R3F, no DOM. Safe to call from anywhere.
 *
 * Floor / story indexing — be careful, OpenSees and the renderer disagree
 * on what they label "floor 0":
 *
 *   peak_idr_per_story[k] = peak inter-story drift ratio of story k+1
 *                           (the story between floor k and floor k+1, where
 *                            floor 0 is the fixed base).
 *   slabs[k]              = the slab at the top of story k+1 (i.e. floor k+1).
 *
 *   So the mapping is one-to-one:
 *     slab[k].xOffset = sum(peak_idr_per_story[0..k]) * story_height_m * calibration
 *
 * This is the mode-shape approximation. Real dynamics: peak inter-story
 * drifts at different stories don't all occur at the same instant, so the
 * cumulative-sum overstates the simultaneous deflected shape. We mitigate
 * this by rescaling so the top floor lands on the OpenSees-reported
 * `peak_roof_disp_m` (which IS a true simultaneous signal). Shape is
 * approximate; magnitude at the roof is calibrated.
 */

const TARGET_VISUAL_ROOF_FRACTION = 0.2;
// Scripps demo motions produce micron-scale peak roof displacements
// (~25 μm for demo_high on a 5-story concrete frame). To get the deflected
// shape onto the screen at the target 20% of building width, the multiplier
// has to land in the 10⁵–10⁶ range. The ceiling exists only to prevent
// blow-up when peak_roof_disp_m is essentially zero.
const MAX_AUTO_EXAGGERATION = 1_000_000;
const MIN_RAW_ROOF_DISP_M = 1e-9;

interface FloorDispInput {
  peak_idr_per_story: readonly number[];
  peak_roof_disp_m: number;
  story_height_m: number;
}

/**
 * Returns the peak X displacement (in meters) of each floor above the base.
 * Length matches `peak_idr_per_story.length`. All-zero input → all-zero
 * output; never throws on zero inputs.
 */
export const computeFloorDisplacements = ({
  peak_idr_per_story,
  peak_roof_disp_m,
  story_height_m,
}: FloorDispInput): number[] => {
  if (peak_idr_per_story.length === 0) return [];

  const raw: number[] = [];
  let cumulative = 0;
  for (const drift of peak_idr_per_story) {
    cumulative += Math.abs(drift) * story_height_m;
    raw.push(cumulative);
  }

  const rawRoof = raw[raw.length - 1] ?? 0;
  if (rawRoof < MIN_RAW_ROOF_DISP_M || peak_roof_disp_m <= 0) {
    return raw;
  }
  const calibration = peak_roof_disp_m / rawRoof;
  return raw.map((v) => v * calibration);
};

interface AutoExaggInput {
  peak_roof_disp_m: number;
  plan_x_m: number;
  plan_y_m: number;
}

/**
 * Pick an exaggeration factor so the visualized peak roof offset is roughly
 * 20% of the smaller plan dimension. Clamped to [1, 10000] so a near-zero
 * peak roof doesn't blow up to infinity.
 */
export const autoExaggeration = ({
  peak_roof_disp_m,
  plan_x_m,
  plan_y_m,
}: AutoExaggInput): number => {
  if (peak_roof_disp_m <= 0) return 1;
  const target = TARGET_VISUAL_ROOF_FRACTION * Math.min(plan_x_m, plan_y_m);
  const raw = target / peak_roof_disp_m;
  return Math.max(1, Math.min(MAX_AUTO_EXAGGERATION, raw));
};

/**
 * Visual sway period for the looping animation. Anchored to the OpenSees
 * eigen T1 so a stiff structure visibly sways faster than a flexible one,
 * but clamped to a minimum of 1.5 s/cycle so sub-second T1 stays readable.
 */
export const visualSwayPeriodS = (eigen_T1_s: number): number => {
  const period = Math.max(eigen_T1_s, 0) * 2;
  return Math.max(period, 1.5);
};

/**
 * Interpolate the per-floor displacement history at a given playback time.
 *
 * `history[step][floor]` is meters, relative to base, sampled at uniform
 * `dt_s`. Linear interpolation between adjacent steps is sufficient for 60fps
 * rendering of a 10Hz history; higher-order is overkill.
 *
 * Out-of-range `tSeconds` values clamp to the endpoints (caller is expected
 * to handle looping by passing `t % totalDuration`).
 *
 * Returns `[]` if the history is empty (no allocation, no throw).
 */
export const interpolateHistoryAt = (
  history: readonly (readonly number[])[],
  dt_s: number,
  tSeconds: number,
): number[] => {
  const n = history.length;
  if (n === 0) return [];
  const firstRow = history[0] ?? [];
  if (n === 1) return [...firstRow];

  if (tSeconds <= 0) return [...firstRow];
  const lastRow = history[n - 1] ?? [];
  const totalDuration = (n - 1) * dt_s;
  if (tSeconds >= totalDuration) return [...lastRow];

  const stepFloat = tSeconds / dt_s;
  const lo = Math.floor(stepFloat);
  const hi = lo + 1;
  const a = stepFloat - lo;

  const rowLo = history[lo] ?? [];
  const rowHi = history[hi] ?? rowLo;
  const out: number[] = new Array(rowLo.length);
  for (let k = 0; k < rowLo.length; k++) {
    const lv = rowLo[k] ?? 0;
    const hv = rowHi[k] ?? lv;
    out[k] = lv * (1 - a) + hv * a;
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Collapse animation
//
// Conceptual pancake-collapse mechanics. Triggered when peak inter-story drift
// exceeds an engineering collapse-prevention threshold (or invoked manually as
// a "preview the mechanism" demo). Slabs above the failure plane fall under
// gravity and stack on top of the standing portion; columns above separate,
// tilt outward, and drift away. The OpenSees pipeline runs linear elastic
// dynamics — it cannot actually predict collapse — so this is honest
// visualization of *what kind of failure this drift level would represent*,
// not a progressive-collapse simulation.

/**
 * ASCE 41 / FEMA 356 "collapse prevention" performance objective for concrete
 * moment frames. Demo Scripps motions on stiff structures will not reach this
 * — that's correct linear elastic behavior, not a bug.
 */
export const COLLAPSE_THRESHOLD_IDR = 0.04;

const G_MS2 = 9.81;
const COLLAPSE_PREAMBLE_S = 0.3;
const COLLAPSE_SLAB_STAGGER_S = 0.06;
const COLLAPSE_TILT_RATE_RADS = 1.6;
const COLLAPSE_MAX_TILT_RAD = Math.PI / 2;
const COLLAPSE_LATERAL_VEL_MPS = 1.5;
const COLLAPSE_SETTLE_BUFFER_S = 0.5;

export interface CollapseGeometry {
  /** Story index whose columns fail; slabs/columns at index >= this fall. */
  failureStoryIdx: number;
  nStories: number;
  storyHeightM: number;
  slabThicknessM: number;
}

export interface SlabFrame {
  /** Lateral (X) position of slab center, meters. */
  x: number;
  /** Vertical (Y) position of slab center, meters. */
  y: number;
}

export interface ColumnFrame {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  rotX: number;
}

/**
 * Argmax of |peak_idr_per_story|. Returns -1 if the array is empty or all
 * values are zero (in which case there is no meaningful failure plane).
 */
export const collapseFailureStoryIdx = (peak_idr_per_story: readonly number[]): number => {
  let best = -1;
  let bestVal = 0;
  for (let i = 0; i < peak_idr_per_story.length; i++) {
    const v = Math.abs(peak_idr_per_story[i] ?? 0);
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
};

/**
 * True when the peak inter-story drift exceeds the engineering
 * collapse-prevention threshold (default 4% IDR).
 */
export const collapseAutoTriggered = (
  peak_idr_per_story: readonly number[],
  threshold: number = COLLAPSE_THRESHOLD_IDR,
): boolean => {
  let peak = 0;
  for (const v of peak_idr_per_story) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return peak > threshold;
};

const slabCenterY0 = (k: number, geo: CollapseGeometry): number =>
  (k + 1) * geo.storyHeightM - geo.slabThicknessM / 2;

const pancakeLandingY = (k: number, geo: CollapseGeometry): number => {
  const topOfStanding = geo.failureStoryIdx > 0 ? geo.failureStoryIdx * geo.storyHeightM : 0;
  const orderInStack = k - geo.failureStoryIdx;
  return topOfStanding + (orderInStack + 0.5) * geo.slabThicknessM;
};

/**
 * Per-slab {x, y} at collapse-elapsed time `t`. Slabs below the failure plane
 * keep their swaying handoff x and original y; falling slabs free-fall after
 * a per-slab stagger and clamp to their pancake landing y. swayHandoff[k] is
 * the slab x offset captured at the instant collapse mode took over (so the
 * standing portion freezes mid-sway instead of snapping straight).
 */
export const computeCollapseSlabFrame = (
  t: number,
  geo: CollapseGeometry,
  swayHandoff: readonly number[],
): SlabFrame[] => {
  const out: SlabFrame[] = new Array(geo.nStories);
  for (let k = 0; k < geo.nStories; k++) {
    const y0 = slabCenterY0(k, geo);
    const x0 = swayHandoff[k] ?? 0;
    if (k < geo.failureStoryIdx || geo.failureStoryIdx < 0) {
      out[k] = { x: x0, y: y0 };
      continue;
    }
    const order = k - geo.failureStoryIdx;
    const tStart = COLLAPSE_PREAMBLE_S + order * COLLAPSE_SLAB_STAGGER_S;
    const tLocal = t - tStart;
    if (tLocal <= 0) {
      out[k] = { x: x0, y: y0 };
      continue;
    }
    const yFree = y0 - 0.5 * G_MS2 * tLocal * tLocal;
    const yLand = pancakeLandingY(k, geo);
    out[k] = { x: x0, y: Math.max(yFree, yLand) };
  }
  return out;
};

/**
 * Per-column-segment frame, flat-indexed `colIdx * nStories + storyIdx`
 * (matches the existing segmentRefs ordering). Below-failure-plane segments
 * keep bridging the swayHandoff offsets; above-failure segments tilt outward
 * (rotation.z from plan-X offset, rotation.x from plan-Z offset) and drift
 * laterally while falling under gravity. A central column (px = pz = 0) just
 * falls straight down — that's fine.
 */
export const computeCollapseColumnFrame = (
  t: number,
  geo: CollapseGeometry,
  columnPositions: readonly (readonly [number, number])[],
  swayHandoff: readonly number[],
): ColumnFrame[] => {
  const tColumn = t - COLLAPSE_PREAMBLE_S;
  const tilt = Math.min(Math.max(tColumn, 0) * COLLAPSE_TILT_RATE_RADS, COLLAPSE_MAX_TILT_RAD);
  const lateral = COLLAPSE_LATERAL_VEL_MPS * Math.max(tColumn, 0);
  const yDrop = 0.5 * G_MS2 * Math.max(tColumn, 0) * Math.max(tColumn, 0);
  const restY = geo.slabThicknessM;

  const out: ColumnFrame[] = new Array(columnPositions.length * geo.nStories);
  for (let colIdx = 0; colIdx < columnPositions.length; colIdx++) {
    const px0 = columnPositions[colIdx]?.[0] ?? 0;
    const pz0 = columnPositions[colIdx]?.[1] ?? 0;
    const sx = Math.sign(px0);
    const sz = Math.sign(pz0);
    for (let storyIdx = 0; storyIdx < geo.nStories; storyIdx++) {
      const yCenter0 = (storyIdx + 0.5) * geo.storyHeightM;
      const standing =
        geo.failureStoryIdx < 0 || storyIdx < geo.failureStoryIdx;
      if (standing || tColumn <= 0) {
        const bottom = storyIdx === 0 ? 0 : (swayHandoff[storyIdx - 1] ?? 0);
        const top = swayHandoff[storyIdx] ?? 0;
        out[colIdx * geo.nStories + storyIdx] = {
          x: px0 + (bottom + top) / 2,
          y: yCenter0,
          z: pz0,
          rotZ: -Math.atan2(top - bottom, geo.storyHeightM),
          rotX: 0,
        };
        continue;
      }
      const yFree = yCenter0 - yDrop;
      out[colIdx * geo.nStories + storyIdx] = {
        x: px0 + sx * lateral,
        y: Math.max(yFree, restY),
        z: pz0 + sz * lateral,
        rotZ: -sx * tilt,
        rotX: sz * tilt,
      };
    }
  }
  return out;
};

/**
 * True once all collapse motion has settled. Conservative: waits long enough
 * for the topmost falling slab (latest stagger, longest fall) to land plus a
 * small buffer so the pile reads as static, not still-tweening.
 */
export const collapseSettled = (t: number, geo: CollapseGeometry): boolean => {
  if (geo.failureStoryIdx < 0 || geo.failureStoryIdx >= geo.nStories) return true;
  const topK = geo.nStories - 1;
  const order = topK - geo.failureStoryIdx;
  const tStart = COLLAPSE_PREAMBLE_S + order * COLLAPSE_SLAB_STAGGER_S;
  const fallHeight = slabCenterY0(topK, geo) - pancakeLandingY(topK, geo);
  const fallTime = fallHeight > 0 ? Math.sqrt((2 * fallHeight) / G_MS2) : 0;
  return t > tStart + fallTime + COLLAPSE_SETTLE_BUFFER_S;
};
