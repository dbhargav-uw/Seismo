import type { StructureSystem } from '../../api/types';

export interface SystemMaterial {
  /** Target column-grid bay spacing in meters. */
  bay_m: number;
  /** Baseline column-section side length in meters at 1 story. */
  columnSectionBase: number;
  /** Additional column-section side length per story. */
  columnSectionPerStory: number;
  /** Slab thickness in meters. */
  slabThickness: number;
  /**
   * Period coefficient for `T = c · H^0.75`. Mirrors the per-system
   * coefficients in `app/backend/app/services/scoring.py` so the frontend's
   * derived period matches the backend's analysis path.
   */
  periodCoefficient: number;
  /** Visual palette base (the renderer applies a mass-density tint on top). */
  palette: {
    column: string;
    slab: string;
    roof: string;
    ground: string;
    envHint: 'studio' | 'city';
  };
}

const ROOF = '#38bdf8';
const GROUND = '#0b0f17';

export const SYSTEM_MATERIALS: Record<StructureSystem, SystemMaterial> = {
  concrete_moment_frame: {
    bay_m: 6.0,
    columnSectionBase: 0.30,
    columnSectionPerStory: 0.015,
    slabThickness: 0.20,
    periodCoefficient: 0.073,
    palette: {
      column: '#94a3b8',
      slab: '#475569',
      roof: ROOF,
      ground: GROUND,
      envHint: 'city',
    },
  },
  steel_moment_frame: {
    bay_m: 6.0,
    columnSectionBase: 0.20,
    columnSectionPerStory: 0.010,
    slabThickness: 0.15,
    periodCoefficient: 0.085,
    palette: {
      column: '#7dd3fc',
      slab: '#3f4a5b',
      roof: ROOF,
      ground: GROUND,
      envHint: 'city',
    },
  },
  wood_light_frame: {
    bay_m: 4.0,
    columnSectionBase: 0.15,
    columnSectionPerStory: 0.0,
    slabThickness: 0.10,
    periodCoefficient: 0.060,
    palette: {
      column: '#d6a76b',
      slab: '#7a5a37',
      roof: ROOF,
      ground: GROUND,
      envHint: 'studio',
    },
  },
  masonry: {
    bay_m: 4.0,
    columnSectionBase: 0.30,
    columnSectionPerStory: 0.0,
    slabThickness: 0.20,
    periodCoefficient: 0.050,
    palette: {
      column: '#c8995a',
      slab: '#6b4f30',
      roof: ROOF,
      ground: GROUND,
      envHint: 'city',
    },
  },
};
