import type { StructureSpec } from '../../api/types';
import { SYSTEM_MATERIALS } from './palette';
import type {
  ColumnGrid,
  FieldMeta,
  NormalizedStructure,
  SlabInfo,
  StoryInfo,
  StructureEnvelope,
  StructureMetrics,
  StructurePalette,
  StructureWarning,
} from './types';

const TARGET_WORLD_SIZE = 30;
const MIN_BAYS_PER_DIR = 2;
const MAX_BAYS_PER_DIR = 12;
const MAJOR_PERIOD_MISMATCH_PCT = 50;
const TALL_STORIES_THRESHOLD = 40;
const TYPICAL_DENSITY_LOW_T_PER_M2 = 1;
const TYPICAL_DENSITY_HIGH_T_PER_M2 = 15;

/**
 * Static field-representation matrix. Mirrors the contract in
 * `docs`/the approved plan: every editable input is either visible in the
 * preview, an analysis-only quantity, or both.
 *
 * Exposed so consumers can render representation chips without having to call
 * `deriveStructureGeometry` (e.g. before the user has typed anything).
 */
export const STRUCTURE_FIELD_REPRESENTATION: readonly FieldMeta[] = [
  {
    field: 'stories',
    representation: 'visible',
    hint: 'Number of slab + column-grid layers in the preview.',
  },
  {
    field: 'story_height_m',
    representation: 'visible',
    hint: 'Vertical spacing between slabs in the preview.',
  },
  {
    field: 'plan_x_m',
    representation: 'visible',
    hint: 'Footprint X dimension; sets column-grid bays in X.',
  },
  {
    field: 'plan_y_m',
    representation: 'visible',
    hint: 'Footprint Y dimension; sets column-grid bays in Y.',
  },
  {
    field: 'mass_per_floor_t',
    representation: 'visible+analysis',
    hint: 'Subtle column-tint cue in the preview; drives total mass and the analysis.',
  },
  {
    field: 'period_guess_s',
    representation: 'analysis',
    hint: 'Used by /api/simulate. No direct geometry — compare with the engineering-derived period.',
  },
  {
    field: 'system',
    representation: 'visible+analysis',
    hint: 'Material palette, column / slab sizing, and per-system period coefficient.',
  },
];

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

const isPositive = (n: number | null | undefined): boolean =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Returns a 0.7..1.0 tint multiplier for the column color, deepening with
 * mass density across a typical 1..15 t/m² band.
 */
const computeColumnTint = (massDensity: number): number => {
  const span = TYPICAL_DENSITY_HIGH_T_PER_M2 - TYPICAL_DENSITY_LOW_T_PER_M2;
  const norm = clamp((massDensity - TYPICAL_DENSITY_LOW_T_PER_M2) / span, 0, 1);
  return 0.7 + 0.3 * norm;
};

const buildColumnGrid = (
  x: number,
  y: number,
  height: number,
  bay_m: number,
  sectionSize: number,
): ColumnGrid => {
  const nx = clamp(Math.round(x / bay_m), MIN_BAYS_PER_DIR, MAX_BAYS_PER_DIR);
  const ny = clamp(Math.round(y / bay_m), MIN_BAYS_PER_DIR, MAX_BAYS_PER_DIR);
  const positions: [number, number][] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const px = -x / 2 + (i * x) / nx;
      const pz = -y / 2 + (j * y) / ny;
      positions.push([px, pz]);
    }
  }
  return { nx, ny, positions, sectionSize, height };
};

/**
 * Pure, synchronous derivation of preview geometry + metrics + warnings from a
 * `StructureSpec`. Safe to call on every keystroke — no IO, no side effects.
 *
 * On invalid input the function still returns a structurally-valid (dummy)
 * geometry so the renderer can keep the scene mounted while showing the
 * invalid-state overlay; consult `isValid` and `warnings` for diagnosis.
 */
export const deriveStructureGeometry = (spec: StructureSpec): NormalizedStructure => {
  const warnings: StructureWarning[] = [];

  if (!isPositive(spec.stories)) {
    warnings.push({ field: 'stories', message: 'Stories must be ≥ 1.', severity: 'fatal' });
  }
  if (!isPositive(spec.story_height_m)) {
    warnings.push({ field: 'story_height_m', message: 'Story height must be > 0 m.', severity: 'fatal' });
  }
  if (!isPositive(spec.plan_x_m)) {
    warnings.push({ field: 'plan_x_m', message: 'Plan X must be > 0 m.', severity: 'fatal' });
  }
  if (!isPositive(spec.plan_y_m)) {
    warnings.push({ field: 'plan_y_m', message: 'Plan Y must be > 0 m.', severity: 'fatal' });
  }
  if (!isPositive(spec.mass_per_floor_t)) {
    warnings.push({ field: 'mass_per_floor_t', message: 'Mass per floor must be > 0 t.', severity: 'fatal' });
  }

  const stories = isPositive(spec.stories) ? Math.floor(spec.stories) : 1;
  const h = isPositive(spec.story_height_m) ? spec.story_height_m : 1;
  const x = isPositive(spec.plan_x_m) ? spec.plan_x_m : 1;
  const y = isPositive(spec.plan_y_m) ? spec.plan_y_m : 1;
  const massPerFloor = isPositive(spec.mass_per_floor_t) ? spec.mass_per_floor_t : 1;

  if (stories > TALL_STORIES_THRESHOLD) {
    warnings.push({
      field: 'stories',
      message: `Preview simplifies columns above ${TALL_STORIES_THRESHOLD} stories.`,
      severity: 'info',
    });
  }

  const sys = SYSTEM_MATERIALS[spec.system];

  const totalHeight = stories * h;
  const footprintArea = x * y;
  const totalMass = stories * massPerFloor;
  const massDensity = massPerFloor / footprintArea;
  const planAspect = Math.max(x / y, y / x);
  const slenderness = totalHeight / Math.min(x, y);
  const derivedPeriod = sys.periodCoefficient * Math.pow(totalHeight, 0.75);
  const periodMismatchPct =
    spec.period_guess_s != null && isPositive(spec.period_guess_s)
      ? ((spec.period_guess_s - derivedPeriod) / derivedPeriod) * 100
      : null;

  if (periodMismatchPct != null && Math.abs(periodMismatchPct) > MAJOR_PERIOD_MISMATCH_PCT) {
    warnings.push({
      field: 'period_guess_s',
      message: `Period guess differs ${periodMismatchPct.toFixed(0)}% from engineering estimate (${derivedPeriod.toFixed(2)} s).`,
      severity: 'warn',
    });
  }

  const bboxScale = TARGET_WORLD_SIZE / Math.max(totalHeight, x, y);

  const storiesArr: StoryInfo[] = Array.from({ length: stories }, (_, i) => ({
    index: i,
    zBottom: i * h,
    zTop: (i + 1) * h,
    isRoof: i === stories - 1,
    mass_t: massPerFloor,
  }));

  const slabs: SlabInfo[] = storiesArr.map((s) => ({
    z: s.zTop,
    thickness: sys.slabThickness,
    isRoof: s.isRoof,
  }));

  const sectionSize = sys.columnSectionBase + sys.columnSectionPerStory * stories;
  const columns = buildColumnGrid(x, y, totalHeight, sys.bay_m, sectionSize);

  const palette: StructurePalette = {
    ...sys.palette,
    columnTint: computeColumnTint(massDensity),
  };

  const envelope: StructureEnvelope = { x, y, height: totalHeight, bboxScale };

  const metrics: StructureMetrics = {
    totalHeight,
    totalMass,
    footprintArea,
    massDensity,
    planAspect,
    slenderness,
    derivedPeriod,
    periodMismatchPct,
  };

  const isValid = warnings.every((w) => w.severity !== 'fatal');

  return {
    spec,
    envelope,
    stories: storiesArr,
    columns,
    slabs,
    palette,
    metrics,
    warnings,
    representation: [...STRUCTURE_FIELD_REPRESENTATION],
    isValid,
  };
};
