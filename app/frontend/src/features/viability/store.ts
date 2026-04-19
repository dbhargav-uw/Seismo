import { create } from 'zustand';

import type {
  ScenarioMeta,
  SimulateResult,
  SiteCoord,
  StructureSpec,
  TerrainGrid,
} from '../../api/types';
import { collapseAutoTriggered } from '../structure/responseShape';

type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';
export type ResponseExaggeration = number | 'auto';
export type ResponseMode = 'shape' | 'playback' | 'collapse';

interface ViabilityState {
  site: SiteCoord | null;
  setSite: (s: SiteCoord) => void;

  structure: StructureSpec;
  setStructure: (patch: Partial<StructureSpec>) => void;

  scenarios: ScenarioMeta[];
  scenariosStatus: AsyncStatus;
  scenariosError: string | null;
  setScenarios: (s: ScenarioMeta[]) => void;
  setScenariosStatus: (status: AsyncStatus, error?: string) => void;

  selectedScenarioId: string | null;
  setSelectedScenarioId: (id: string | null) => void;

  result: SimulateResult | null;
  resultStatus: AsyncStatus;
  resultError: string | null;
  /** Setting an OpenSees result snapshots the structure and seeds the viz
   *  state. Pass `vizEnabled: false` to keep the animation paused on arrival
   *  (used to honor `prefers-reduced-motion`). */
  setResult: (r: SimulateResult | null, opts?: { vizEnabled?: boolean }) => void;
  setResultStatus: (status: AsyncStatus, error?: string) => void;

  /** Snapshot of the structure spec at the moment the current result landed.
   *  Compared against `structure` to detect stale results. Null when no
   *  result is loaded. */
  resultStructureSpec: StructureSpec | null;

  /** Whether the response visualization animation is running. Reset to true
   *  on each new OpenSees result; the UI can flip it via `setResponseVizEnabled`. */
  responseVizEnabled: boolean;
  setResponseVizEnabled: (enabled: boolean) => void;

  /** 'auto' = pick one based on real magnitudes; number = literal multiplier.
   *  Reset to 'auto' on each new OpenSees result. */
  responseExaggeration: ResponseExaggeration;
  setResponseExaggeration: (e: ResponseExaggeration) => void;

  /** Which visualization mode the animator runs: 'shape' = sinusoidal first-mode
   *  sway driven by peak_idr_per_story; 'playback' = real-time replay of the
   *  per-floor displacement history; 'collapse' = conceptual pancake-collapse
   *  animation of slabs above the failure plane. Reset to 'shape' on each new
   *  OpenSees result so users see the deflected-shape summary first. */
  responseMode: ResponseMode;
  setResponseMode: (mode: ResponseMode) => void;

  /** Bumped to re-run the collapse animation while staying in collapse mode.
   *  The animator effect lists this as a dep so a bump captures a fresh
   *  swayHandoff and restarts the sequence from t=0. Reset to 0 on each new
   *  OpenSees result. */
  collapseReplayToken: number;
  replayCollapse: () => void;

  /** Local heightfield around the current site. Null when no site is pinned
   *  or when a fetch is in flight / failed. The scene falls back to the flat
   *  GroundSlab when null. */
  terrain: TerrainGrid | null;
  terrainStatus: AsyncStatus;
  terrainError: string | null;
  setTerrain: (t: TerrainGrid | null) => void;
  setTerrainStatus: (status: AsyncStatus, error?: string) => void;
}

const DEFAULT_STRUCTURE: StructureSpec = {
  stories: 5,
  story_height_m: 3.0,
  plan_x_m: 20.0,
  plan_y_m: 20.0,
  mass_per_floor_t: 500.0,
  period_guess_s: 0.5,
  system: 'concrete_moment_frame',
};

export const useViabilityStore = create<ViabilityState>((set) => ({
  site: null,
  setSite: (s) => set({ site: s }),

  structure: DEFAULT_STRUCTURE,
  setStructure: (patch) =>
    set((state) => ({ structure: { ...state.structure, ...patch } })),

  scenarios: [],
  scenariosStatus: 'idle',
  scenariosError: null,
  setScenarios: (s) => set({ scenarios: s }),
  setScenariosStatus: (status, error) =>
    set({ scenariosStatus: status, scenariosError: error ?? null }),

  selectedScenarioId: null,
  setSelectedScenarioId: (id) => set({ selectedScenarioId: id }),

  result: null,
  resultStatus: 'idle',
  resultError: null,
  setResult: (r, opts) =>
    set((state) => {
      if (r && r.physics_backend === 'opensees') {
        // Auto-engage collapse mode when peak inter-story drift exceeds the
        // engineering collapse-prevention threshold. Real Scripps demo data
        // is sub-millipercent IDR and stays in 'shape'; only over-threshold
        // results trip directly to collapse on result land.
        const autoCollapse = collapseAutoTriggered(r.peak_idr_per_story ?? []);
        return {
          result: r,
          resultStructureSpec: state.structure,
          responseVizEnabled: opts?.vizEnabled ?? true,
          responseExaggeration: 'auto',
          responseMode: autoCollapse ? 'collapse' : 'shape',
          collapseReplayToken: 0,
        };
      }
      return { result: r, resultStructureSpec: null, collapseReplayToken: 0 };
    }),
  setResultStatus: (status, error) =>
    set({ resultStatus: status, resultError: error ?? null }),

  resultStructureSpec: null,

  responseVizEnabled: true,
  setResponseVizEnabled: (enabled) => set({ responseVizEnabled: enabled }),

  responseExaggeration: 'auto',
  setResponseExaggeration: (e) => set({ responseExaggeration: e }),

  responseMode: 'shape',
  setResponseMode: (mode) => set({ responseMode: mode }),

  collapseReplayToken: 0,
  replayCollapse: () =>
    set((state) => ({ collapseReplayToken: state.collapseReplayToken + 1 })),

  terrain: null,
  terrainStatus: 'idle',
  terrainError: null,
  setTerrain: (t) => set({ terrain: t }),
  setTerrainStatus: (status, error) =>
    set({ terrainStatus: status, terrainError: error ?? null }),
}));

/** Shallow-equality stale check: any field of the live structure spec that
 *  differs from the snapshot taken when the result landed marks it stale. */
export const isResultStale = (state: ViabilityState): boolean => {
  if (!state.result || !state.resultStructureSpec) return false;
  const a = state.structure;
  const b = state.resultStructureSpec;
  return (
    a.stories !== b.stories ||
    a.story_height_m !== b.story_height_m ||
    a.plan_x_m !== b.plan_x_m ||
    a.plan_y_m !== b.plan_y_m ||
    a.mass_per_floor_t !== b.mass_per_floor_t ||
    a.period_guess_s !== b.period_guess_s ||
    a.system !== b.system
  );
};
