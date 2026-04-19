import { useEffect } from 'react';

import { ApiClientError, api } from '../../api/client';
import { logger } from '../../utils/logger';
import { usePrefersReducedMotion } from '../../utils/motion';
import { useViabilityStore } from './store';

export const useLoadScenarios = (): void => {
  const setScenarios = useViabilityStore((s) => s.setScenarios);
  const setStatus = useViabilityStore((s) => s.setScenariosStatus);
  const setSelected = useViabilityStore((s) => s.setSelectedScenarioId);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .listScenarios()
      .then((list) => {
        if (cancelled) return;
        setScenarios(list);
        setStatus('success');
        if (list.length > 0 && list[0]) {
          setSelected(list[0].scenario_id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof ApiClientError ? err.message : 'Failed to load scenarios';
        logger.error('listScenarios failed', err);
        setStatus('error', msg);
      });
    return () => {
      cancelled = true;
    };
  }, [setScenarios, setSelected, setStatus]);
};

/**
 * Fetches the local terrain heightfield on site change, debounced at 250 ms so
 * dragging the map marker doesn't spam the backend. Each fetch is cancellable
 * via AbortController; only the most-recent response is committed to the store.
 */
export const useTerrainFetch = (): void => {
  const site = useViabilityStore((s) => s.site);
  const setTerrain = useViabilityStore((s) => s.setTerrain);
  const setStatus = useViabilityStore((s) => s.setTerrainStatus);

  useEffect(() => {
    if (!site) {
      setStatus('idle');
      setTerrain(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus('loading');
      api
        .terrain(site, controller.signal)
        .then((grid) => {
          if (controller.signal.aborted) return;
          setTerrain(grid);
          setStatus('success');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const msg = err instanceof ApiClientError ? err.message : 'Terrain fetch failed';
          logger.warn('terrain fetch failed', err);
          setStatus('error', msg);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [site, setTerrain, setStatus]);
};

export const useRunSimulation = (): (() => Promise<void>) => {
  const site = useViabilityStore((s) => s.site);
  const structure = useViabilityStore((s) => s.structure);
  const scenarioId = useViabilityStore((s) => s.selectedScenarioId);
  const setResult = useViabilityStore((s) => s.setResult);
  const setStatus = useViabilityStore((s) => s.setResultStatus);
  const prefersReducedMotion = usePrefersReducedMotion();

  return async (): Promise<void> => {
    if (!site) {
      setStatus('error', 'Pick a site on the map first.');
      return;
    }
    if (!scenarioId) {
      setStatus('error', 'Choose a scenario first.');
      return;
    }
    setStatus('loading');
    try {
      const result = await api.simulate({ site, structure, scenario_id: scenarioId });
      setResult(result, { vizEnabled: !prefersReducedMotion });
      setStatus('success');
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Simulation failed';
      logger.error('simulate failed', err);
      setResult(null);
      setStatus('error', msg);
    }
  };
};
