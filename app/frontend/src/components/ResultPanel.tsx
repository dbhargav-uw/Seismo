import { useEffect, useState } from 'react';

import {
  COLLAPSE_THRESHOLD_IDR,
  autoExaggeration,
  collapseAutoTriggered,
  collapseFailureStoryIdx,
} from '../features/structure/responseShape';
import { isResultStale, useViabilityStore } from '../features/viability/store';

const formatClock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
};

/**
 * Lightweight playback-progress poller. Runs only when the playback mode
 * is active and a valid total duration is known. Updates state at 4 Hz so
 * the panel does not re-render at 60 Hz alongside the R3F animator.
 */
const usePlaybackProgress = (
  active: boolean,
  totalDurationS: number,
): { elapsedS: number; loop: number } => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      setTick(0);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      setTick((performance.now() - start) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [active, totalDurationS]);

  if (!active || totalDurationS <= 0) return { elapsedS: 0, loop: 0 };
  const elapsedS = tick % totalDurationS;
  const loop = Math.floor(tick / totalDurationS) + 1;
  return { elapsedS, loop };
};

const formatPct = (v: number): string => `${(v * 100).toFixed(0)}%`;

/**
 * Drift ratios from typical Scripps demo motions are sub-millipercent and
 * round to a meaningless "0.00%" with naïve `.toFixed(2)`. Adaptive precision:
 *   ≥ 0.1%   → two-decimal fixed   ("1.23%")
 *   > 0      → 1-sig-fig scientific ("5.6e-5%")
 *   = 0      → "0%"
 */
const formatDriftPct = (drift: number): string => {
  const pct = Math.abs(drift) * 100;
  if (pct === 0) return '0%';
  if (pct >= 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toExponential(1)}%`;
};

/**
 * Roof displacement from typical Scripps demo motions is in the
 * tens-of-microns range; rounding to integer mm gives a meaningless "0 mm".
 * Same adaptive principle as the drift formatter:
 *   ≥ 1 mm     → fixed mm with one decimal
 *   ≥ 1 µm     → integer micrometers
 *   > 0        → 1-sig-fig scientific in mm
 *   = 0        → "0 mm"
 */
const formatRoofDispMm = (m: number): string => {
  if (m === 0) return '0 mm';
  const mm = Math.abs(m) * 1000;
  if (mm >= 1) return `${mm.toFixed(1)} mm`;
  if (mm >= 0.001) return `${(mm * 1000).toFixed(0)} µm`;
  return `${mm.toExponential(1)} mm`;
};

const formatExaggerationFactor = (f: number): string => {
  if (f >= 1000) return `${(f / 1000).toFixed(0)}k×`;
  if (f >= 10) return `${f.toFixed(0)}×`;
  return `${f.toFixed(1)}×`;
};

const tone = (score: number): string => {
  if (score < 0.33) return 'text-ok';
  if (score < 0.66) return 'text-warn';
  return 'text-bad';
};

export const ResultPanel = (): JSX.Element => {
  const status = useViabilityStore((s) => s.resultStatus);
  const error = useViabilityStore((s) => s.resultError);
  const result = useViabilityStore((s) => s.result);
  const site = useViabilityStore((s) => s.site);
  const scenarioId = useViabilityStore((s) => s.selectedScenarioId);
  const structure = useViabilityStore((s) => s.structure);
  const stale = useViabilityStore(isResultStale);
  const responseVizEnabled = useViabilityStore((s) => s.responseVizEnabled);
  const setResponseVizEnabled = useViabilityStore((s) => s.setResponseVizEnabled);
  const responseMode = useViabilityStore((s) => s.responseMode);
  const setResponseMode = useViabilityStore((s) => s.setResponseMode);
  const replayCollapse = useViabilityStore((s) => s.replayCollapse);

  if (status === 'idle') {
    return (
      <div className="card text-sm text-muted">
        <div className="label mb-2">Viability result</div>
        {!site ? (
          <p>Pick a site on the map.</p>
        ) : !scenarioId ? (
          <p>Choose a scenario.</p>
        ) : (
          <p>Press <span className="text-accent">Run viability check</span> to compute.</p>
        )}
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="card text-sm text-muted">
        <div className="label mb-2">Viability result</div>
        <p>Running…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card text-sm">
        <div className="label mb-2">Viability result</div>
        <div className="text-bad">{error ?? 'Simulation failed.'}</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="card text-sm text-muted">
        <div className="label mb-2">Viability result</div>
        <p>No result.</p>
      </div>
    );
  }

  const b = result.score.breakdown;
  const showResponseViz =
    !stale &&
    result.physics_backend === 'opensees' &&
    result.peak_idr_per_story != null &&
    result.peak_idr_per_story.length > 0 &&
    result.peak_roof_disp_m != null &&
    result.eigen_T1_s != null;
  const exaggerationFactor = showResponseViz
    ? autoExaggeration({
        peak_roof_disp_m: result.peak_roof_disp_m as number,
        plan_x_m: structure.plan_x_m,
        plan_y_m: structure.plan_y_m,
      })
    : null;
  const playbackAvailable =
    showResponseViz &&
    result.floor_disp_history_m != null &&
    result.floor_disp_history_m.length > 0 &&
    result.history_dt_s != null &&
    result.history_dt_s > 0;
  const playbackTotalDurationS =
    playbackAvailable && result.floor_disp_history_m && result.history_dt_s
      ? (result.floor_disp_history_m.length - 1) * result.history_dt_s
      : 0;
  const playbackActive = responseVizEnabled && responseMode === 'playback' && playbackAvailable;
  const { elapsedS, loop } = usePlaybackProgress(playbackActive, playbackTotalDurationS);

  const failureStoryIdx = showResponseViz
    ? collapseFailureStoryIdx(result.peak_idr_per_story ?? [])
    : -1;
  // Collapse animation needs a non-zero failure plane to be meaningful. With
  // all-zero IDR (degenerate / pre-run), we hide the pill rather than show a
  // mode that does nothing.
  const collapseAvailable = showResponseViz && failureStoryIdx >= 0;
  const collapseAutoFires =
    showResponseViz && collapseAutoTriggered(result.peak_idr_per_story ?? []);
  const peakIDRForBanner = showResponseViz
    ? Math.max(...(result.peak_idr_per_story ?? []).map(Math.abs), 0)
    : 0;
  const collapseActive = collapseAvailable && responseMode === 'collapse';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div className="label">Viability result</div>
        <span className="pill bg-warn/10 text-warn border border-warn/40">
          conceptual screening
        </span>
      </div>
      {stale && (
        <div className="mt-1 mb-2 text-xs italic text-warn">
          Result out of date — structure changed since the last run. Run again to refresh.
        </div>
      )}
      <div className="flex items-baseline gap-3">
        <div className={`text-4xl font-semibold ${tone(result.score.total)}`}>
          {formatPct(result.score.total)}
        </div>
        <div className="text-xs text-muted">
          higher = more concern · {result.scenario.label}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4 text-sm">
        <dt className="text-muted">Site PGV</dt>
        <dd>{(result.pgv_at_site_mps * 1000).toFixed(2)} mm/s</dd>
        <dt className="text-muted">Estimated period</dt>
        <dd>{result.estimated_period_s.toFixed(2)} s</dd>
        <dt className="text-muted">Peak drift ratio</dt>
        <dd>{formatDriftPct(result.peak_drift_ratio)}</dd>
        <dt className="text-muted">Peak accel</dt>
        <dd>{result.peak_accel_g.toFixed(3)} g</dd>
        <dt className="text-muted">Nearest receiver</dt>
        <dd>
          R{String(result.nearest_receiver_id).padStart(2, '0')} ({result.nearest_distance_km.toFixed(1)} km)
        </dd>
        {result.peak_roof_disp_m != null && (
          <>
            <dt className="text-muted">Roof displacement</dt>
            <dd>{formatRoofDispMm(result.peak_roof_disp_m)}</dd>
          </>
        )}
        {result.base_shear_kN != null && (
          <>
            <dt className="text-muted">Base shear</dt>
            <dd>{result.base_shear_kN.toFixed(0)} kN</dd>
          </>
        )}
      </dl>

      {result.peak_idr_per_story && result.peak_idr_per_story.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1">Per-story drift</div>
          <div className="flex flex-wrap gap-1">
            {result.peak_idr_per_story.map((d, i) => {
              const label = formatDriftPct(d);
              const t = tone(Math.abs(d) / 0.025);
              return (
                <span
                  key={i}
                  title={`Story ${i + 1}: ${label} drift`}
                  className={`pill bg-line/40 border border-line ${t}`}
                >
                  S{i + 1} · {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {showResponseViz && exaggerationFactor != null && (
        <div className="mt-4 text-xs">
          {collapseAutoFires && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-warn">
              <span>
                ⚠ Peak inter-story drift {formatDriftPct(peakIDRForBanner)} exceeds
                collapse-prevention threshold ({formatDriftPct(COLLAPSE_THRESHOLD_IDR)})
                {responseMode === 'collapse' ? ' — building auto-collapsed.' : '.'}
              </span>
              <button
                type="button"
                onClick={() =>
                  setResponseMode(responseMode === 'collapse' ? 'shape' : 'collapse')
                }
                className="shrink-0 rounded border border-warn/60 bg-warn/10 px-2 py-1 text-warn hover:bg-warn/20 focus:outline-none focus:ring-2 focus:ring-warn/40"
              >
                {responseMode === 'collapse' ? 'Show shape' : 'Show collapse'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div
              className="text-muted"
              title="The deflected shape is from the OpenSees run; the motion is visually scaled so the shape is readable. The literal roof displacement is shown in the row above; literal-scale motion would be invisible at typical demo amplitudes."
            >
              Response visualization · visually scaled (Auto: {formatExaggerationFactor(exaggerationFactor)})
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setResponseMode('shape')}
                aria-pressed={responseMode === 'shape'}
                title="First-mode deflected shape, sinusoidal sway"
                className={`px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  responseMode === 'shape'
                    ? 'border-accent/60 text-accent bg-accent/5'
                    : 'border-line bg-ink/40 text-muted hover:bg-ink/70 hover:text-accent'
                }`}
              >
                Shape
              </button>
              <button
                type="button"
                onClick={() => playbackAvailable && setResponseMode('playback')}
                aria-pressed={responseMode === 'playback'}
                disabled={!playbackAvailable}
                title={
                  playbackAvailable
                    ? 'Real-time replay of the OpenSees displacement history'
                    : 'Time-history not available for this run'
                }
                className={`px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                  responseMode === 'playback'
                    ? 'border-accent/60 text-accent bg-accent/5'
                    : 'border-line bg-ink/40 text-muted hover:bg-ink/70 hover:text-accent'
                }`}
              >
                Playback
              </button>
              <button
                type="button"
                onClick={() => collapseAvailable && setResponseMode('collapse')}
                aria-pressed={responseMode === 'collapse'}
                disabled={!collapseAvailable}
                title={
                  collapseAvailable
                    ? collapseAutoFires
                      ? 'Conceptual pancake-collapse animation — drift exceeds collapse-prevention threshold'
                      : 'Preview the conceptual pancake-collapse mechanism (drift below threshold; for illustration)'
                    : 'Collapse preview unavailable — no per-story drift data'
                }
                className={`px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-warn/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                  responseMode === 'collapse'
                    ? 'border-warn/60 text-warn bg-warn/10'
                    : 'border-line bg-ink/40 text-muted hover:bg-ink/70 hover:text-warn'
                }`}
              >
                Collapse
              </button>
              <button
                type="button"
                onClick={() => setResponseVizEnabled(!responseVizEnabled)}
                aria-pressed={responseVizEnabled}
                aria-label={responseVizEnabled ? 'Pause response animation' : 'Play response animation'}
                className="ml-1 px-2 py-1 rounded border border-line bg-ink/40 hover:bg-ink/70 hover:border-accent/60 text-muted hover:text-accent transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {responseVizEnabled ? '⏸ Pause' : '▶ Play'}
              </button>
            </div>
          </div>
          {playbackActive && playbackTotalDurationS > 0 && (
            <div className="mt-1 text-muted">
              {result.converged === false ? 'Partial trace' : 'Playing trace'} ·{' '}
              {formatClock(elapsedS)} / {formatClock(playbackTotalDurationS)} · loop {loop}
            </div>
          )}
          {collapseActive && (
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-muted">
                Conceptual collapse · failure at story {failureStoryIdx + 1} (peak{' '}
                {formatDriftPct(peakIDRForBanner)})
              </span>
              <button
                type="button"
                onClick={replayCollapse}
                title="Replay the collapse animation from the start"
                className="rounded border border-line bg-ink/40 px-2 py-1 text-muted transition-colors hover:bg-ink/70 hover:border-warn/60 hover:text-warn focus:outline-none focus:ring-2 focus:ring-warn/40"
              >
                ↻ Replay
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="label mb-1">Score breakdown</div>
        {(
          [
            ['Site hazard', b.site_hazard],
            ['Ground failure', b.ground_failure],
            ['Structural response', b.structural_response],
            ['Uncertainty penalty', b.uncertainty_penalty],
          ] as const
        ).map(([name, v]) => (
          <div key={name} className="mb-1">
            <div className="flex justify-between text-xs">
              <span>{name}</span>
              <span>{formatPct(v)}</span>
            </div>
            <div className="h-1.5 bg-line rounded">
              <div
                className={`h-full rounded ${tone(v).replace('text-', 'bg-')}`}
                style={{ width: `${Math.round(v * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="label mb-1">Top drivers</div>
        <ul className="text-sm list-disc list-inside text-slate-200">
          {result.score.top_drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>

      {result.notes.length > 0 && (
        <div className="mt-4 text-xs text-muted space-y-0.5">
          {result.notes.map((n) => (
            <div key={n}>· {n}</div>
          ))}
        </div>
      )}
    </div>
  );
};
