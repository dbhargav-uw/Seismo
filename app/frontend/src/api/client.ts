import { env } from '../utils/env';
import { logger } from '../utils/logger';
import type {
  ApiError,
  ReceiverList,
  ScenarioDetail,
  ScenarioMeta,
  SimulateRequest,
  SimulateResult,
  SiteCoord,
  SiteHazardSummary,
  TerrainGrid,
} from './types';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string | null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code ?? undefined;
  }
}

const buildUrl = (path: string): string => `${env.apiBase}${path}`;

const parseError = async (res: Response): Promise<ApiClientError> => {
  let message = `Request failed (${res.status})`;
  let code: string | null | undefined;
  try {
    const body = (await res.json()) as ApiError;
    message = body.error ?? message;
    code = body.code;
  } catch {
    /* keep default */
  }
  return new ApiClientError(message, res.status, code);
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch (cause) {
    logger.error('network error for', path, cause);
    throw new ApiClientError('Network error — is the backend running?', 0, 'network');
  }
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
};

export const api = {
  health: async (): Promise<{ status: string }> => request('/api/health'),

  listScenarios: async (): Promise<ScenarioMeta[]> => request('/api/scenarios'),

  listReceivers: async (): Promise<ReceiverList> => request('/api/sites/receivers'),

  getScenario: async (scenarioId: string): Promise<ScenarioDetail> =>
    request(`/api/scenarios/${encodeURIComponent(scenarioId)}`),

  siteHazard: async (site: SiteCoord, scenarioId?: string): Promise<SiteHazardSummary> => {
    const query = scenarioId ? `?scenario_id=${encodeURIComponent(scenarioId)}` : '';
    return request(`/api/sites/hazard${query}`, {
      method: 'POST',
      body: JSON.stringify(site),
    });
  },

  simulate: async (payload: SimulateRequest): Promise<SimulateResult> =>
    request('/api/simulate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  terrain: async (site: SiteCoord, signal?: AbortSignal): Promise<TerrainGrid> =>
    request(
      `/api/terrain?lat=${encodeURIComponent(site.lat)}&lon=${encodeURIComponent(site.lon)}`,
      signal ? { signal } : undefined,
    ),
};
