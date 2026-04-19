import type { StructureSpec } from '../../api/types';

export type StructurePresetId = 'low_rise' | 'mid_rise' | 'high_rise';

export interface StructurePreset {
  id: StructurePresetId;
  label: string;
  description: string;
  /** Full spec — applying a preset overwrites every field. */
  patch: StructureSpec;
}

export const STRUCTURE_PRESETS: readonly StructurePreset[] = [
  {
    id: 'low_rise',
    label: 'Low-rise',
    description: '3-story wood frame · 12 × 16 m',
    patch: {
      stories: 3,
      story_height_m: 3.0,
      plan_x_m: 12,
      plan_y_m: 16,
      mass_per_floor_t: 200,
      period_guess_s: 0.25,
      system: 'wood_light_frame',
    },
  },
  {
    id: 'mid_rise',
    label: 'Mid-rise',
    description: '8-story concrete · 20 × 24 m',
    patch: {
      stories: 8,
      story_height_m: 3.5,
      plan_x_m: 20,
      plan_y_m: 24,
      mass_per_floor_t: 700,
      period_guess_s: 0.7,
      system: 'concrete_moment_frame',
    },
  },
  {
    id: 'high_rise',
    label: 'High-rise',
    description: '20-story steel · 30 × 30 m',
    patch: {
      stories: 20,
      story_height_m: 4.0,
      plan_x_m: 30,
      plan_y_m: 30,
      mass_per_floor_t: 1200,
      period_guess_s: 1.8,
      system: 'steel_moment_frame',
    },
  },
];

const PRESET_KEYS = [
  'stories',
  'story_height_m',
  'plan_x_m',
  'plan_y_m',
  'mass_per_floor_t',
  'period_guess_s',
  'system',
] as const;

const numericEqual = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/**
 * Returns the matching preset id when every preset field equals the spec, or null.
 * Useful for highlighting the active preset chip in the form.
 */
export const matchActivePreset = (spec: StructureSpec): StructurePresetId | null => {
  for (const preset of STRUCTURE_PRESETS) {
    const allMatch = PRESET_KEYS.every((k) => {
      const a = preset.patch[k];
      const b = spec[k];
      if (typeof a === 'number' && typeof b === 'number') return numericEqual(a, b);
      return a === b;
    });
    if (allMatch) return preset.id;
  }
  return null;
};
