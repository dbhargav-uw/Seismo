from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..models.terrain import TerrainGrid
from ..services.terrain_fetch import (
    DEFAULT_RESOLUTION_M,
    DEFAULT_WINDOW_M,
    TerrainRequest,
    fetch_terrain,
)

router = APIRouter(prefix="/api/terrain", tags=["terrain"])


@router.get("", response_model=TerrainGrid)
def get_terrain(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    window_m: float = Query(DEFAULT_WINDOW_M, gt=0.0, le=5000.0),
    resolution_m: float = Query(DEFAULT_RESOLUTION_M, gt=0.0, le=100.0),
) -> TerrainGrid:
    try:
        return fetch_terrain(
            TerrainRequest(lat=lat, lon=lon, window_m=window_m, resolution_m=resolution_m)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
