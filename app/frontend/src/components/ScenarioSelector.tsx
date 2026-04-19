import { useViabilityStore } from '../features/viability/store';

export const ScenarioSelector = (): JSX.Element => {
  const scenarios = useViabilityStore((s) => s.scenarios);
  const status = useViabilityStore((s) => s.scenariosStatus);
  const error = useViabilityStore((s) => s.scenariosError);
  const selected = useViabilityStore((s) => s.selectedScenarioId);
  const setSelected = useViabilityStore((s) => s.setSelectedScenarioId);

  return (
    <div className="card">
      <div className="label mb-2">Scenario</div>
      {status === 'loading' && <div className="text-sm text-muted">Loading scenarios…</div>}
      {status === 'error' && (
        <div className="text-sm text-bad">
          {error ?? 'Failed to load scenarios.'}{' '}
          <span className="text-muted">(Run the preprocessing scripts and restart the backend.)</span>
        </div>
      )}
      {status === 'success' && scenarios.length === 0 && (
        <div className="text-sm text-muted">No scenarios in the catalog.</div>
      )}
      {status === 'success' && scenarios.length > 0 && (
        <div className="space-y-1">
          {scenarios.map((s) => (
            <label key={s.scenario_id} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="scenario"
                className="mt-1"
                checked={selected === s.scenario_id}
                onChange={() => setSelected(s.scenario_id)}
              />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
