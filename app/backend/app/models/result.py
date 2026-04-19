from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .scenario import ScenarioMeta
from .site import SiteCoord
from .structure import StructureSpec

PhysicsBackend = Literal["opensees", "placeholder"]


class SimulateRequest(BaseModel):
    site: SiteCoord
    structure: StructureSpec
    scenario_id: str = Field(min_length=1)


class ScoreBreakdown(BaseModel):
    site_hazard: float = Field(ge=0.0, le=1.0)
    ground_failure: float = Field(ge=0.0, le=1.0)
    structural_response: float = Field(ge=0.0, le=1.0)
    uncertainty_penalty: float = Field(ge=0.0, le=1.0)


class ViabilityScore(BaseModel):
    total: float = Field(ge=0.0, le=1.0)
    breakdown: ScoreBreakdown
    top_drivers: list[str]


class SimulateResult(BaseModel):
    scenario: ScenarioMeta
    nearest_receiver_id: int = Field(ge=0)
    nearest_distance_km: float = Field(ge=0.0)
    pgv_at_site_mps: float = Field(ge=0.0)
    estimated_period_s: float = Field(gt=0.0)
    peak_drift_ratio: float = Field(ge=0.0)
    peak_accel_g: float = Field(ge=0.0)
    score: ViabilityScore
    synthetic_for_demo: bool = True
    notes: list[str] = []

    # OpenSees-only fields. All optional so the placeholder path is unchanged
    # and the frontend can branch per-row instead of per-layout.
    peak_roof_disp_m: float | None = None
    base_shear_kN: float | None = None
    peak_idr_per_story: list[float] | None = None
    simulation_id: str | None = None
    converged: bool | None = None
    eigen_T1_s: float | None = None
    physics_backend: PhysicsBackend = "placeholder"

    # Per-floor displacement history at the OpenSees solver dt, meters,
    # relative to the fixed base. Drives the time-history playback mode in
    # the frontend animator. Optional — older results, partial runs, and the
    # placeholder backend leave this as None.
    floor_disp_history_m: list[list[float]] | None = None
    history_dt_s: float | None = None


class ErrorEnvelope(BaseModel):
    error: str
    code: str | None = None
