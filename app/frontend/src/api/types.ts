// Mirrors app/backend/app/models/*.py — keep in sync.

export interface SiteCoord {
  lat: number;
  lon: number;
}

export interface ReceiverRef {
  receiver_id: number;
  label: string;
  lat: number;
  lon: number;
  distance_km: number;
  vs30_proxy_mps: number;
}

export interface SiteHazardSummary {
  site: SiteCoord;
  nearest_receivers: ReceiverRef[];
  vs30_proxy_mps: number;
  pgv_estimate_mps: number;
  synthetic_for_demo: boolean;
  notes: string[];
}

export interface ReceiverInfo {
  receiver_id: number;
  label: string;
  lat: number;
  lon: number;
  elevation_m: number;
  vs30_proxy_mps: number;
}

export interface ReceiverList {
  synthetic_for_demo: boolean;
  receivers: ReceiverInfo[];
}

export type StructureSystem =
  | 'concrete_moment_frame'
  | 'steel_moment_frame'
  | 'wood_light_frame'
  | 'masonry';

export interface StructureSpec {
  stories: number;
  story_height_m: number;
  plan_x_m: number;
  plan_y_m: number;
  mass_per_floor_t: number;
  period_guess_s: number | null;
  system: StructureSystem;
}

export interface ScenarioMeta {
  scenario_id: string;
  label: string;
  description: string;
  source_id: number;
}

export interface ScenarioSource {
  id: number;
  delta_l_m: number;
  delta_w_m: number;
  delta_z_m: number;
  grid_index: number[];
}

export interface ScenarioSampling {
  preview_dt_s: number;
  preview_decimation: number;
  preview_n_samples: number;
}

export interface ScenarioReceiverTrace {
  receiver_id: number;
  label: string;
  lat: number;
  lon: number;
  vs30_proxy_mps: number;
  pgv: number;
  arias: number;
  dominant_hz: number;
  duration_s: number;
  zcr_hz: number;
  trace_preview: number[];
}

export interface ScenarioDetail {
  scenario_id: string;
  label: string;
  description: string;
  synthetic_for_demo: boolean;
  source: ScenarioSource;
  sampling: ScenarioSampling;
  per_receiver: ScenarioReceiverTrace[];
}

export interface ScoreBreakdown {
  site_hazard: number;
  ground_failure: number;
  structural_response: number;
  uncertainty_penalty: number;
}

export interface ViabilityScore {
  total: number;
  breakdown: ScoreBreakdown;
  top_drivers: string[];
}

export interface SimulateRequest {
  site: SiteCoord;
  structure: StructureSpec;
  scenario_id: string;
}

export type PhysicsBackend = 'opensees' | 'placeholder';

export interface SimulateResult {
  scenario: ScenarioMeta;
  nearest_receiver_id: number;
  nearest_distance_km: number;
  pgv_at_site_mps: number;
  estimated_period_s: number;
  peak_drift_ratio: number;
  peak_accel_g: number;
  score: ViabilityScore;
  synthetic_for_demo: boolean;
  notes: string[];

  // OpenSees-only fields. Optional so the placeholder path keeps the same
  // shape and the panel can branch per-row instead of per-layout.
  peak_roof_disp_m?: number | null;
  base_shear_kN?: number | null;
  peak_idr_per_story?: number[] | null;
  simulation_id?: string | null;
  converged?: boolean | null;
  eigen_T1_s?: number | null;
  physics_backend?: PhysicsBackend;

  // Per-floor displacement history at the OpenSees solver dt, meters,
  // relative to the fixed base. Drives time-history playback in the
  // animator. Optional — older results / placeholder backend lack it.
  floor_disp_history_m?: number[][] | null;
  history_dt_s?: number | null;
}

export type TerrainSource = 'USGS3DEP_10m' | 'SRTMGL3_90m' | 'synthetic';

/** Local heightfield around a site, normalized so the center point is y=0.
 *  Row-major; `elevations_m[j*grid_nx + i]` is the elevation at grid column
 *  `i`, row `j`, in meters relative to the center elevation. */
export interface TerrainGrid {
  center: SiteCoord;
  window_m: number;
  resolution_m: number;
  grid_nx: number;
  grid_ny: number;
  elevations_m: number[];
  elevation_min_m: number;
  elevation_max_m: number;
  center_elevation_m: number;
  source: TerrainSource;
  synthetic_for_demo: boolean;
}

export interface ApiError {
  error: string;
  code?: string | null;
}
