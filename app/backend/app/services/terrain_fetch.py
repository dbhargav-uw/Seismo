"""Fetch a local heightfield around a site.

Source preference: USGS 3DEP 10 m (via OpenTopography `globaldem`) for sites
inside CONUS, SRTMGL3 90 m globally otherwise. When the API key is unset, the
service is temporarily unreachable, or the response is malformed, we fall
back to a deterministic synthetic heightfield so the demo stays runnable.

The returned grid is always normalized so the elevation at the exact center
(i=nx//2, j=ny//2) is zero; `center_elevation_m` echoes the absolute datum
elevation separately for display.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np

from ..models.site import SiteCoord
from ..models.terrain import TerrainGrid, TerrainSource
from ..settings import Settings, get_settings

logger = logging.getLogger("seismo.terrain")

# Sizing defaults. A 1 km window at 65x65 gives ~15.6 m effective sample
# spacing, slightly coarser than 3DEP's native 10 m but still within one
# sample of the source grid — bilinear resample is a visual pass-through.
# 1 km of context gives the building clear "sitting in a neighborhood"
# framing without the hills dwarfing it.
DEFAULT_WINDOW_M: float = 1000.0
DEFAULT_RESOLUTION_M: float = 15.625  # 1000 / 64
DEFAULT_GRID_N: int = 65

_SYNTHETIC_CENTER_ELEVATION_M: float = 120.0

# Rough CONUS box — if (lat, lon) is inside, we prefer 3DEP 10 m. Outside,
# SRTMGL3 90 m covers virtually everywhere else on land.
_CONUS_LAT_MIN: float = 24.5
_CONUS_LAT_MAX: float = 49.5
_CONUS_LON_MIN: float = -125.0
_CONUS_LON_MAX: float = -66.5


@dataclass(frozen=True)
class TerrainRequest:
    lat: float
    lon: float
    window_m: float = DEFAULT_WINDOW_M
    resolution_m: float = DEFAULT_RESOLUTION_M


def _grid_n(window_m: float, resolution_m: float) -> int:
    """Pick the grid side that keeps the window size exact and spacing close to
    the requested resolution. Always odd so the site sits on a grid point."""
    n = max(3, int(round(window_m / resolution_m)) + 1)
    if n % 2 == 0:
        n += 1
    return n


def _is_conus(lat: float, lon: float) -> bool:
    return _CONUS_LAT_MIN <= lat <= _CONUS_LAT_MAX and _CONUS_LON_MIN <= lon <= _CONUS_LON_MAX


def _synthetic_elevations(
    lat: float, lon: float, window_m: float, nx: int, ny: int
) -> tuple[list[float], float]:
    """Two-peak gaussian plus low-amplitude noise, seeded deterministically
    from lat+lon so repeated calls at the same site give the same terrain.

    Returns (relative_elevations, center_elevation_m). The center grid point
    is exactly zero in the returned array.
    """
    seed_int = int((lat * 1e4) % 1e9) ^ int((lon * 1e4) % 1e9) & 0xFFFFFFFF
    state = seed_int if seed_int != 0 else 1

    def lcg() -> float:
        nonlocal state
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        return state / 0x7FFFFFFF  # [0, 1)

    # Amplitudes scale with the window so the terrain reads as real relief at
    # every zoom: for a 1 km window, peaks reach ~25-60 m — typical rolling
    # hills around LA — while still not dwarfing a 15 m building in the
    # foreground (distant hills look smaller because they're distant).
    amp_scale = window_m / 1000.0
    peak_a = (
        (lcg() - 0.5) * window_m * 0.3,
        (lcg() - 0.5) * window_m * 0.3,
        (25.0 + lcg() * 35.0) * amp_scale,  # ~25..60 m at 1 km window
        window_m * (0.10 + lcg() * 0.08),
    )
    peak_b = (
        (lcg() - 0.5) * window_m * 0.6,
        (lcg() - 0.5) * window_m * 0.6,
        -(15.0 + lcg() * 25.0) * amp_scale,  # ~-15..-40 m depression
        window_m * (0.15 + lcg() * 0.10),
    )
    noise_amp = (2.0 + lcg() * 3.0) * amp_scale

    dx = window_m / (nx - 1)
    dy = window_m / (ny - 1)
    raw: list[float] = [0.0] * (nx * ny)
    for j in range(ny):
        y = -window_m / 2 + j * dy
        for i in range(nx):
            x = -window_m / 2 + i * dx
            a = peak_a[2] * math.exp(
                -((x - peak_a[0]) ** 2 + (y - peak_a[1]) ** 2) / (2 * peak_a[3] ** 2)
            )
            b = peak_b[2] * math.exp(
                -((x - peak_b[0]) ** 2 + (y - peak_b[1]) ** 2) / (2 * peak_b[3] ** 2)
            )
            n = (lcg() - 0.5) * 2 * noise_amp
            raw[j * nx + i] = a + b + n

    ci = nx // 2
    cj = ny // 2
    center_rel = raw[cj * nx + ci]
    rel = [v - center_rel for v in raw]
    return rel, _SYNTHETIC_CENTER_ELEVATION_M + center_rel


def _synthetic_grid(req: TerrainRequest) -> TerrainGrid:
    nx = _grid_n(req.window_m, req.resolution_m)
    ny = nx
    rel, center_abs = _synthetic_elevations(req.lat, req.lon, req.window_m, nx, ny)
    effective_res = req.window_m / (nx - 1)
    return TerrainGrid(
        center=SiteCoord(lat=req.lat, lon=req.lon),
        window_m=req.window_m,
        resolution_m=effective_res,
        grid_nx=nx,
        grid_ny=ny,
        elevations_m=rel,
        elevation_min_m=min(rel),
        elevation_max_m=max(rel),
        center_elevation_m=center_abs,
        source="synthetic",
        synthetic_for_demo=True,
    )


def _bbox_deg(lat: float, lon: float, window_m: float) -> tuple[float, float, float, float]:
    """Small-angle equirectangular box around (lat, lon). Accurate to <0.1 m
    at the 500 m window scale; well below our ~8 m sample spacing."""
    lat_rad = math.radians(lat)
    half_lat = (window_m / 2) / 111_000.0
    half_lon = (window_m / 2) / (111_000.0 * max(math.cos(lat_rad), 1e-6))
    return lat - half_lat, lat + half_lat, lon - half_lon, lon + half_lon


def _parse_aai_grid(text: str) -> tuple[np.ndarray, dict[str, float]]:
    """Parse an ESRI ASCII Grid. Returns (values, header).

    Values are shaped (nrows, ncols) with row 0 at the TOP (north edge), which
    is the AAIGrid convention. NODATA cells are replaced with the grid mean.
    """
    header: dict[str, float] = {}
    rows: list[list[float]] = []
    ncols = nrows = -1
    nodata: float | None = None
    for raw in text.strip().splitlines():
        line = raw.strip()
        if not line:
            continue
        first = line.split(None, 1)[0].lower()
        if first in {
            "ncols",
            "nrows",
            "xllcorner",
            "yllcorner",
            "xllcenter",
            "yllcenter",
            "cellsize",
            "nodata_value",
            "dx",
            "dy",
        }:
            key, val = line.split(None, 1)
            header[key.lower()] = float(val)
            if key.lower() == "ncols":
                ncols = int(header["ncols"])
            elif key.lower() == "nrows":
                nrows = int(header["nrows"])
            elif key.lower() == "nodata_value":
                nodata = float(header["nodata_value"])
        else:
            rows.append([float(tok) for tok in line.split()])
    if ncols <= 0 or nrows <= 0:
        raise ValueError("AAIGrid missing ncols / nrows")
    if len(rows) != nrows:
        raise ValueError(f"AAIGrid rows mismatch: header={nrows}, found={len(rows)}")
    arr = np.array(rows, dtype=np.float64)
    if nodata is not None:
        mask = arr == nodata
        if mask.any():
            good = arr[~mask]
            fill = float(good.mean()) if good.size else 0.0
            arr[mask] = fill
    return arr, header


def _bilinear_resample(values: np.ndarray, out_n: int) -> np.ndarray:
    """Resample a 2-D elevation grid to (out_n, out_n) via bilinear interpolation.

    Uses numpy indexing only; no scipy/PIL needed."""
    in_ny, in_nx = values.shape
    if in_nx == out_n and in_ny == out_n:
        return values.copy()
    xs = np.linspace(0, in_nx - 1, out_n)
    ys = np.linspace(0, in_ny - 1, out_n)
    x0 = np.floor(xs).astype(np.int64)
    x1 = np.clip(x0 + 1, 0, in_nx - 1)
    y0 = np.floor(ys).astype(np.int64)
    y1 = np.clip(y0 + 1, 0, in_ny - 1)
    fx = (xs - x0).reshape(1, out_n)
    fy = (ys - y0).reshape(out_n, 1)
    v00 = values[np.ix_(y0, x0)]
    v10 = values[np.ix_(y0, x1)]
    v01 = values[np.ix_(y1, x0)]
    v11 = values[np.ix_(y1, x1)]
    top = v00 * (1 - fx) + v10 * fx
    bot = v01 * (1 - fx) + v11 * fx
    return top * (1 - fy) + bot * fy


def _cache_key(req: TerrainRequest) -> str:
    """Stable cache key — 4-decimal lat/lon rounding (~11 m) so nearby
    fine-tunes all share a cache entry."""
    raw = f"{round(req.lat, 4)}_{round(req.lon, 4)}_w{int(req.window_m)}_r{req.resolution_m:.2f}"
    return hashlib.sha1(raw.encode("ascii")).hexdigest()[:16]


def _cache_read(cache_dir: Path, key: str) -> TerrainGrid | None:
    path = cache_dir / f"{key}.json"
    if not path.is_file():
        return None
    try:
        return TerrainGrid.model_validate_json(path.read_text())
    except Exception as exc:  # malformed cache entry, treat as miss
        logger.warning("terrain cache read failed for %s: %s", path.name, exc)
        return None


def _cache_write(cache_dir: Path, key: str, grid: TerrainGrid) -> None:
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / f"{key}.json").write_text(grid.model_dump_json())
    except OSError as exc:
        logger.warning("terrain cache write failed: %s", exc)


def _opentopo_fetch(
    req: TerrainRequest, demtype: str, settings: Settings
) -> np.ndarray:
    """Call OpenTopography's AAIGrid endpoint. Returns a 2-D elevation array.

    Raises on any failure; the caller is responsible for falling back."""
    south, north, west, east = _bbox_deg(req.lat, req.lon, req.window_m)
    params = {
        "demtype": demtype,
        "south": f"{south:.6f}",
        "north": f"{north:.6f}",
        "west": f"{west:.6f}",
        "east": f"{east:.6f}",
        "outputFormat": "AAIGrid",
        "API_Key": settings.opentopo_api_key,
    }
    with httpx.Client(timeout=settings.opentopo_timeout_s) as client:
        resp = client.get(settings.opentopo_base_url, params=params)
    if resp.status_code != 200:
        raise RuntimeError(
            f"OpenTopography {demtype} returned {resp.status_code}: {resp.text[:200]}"
        )
    arr, _hdr = _parse_aai_grid(resp.text)
    return arr


def _grid_from_dem(
    req: TerrainRequest, raw: np.ndarray, source: TerrainSource
) -> TerrainGrid:
    nx = _grid_n(req.window_m, req.resolution_m)
    ny = nx
    resampled = _bilinear_resample(raw, nx)
    # AAIGrid has row 0 at the TOP; our frontend convention treats j=0 as one
    # edge and j=ny-1 as the other (cardinal orientation doesn't matter for
    # this demo). We flip here so j increases with latitude (northward).
    resampled = np.flipud(resampled)
    center = resampled[ny // 2, nx // 2]
    rel = (resampled - center).astype(np.float64)
    elevations = rel.flatten().tolist()
    return TerrainGrid(
        center=SiteCoord(lat=req.lat, lon=req.lon),
        window_m=req.window_m,
        resolution_m=req.window_m / (nx - 1),
        grid_nx=nx,
        grid_ny=ny,
        elevations_m=elevations,
        elevation_min_m=float(rel.min()),
        elevation_max_m=float(rel.max()),
        center_elevation_m=float(center),
        source=source,
        synthetic_for_demo=source == "synthetic",
    )


def fetch_terrain(req: TerrainRequest, settings: Settings | None = None) -> TerrainGrid:
    """Top-level entry. Cache → real DEM → synthetic fallback. Never raises."""
    s = settings or get_settings()

    key = _cache_key(req)
    cached = _cache_read(s.terrain_cache_dir, key)
    if cached is not None:
        return cached

    if not s.opentopo_api_key:
        logger.info("OPENTOPO_API_KEY unset; using synthetic terrain for (%.4f, %.4f)", req.lat, req.lon)
        grid = _synthetic_grid(req)
        _cache_write(s.terrain_cache_dir, key, grid)
        return grid

    demtype: str = "USGS10m" if _is_conus(req.lat, req.lon) else "SRTMGL3"
    source: TerrainSource = "USGS3DEP_10m" if demtype == "USGS10m" else "SRTMGL3_90m"
    try:
        raw = _opentopo_fetch(req, demtype, s)
        grid = _grid_from_dem(req, raw, source)
        _cache_write(s.terrain_cache_dir, key, grid)
        return grid
    except Exception as exc:
        logger.warning(
            "OpenTopography %s fetch failed at (%.4f, %.4f): %s; falling back to synthetic",
            demtype, req.lat, req.lon, exc,
        )
        grid = _synthetic_grid(req)
        _cache_write(s.terrain_cache_dir, key, grid)
        return grid
