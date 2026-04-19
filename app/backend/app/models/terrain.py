from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .site import SiteCoord

TerrainSource = Literal["USGS3DEP_10m", "SRTMGL3_90m", "synthetic"]


class TerrainGrid(BaseModel):
    """Local heightfield around a site, normalized so the center point is y=0.

    Row-major elevation array of length `grid_nx * grid_ny`; element `[j*nx + i]`
    is the elevation at grid column `i`, row `j`, relative to the center point
    elevation. The absolute datum elevation at the site is echoed separately as
    `center_elevation_m` for display.
    """

    center: SiteCoord
    window_m: float = Field(gt=0.0, description="Full side length of the square window.")
    resolution_m: float = Field(gt=0.0, description="Effective sample spacing after resampling.")
    grid_nx: int = Field(ge=2)
    grid_ny: int = Field(ge=2)
    elevations_m: list[float]
    elevation_min_m: float
    elevation_max_m: float
    center_elevation_m: float
    source: TerrainSource
    synthetic_for_demo: bool = True
