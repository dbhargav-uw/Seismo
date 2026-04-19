import { useRunSimulation } from '../features/viability/hooks';
import { useViabilityStore } from '../features/viability/store';

export const RunButton = (): JSX.Element => {
  const runSim = useRunSimulation();
  const site = useViabilityStore((s) => s.site);
  const scenarioId = useViabilityStore((s) => s.selectedScenarioId);
  const status = useViabilityStore((s) => s.resultStatus);

  const isLoading = status === 'loading';
  const disabled = !site || !scenarioId || isLoading;

  return (
    <button
      type="button"
      onClick={() => {
        void runSim();
      }}
      disabled={disabled}
      title={!site ? 'Pick a site on the map first' : !scenarioId ? 'Pick a scenario first' : ''}
      className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-ink font-semibold text-sm shadow-[0_4px_18px_rgba(56,189,248,0.30)] hover:bg-sky-300 hover:shadow-[0_6px_22px_rgba(56,189,248,0.40)] active:translate-y-px transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-accent/60 focus:ring-offset-2 focus:ring-offset-plate"
    >
      {isLoading ? (
        <>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Running…
        </>
      ) : (
        <>
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3 2l7 4-7 4z" />
          </svg>
          Run viability check
        </>
      )}
    </button>
  );
};
