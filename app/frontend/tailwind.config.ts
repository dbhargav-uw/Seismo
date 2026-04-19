import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#06090f',
        plate: '#0f1623',
        line: '#334062',
        muted: '#94a3b8',
        accent: '#38bdf8',
        ok: '#22c55e',
        warn: '#f59e0b',
        bad: '#ef4444',
      },
      boxShadow: {
        surface:
          '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 14px 30px -12px rgba(0,0,0,0.55)',
        control: '0 8px 24px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
