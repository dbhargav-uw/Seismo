import { z } from 'zod';

const DEFAULT_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const EnvSchema = z.object({
  VITE_MAP_STYLE: z.string().trim().min(1).default(DEFAULT_MAP_STYLE),
  VITE_API_BASE: z.string().trim().default(''),
});

const parsed = EnvSchema.safeParse({
  VITE_MAP_STYLE: import.meta.env.VITE_MAP_STYLE,
  VITE_API_BASE: import.meta.env.VITE_API_BASE,
});

if (!parsed.success) {
  throw new Error(`Invalid env: ${parsed.error.message}`);
}

export const env = {
  mapStyle: parsed.data.VITE_MAP_STYLE,
  apiBase: parsed.data.VITE_API_BASE,
} as const;
