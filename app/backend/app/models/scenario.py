from __future__ import annotations

from pydantic import BaseModel, Field


class ScenarioMeta(BaseModel):
    scenario_id: str
    label: str
    description: str
    source_id: int = Field(ge=0)


class ScenarioSource(BaseModel):
    id: int
    delta_l_m: float
    delta_w_m: float
    delta_z_m: float
    grid_index: list[int]


class ScenarioSampling(BaseModel):
    preview_dt_s: float = Field(gt=0.0)
    preview_decimation: int = Field(ge=1)
    preview_n_samples: int = Field(ge=1)


class ScenarioReceiverTrace(BaseModel):
    receiver_id: int = Field(ge=0)
    label: str
    lat: float
    lon: float
    vs30_proxy_mps: float = Field(gt=0.0)
    pgv: float = Field(ge=0.0)
    arias: float = Field(ge=0.0)
    dominant_hz: float = Field(ge=0.0)
    duration_s: float = Field(ge=0.0)
    zcr_hz: float = Field(ge=0.0)
    trace_preview: list[float]


class ScenarioDetail(BaseModel):
    scenario_id: str
    label: str
    description: str
    synthetic_for_demo: bool = True
    source: ScenarioSource
    sampling: ScenarioSampling
    per_receiver: list[ScenarioReceiverTrace]


class ScenarioCatalog(BaseModel):
    synthetic_for_demo: bool = True
    scenarios: list[ScenarioMeta]
