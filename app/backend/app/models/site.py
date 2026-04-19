from __future__ import annotations

from pydantic import BaseModel, Field


class SiteCoord(BaseModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)


class ReceiverRef(BaseModel):
    receiver_id: int = Field(ge=0)
    label: str
    lat: float
    lon: float
    distance_km: float = Field(ge=0.0)
    vs30_proxy_mps: float = Field(gt=0.0)


class SiteHazardSummary(BaseModel):
    site: SiteCoord
    nearest_receivers: list[ReceiverRef]
    vs30_proxy_mps: float = Field(gt=0.0)
    pgv_estimate_mps: float = Field(ge=0.0)
    synthetic_for_demo: bool = True
    notes: list[str] = []


class ReceiverInfo(BaseModel):
    receiver_id: int = Field(ge=0)
    label: str
    lat: float
    lon: float
    elevation_m: float
    vs30_proxy_mps: float = Field(gt=0.0)


class ReceiverList(BaseModel):
    synthetic_for_demo: bool = True
    receivers: list[ReceiverInfo]
