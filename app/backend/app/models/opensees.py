"""Pydantic mirrors of the OpenSees `/v1/analyze` request and response shapes.

These models are *internal* to the Viability backend — they are never exposed
on `/api/*`. They exist purely to give us static typing on the boundary with
the OpenSees subproject, so a contract drift on either side fails loudly here
instead of silently corrupting the score.

Schema contracts mirrored from
`opensees-structure-analysis-starter-fixed/contracts/*.schema.json` and
`opensees-structure-analysis-starter-fixed/app/backend/schemas.py`. The OpenSees
side uses `extra="forbid"`; we don't, because newer OpenSees versions may add
fields we don't care about and we don't want to fail on those.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

OPENSEES_SCHEMA_VERSION = "1.1.0"


class OpenSeesMdofStick(BaseModel):
    story_height_m: float = Field(gt=0)
    mass_per_floor_kg: list[float]
    story_stiffness_kN_per_m: list[float]
    damping_ratio: float = Field(ge=0, le=0.5)
    pdelta_flag: bool = False


class OpenSeesStructureModel(BaseModel):
    floors: int = Field(ge=1)
    lateral_system: str
    mass_distribution: str
    mdof_stick: OpenSeesMdofStick


class OpenSeesNormalizedStructure(BaseModel):
    schema_version: str
    structure_id: str
    units: str
    model: OpenSeesStructureModel


class OpenSeesGroundMotion(BaseModel):
    schema_version: str
    scenario_id: str
    dt: float = Field(gt=0)
    channels: list[str]
    units: Literal["g", "m/s^2"]
    samples: list[list[float]]
    source_metadata: dict[str, object] | None = None


class OpenSeesAnalyzeRequest(BaseModel):
    schema_version: str
    structure: OpenSeesNormalizedStructure
    ground_motion: OpenSeesGroundMotion


class OpenSeesRuntime(BaseModel):
    walltime_s: float
    opensees_version: str
    app_commit: str
    eigen_T1_s: float
    n_steps_requested: int
    n_steps_completed: int


class OpenSeesSummary(BaseModel):
    peak_idr: float
    peak_roof_disp_m: float
    peak_floor_accel_g: float
    base_shear_kN: float
    peak_idr_per_story: list[float]
    converged: bool
    runtime: OpenSeesRuntime


class OpenSeesTimeSeries(BaseModel):
    """Per-floor displacement history at native solver dt, meters, relative
    to base. Outer index = step (0..n_steps_completed); inner = floor 0..N-1.
    Used by the time-history playback visualization in the frontend.
    """

    dt_s: float = Field(gt=0)
    floor_disp_m: list[list[float]]


class OpenSeesAnalyzeResponse(BaseModel):
    schema_version: str
    simulation_id: str
    summary: OpenSeesSummary
    time_series: OpenSeesTimeSeries | None = None
    warnings: list[str] = Field(default_factory=list)
