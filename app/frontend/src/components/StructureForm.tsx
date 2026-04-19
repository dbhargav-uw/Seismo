import { type ChangeEvent, useId, useMemo, useState } from 'react';

import type { StructureSpec, StructureSystem } from '../api/types';
import {
  STRUCTURE_FIELD_REPRESENTATION,
  deriveStructureGeometry,
} from '../features/structure/geometry';
import {
  STRUCTURE_PRESETS,
  matchActivePreset,
} from '../features/structure/presets';
import type {
  FieldMeta,
  FieldRepresentation,
  StructureWarning,
} from '../features/structure/types';
import { useViabilityStore } from '../features/viability/store';

const SYSTEMS: { value: StructureSystem; label: string }[] = [
  { value: 'concrete_moment_frame', label: 'Concrete moment frame' },
  { value: 'steel_moment_frame', label: 'Steel moment frame' },
  { value: 'wood_light_frame', label: 'Wood light frame' },
  { value: 'masonry', label: 'Masonry' },
];

interface NumField {
  key: keyof StructureSpec;
  label: string;
  step: number;
  min: number;
  max: number;
}

const NUM_FIELDS: NumField[] = [
  { key: 'stories', label: 'Stories', step: 1, min: 1, max: 80 },
  { key: 'story_height_m', label: 'Story height (m)', step: 0.1, min: 0.1, max: 10 },
  { key: 'plan_x_m', label: 'Plan X (m)', step: 1, min: 1, max: 200 },
  { key: 'plan_y_m', label: 'Plan Y (m)', step: 1, min: 1, max: 200 },
  { key: 'mass_per_floor_t', label: 'Mass per floor (t)', step: 10, min: 10, max: 10000 },
  { key: 'period_guess_s', label: 'Period guess (s)', step: 0.05, min: 0.05, max: 10 },
];

const REP_BY_FIELD: Partial<Record<keyof StructureSpec, FieldMeta>> = (() => {
  const m: Partial<Record<keyof StructureSpec, FieldMeta>> = {};
  for (const r of STRUCTURE_FIELD_REPRESENTATION) m[r.field] = r;
  return m;
})();

const fmt = (n: number, digits = 1): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

const RepChip = ({ kind }: { kind: FieldRepresentation }): JSX.Element => {
  const chips: { label: string; cls: string; title: string }[] = [];
  if (kind === 'visible' || kind === 'visible+analysis') {
    chips.push({
      label: 'visible',
      title: 'Drives the 3D preview',
      cls: 'bg-accent/15 text-accent border-accent/40',
    });
  }
  if (kind === 'analysis' || kind === 'visible+analysis') {
    chips.push({
      label: 'analysis',
      title: 'Flows into /api/simulate',
      cls: 'bg-warn/15 text-warn border-warn/40',
    });
  }
  return (
    <span className="flex gap-1" aria-hidden="true">
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.title}
          className={`text-[9px] leading-none px-1.5 py-0.5 rounded border ${c.cls}`}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
};

interface MetricProps {
  label: string;
  value: string;
  toneClass?: string | undefined;
}

const Metric = ({ label, value, toneClass }: MetricProps): JSX.Element => (
  <div className="flex flex-col">
    <span className="text-muted text-[10px] uppercase tracking-wider">{label}</span>
    <span className={`text-slate-100 ${toneClass ?? ''}`}>{value}</span>
  </div>
);

const tonalForMismatch = (pct: number | null): string | undefined => {
  if (pct == null) return undefined;
  const a = Math.abs(pct);
  if (a > 50) return 'text-warn';
  if (a > 20) return 'text-accent';
  return 'text-ok';
};

export const StructureForm = (): JSX.Element => {
  const structure = useViabilityStore((s) => s.structure);
  const setStructure = useViabilityStore((s) => s.setStructure);

  const normalized = useMemo(() => deriveStructureGeometry(structure), [structure]);
  const activePreset = useMemo(() => matchActivePreset(structure), [structure]);

  const warningsByField = useMemo(() => {
    const map: Partial<Record<keyof StructureSpec | 'general', StructureWarning[]>> = {};
    for (const w of normalized.warnings) {
      const list = map[w.field] ?? [];
      list.push(w);
      map[w.field] = list;
    }
    return map;
  }, [normalized.warnings]);

  const periodMismatch =
    normalized.metrics.periodMismatchPct != null &&
    Math.abs(normalized.metrics.periodMismatchPct) > 50;

  const handleNumber =
    (key: keyof StructureSpec) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      const parsed = Number.parseFloat(e.target.value);
      if (!Number.isFinite(parsed)) return;
      setStructure({ [key]: parsed } as Partial<StructureSpec>);
    };

  const handlePreset = (presetId: typeof STRUCTURE_PRESETS[number]['id']) => (): void => {
    const preset = STRUCTURE_PRESETS.find((p) => p.id === presetId);
    if (preset) setStructure(preset.patch);
  };

  const useDerivedPeriod = (): void => {
    setStructure({ period_guess_s: Number(normalized.metrics.derivedPeriod.toFixed(2)) });
  };

  const errorIdBase = useId();
  const [derivedOpen, setDerivedOpen] = useState<boolean>(true);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="label">Structure</div>
        <div className="text-[10px] text-muted">Pick a preset, then tweak.</div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Structure presets">
        {STRUCTURE_PRESETS.map((p) => {
          const active = activePreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={handlePreset(p.id)}
              aria-pressed={active}
              title={p.description}
              className={`pill border transition-colors text-[11px] ${
                active
                  ? 'bg-accent/20 text-accent border-accent/50'
                  : 'bg-line/30 text-slate-200 border-line hover:border-accent/40 hover:text-accent'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {NUM_FIELDS.map((f) => {
          const meta = REP_BY_FIELD[f.key];
          const fatal = (warningsByField[f.key] ?? []).find((w) => w.severity === 'fatal');
          const errorId = fatal ? `${errorIdBase}-${f.key}-error` : undefined;
          return (
            <label key={f.key} className="block space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{f.label}</span>
                {meta && <RepChip kind={meta.representation} />}
              </div>
              <input
                className={`input ${fatal ? 'border-bad focus:border-bad' : ''}`}
                type="number"
                step={f.step}
                min={f.min}
                max={f.max}
                value={structure[f.key] ?? ''}
                onChange={handleNumber(f.key)}
                aria-invalid={!!fatal}
                aria-describedby={errorId}
              />
              {fatal && (
                <p id={errorId} className="text-[10px] text-bad" role="alert">
                  {fatal.message}
                </p>
              )}
            </label>
          );
        })}

        <label className="col-span-2 block space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">System</span>
            {REP_BY_FIELD.system && <RepChip kind={REP_BY_FIELD.system.representation} />}
          </div>
          <select
            className="input"
            value={structure.system}
            onChange={(e) => setStructure({ system: e.target.value as StructureSystem })}
          >
            {SYSTEMS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {periodMismatch && (
        <div
          className="flex items-start gap-2 bg-warn/10 border border-warn/30 rounded p-2 text-[11px]"
          role="status"
        >
          <span className="text-warn mt-0.5" aria-hidden="true">⚠</span>
          <div className="flex-1">
            <div>
              Period guess differs{' '}
              <strong className="text-warn">
                {Math.abs(normalized.metrics.periodMismatchPct ?? 0).toFixed(0)}%
              </strong>{' '}
              from engineering estimate ({fmt(normalized.metrics.derivedPeriod, 2)} s).
            </div>
            <button
              type="button"
              onClick={useDerivedPeriod}
              className="mt-0.5 text-accent hover:underline underline-offset-2"
            >
              Use derived ({fmt(normalized.metrics.derivedPeriod, 2)} s)
            </button>
          </div>
        </div>
      )}

      <details
        open={derivedOpen}
        onToggle={(e) => setDerivedOpen(e.currentTarget.open)}
        className="border-t border-line/60 pt-3 [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex items-center justify-between cursor-pointer list-none text-xs select-none">
          <span className="label">Derived</span>
          <span className="flex items-center gap-2 text-muted">
            {derivedOpen ? (
              <span>Hide</span>
            ) : (
              <span>
                {`H ${fmt(normalized.metrics.totalHeight)} m · T ${fmt(normalized.metrics.derivedPeriod, 2)} s`}
              </span>
            )}
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className={`w-3 h-3 transition-transform ${derivedOpen ? 'rotate-180' : ''}`}
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
          <Metric label="Height" value={`${fmt(normalized.metrics.totalHeight)} m`} />
          <Metric
            label="Footprint"
            value={`${fmt(normalized.metrics.footprintArea, 0)} m²`}
          />
          <Metric label="Slenderness" value={fmt(normalized.metrics.slenderness, 2)} />
          <Metric
            label="Total mass"
            value={`${fmt(normalized.metrics.totalMass, 0)} t`}
          />
          <Metric
            label="Density"
            value={`${fmt(normalized.metrics.massDensity, 2)} t/m²`}
          />
          <Metric
            label="Derived T"
            value={`${fmt(normalized.metrics.derivedPeriod, 2)} s`}
            toneClass={tonalForMismatch(normalized.metrics.periodMismatchPct)}
          />
        </div>
      </details>
    </div>
  );
};
