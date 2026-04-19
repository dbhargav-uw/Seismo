import type { StructureSpec } from '../../api/types';

export type WarningSeverity = 'info' | 'warn' | 'fatal';

export interface StructureWarning {
  field: keyof StructureSpec | 'general';
  message: string;
  severity: WarningSeverity;
}

export interface StructureEnvelope {
  /** Plan X dimension in meters. */
  x: number;
  /** Plan Y dimension in meters. */
  y: number;
  /** Total height in meters (stories · story_height_m). */
  height: number;
  /** Uniform world-unit scale so the largest dimension fits a target world size (~30 units). */
  bboxScale: number;
}

export interface StoryInfo {
  /** Zero-based; ground floor = 0. */
  index: number;
  /** Bottom elevation in meters. */
  zBottom: number;
  /** Top elevation in meters. */
  zTop: number;
  /** True for the topmost story. */
  isRoof: boolean;
  /** Mass in tonnes for this floor (currently uniform per floor). */
  mass_t: number;
}

export interface ColumnGrid {
  /** Bays in X (number of intervals; column count along X is nx + 1). */
  nx: number;
  /** Bays in Y. */
  ny: number;
  /** Plan positions for every column, centered around (0, 0). Each entry is `[x, z]` in meters. */
  positions: [number, number][];
  /** Square column section side in meters (used as boxGeometry input). */
  sectionSize: number;
  /** Total column height in meters. */
  height: number;
}

export interface SlabInfo {
  /** Top elevation of the slab in meters. */
  z: number;
  /** Slab thickness in meters. */
  thickness: number;
  /** True for the topmost (roof) slab. */
  isRoof: boolean;
}

export interface StructurePalette {
  /** Hex color for columns. */
  column: string;
  /** Hex color for typical-floor slabs. */
  slab: string;
  /** Hex color used for the roof slab tint. */
  roof: string;
  /** Hex color for the ground plane. */
  ground: string;
  /** Hint for the R3F drei `<Environment preset>` to use. */
  envHint: 'studio' | 'city';
  /** Tint multiplier in [0.7, 1.0], deeper as mass density increases. Applied by the renderer. */
  columnTint: number;
}

export interface StructureMetrics {
  /** Total height in meters. */
  totalHeight: number;
  /** Total mass in tonnes (stories · mass_per_floor_t). */
  totalMass: number;
  /** Footprint area in m². */
  footprintArea: number;
  /** Mass per floor area in t/m². */
  massDensity: number;
  /** Plan aspect ratio ≥ 1 (max(x/y, y/x)). */
  planAspect: number;
  /** Slenderness ratio = height / min(plan_x, plan_y). */
  slenderness: number;
  /** Engineering-derived fundamental period in seconds: T = c · H^0.75. */
  derivedPeriod: number;
  /** ((period_guess - derivedPeriod) / derivedPeriod) × 100, or null when no guess. */
  periodMismatchPct: number | null;
}

export type FieldRepresentation = 'visible' | 'analysis' | 'visible+analysis';

export interface FieldMeta {
  /** The form field this entry describes. */
  field: keyof StructureSpec;
  /** Where the field shows up in the UI. */
  representation: FieldRepresentation;
  /** Short human-readable description for tooltips/legends. */
  hint: string;
}

export interface NormalizedStructure {
  /** The validated input spec (echoed for convenience). */
  spec: StructureSpec;
  envelope: StructureEnvelope;
  stories: StoryInfo[];
  columns: ColumnGrid;
  slabs: SlabInfo[];
  palette: StructurePalette;
  metrics: StructureMetrics;
  warnings: StructureWarning[];
  /** Static per-field representation matrix; see {@link FieldMeta}. */
  representation: FieldMeta[];
  /** False when at least one warning has severity `'fatal'`. */
  isValid: boolean;
}
