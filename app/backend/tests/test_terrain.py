from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import mock

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.services.terrain_fetch import (
    DEFAULT_WINDOW_M,
    TerrainRequest,
    _bilinear_resample,
    _grid_from_dem,
    _is_conus,
    _parse_aai_grid,
    _synthetic_grid,
    fetch_terrain,
)
from app.settings import Settings


# ------------------------------------------------------------------- unit tests


def test_is_conus_true_for_la() -> None:
    assert _is_conus(34.05, -118.25) is True


def test_is_conus_false_for_tokyo() -> None:
    assert _is_conus(35.68, 139.76) is False


def test_synthetic_grid_center_is_zero() -> None:
    req = TerrainRequest(lat=34.05, lon=-118.25)
    grid = _synthetic_grid(req)
    ci = grid.grid_nx // 2
    cj = grid.grid_ny // 2
    assert grid.elevations_m[cj * grid.grid_nx + ci] == 0.0
    assert grid.source == "synthetic"
    assert grid.synthetic_for_demo is True
    assert grid.elevation_min_m < 0 < grid.elevation_max_m


def test_synthetic_grid_is_deterministic() -> None:
    req = TerrainRequest(lat=34.05, lon=-118.25)
    a = _synthetic_grid(req)
    b = _synthetic_grid(req)
    assert a.elevations_m == b.elevations_m


def test_aai_grid_parse_handles_nodata() -> None:
    text = """\
ncols 3
nrows 3
xllcorner 0
yllcorner 0
cellsize 1
NODATA_value -9999
10 20 30
-9999 50 -9999
70 80 90
"""
    arr, hdr = _parse_aai_grid(text)
    assert arr.shape == (3, 3)
    assert hdr["ncols"] == 3
    assert arr[1, 0] != -9999
    assert arr[1, 2] != -9999


def test_bilinear_resample_preserves_corners() -> None:
    src = np.array(
        [
            [0.0, 1.0, 2.0],
            [1.0, 2.0, 3.0],
            [2.0, 3.0, 4.0],
        ]
    )
    out = _bilinear_resample(src, 5)
    assert out.shape == (5, 5)
    assert out[0, 0] == pytest.approx(src[0, 0])
    assert out[-1, -1] == pytest.approx(src[-1, -1])
    # monotonic increase along the diagonal
    diag = np.array([out[i, i] for i in range(5)])
    assert np.all(np.diff(diag) > 0)


def test_grid_from_dem_normalizes_center() -> None:
    # Simple ramp: center row should be the mean, off-center should be
    # non-zero after normalization.
    raw = np.outer(np.linspace(100, 200, 7), np.ones(7))
    req = TerrainRequest(lat=34.05, lon=-118.25, window_m=500.0, resolution_m=7.8125)
    grid = _grid_from_dem(req, raw, "USGS3DEP_10m")
    ci = grid.grid_nx // 2
    cj = grid.grid_ny // 2
    assert grid.elevations_m[cj * grid.grid_nx + ci] == pytest.approx(0.0, abs=1e-9)
    # Corners should differ from center, confirming normalization preserved
    # relative heights.
    assert grid.elevations_m[0] != 0.0
    assert grid.source == "USGS3DEP_10m"


# ------------------------------------------------------------------ service tests


def _tmp_settings(api_key: str = "") -> Settings:
    tmp = Path(tempfile.mkdtemp(prefix="seismo_terrain_test_"))
    (tmp / "processed").mkdir()
    return Settings(
        data_root=tmp, opentopo_api_key=api_key, opentopo_timeout_s=5.0
    )


def test_fetch_terrain_synthetic_when_no_key() -> None:
    settings = _tmp_settings(api_key="")
    grid = fetch_terrain(TerrainRequest(lat=34.05, lon=-118.25), settings)
    assert grid.source == "synthetic"


def test_fetch_terrain_caches_to_disk() -> None:
    settings = _tmp_settings(api_key="")
    req = TerrainRequest(lat=34.05, lon=-118.25)
    a = fetch_terrain(req, settings)
    # Second call should hit the disk cache and return the identical grid
    # (bit-for-bit — no new synthetic generation).
    b = fetch_terrain(req, settings)
    assert a.elevations_m == b.elevations_m
    cached_files = list(settings.terrain_cache_dir.glob("*.json"))
    assert len(cached_files) == 1


def test_fetch_terrain_falls_back_on_http_error() -> None:
    settings = _tmp_settings(api_key="DEMO_KEY")

    def broken_get(self: httpx.Client, url: str, params: dict) -> None:  # noqa: ARG001
        raise httpx.ConnectError("simulated DNS failure")

    with mock.patch.object(httpx.Client, "get", broken_get):
        grid = fetch_terrain(TerrainRequest(lat=34.05, lon=-118.25), settings)
    assert grid.source == "synthetic"


def test_fetch_terrain_happy_path_parses_aai_grid() -> None:
    settings = _tmp_settings(api_key="DEMO_KEY")
    aai_text = """ncols 5
nrows 5
xllcorner 0
yllcorner 0
cellsize 1
NODATA_value -9999
10 15 20 15 10
15 25 40 25 15
20 40 80 40 20
15 25 40 25 15
10 15 20 15 10
"""

    class StubResponse:
        status_code = 200
        text = aai_text

    def stub_get(self: httpx.Client, url: str, params: dict) -> StubResponse:  # noqa: ARG001
        # Sanity-check we're asking for the right demtype at this CONUS site.
        assert params["demtype"] == "USGS10m"
        return StubResponse()

    with mock.patch.object(httpx.Client, "get", stub_get):
        grid = fetch_terrain(TerrainRequest(lat=34.05, lon=-118.25), settings)
    assert grid.source == "USGS3DEP_10m"
    ci = grid.grid_nx // 2
    cj = grid.grid_ny // 2
    assert grid.elevations_m[cj * grid.grid_nx + ci] == pytest.approx(0.0, abs=1e-9)
    # Peak of the input is at the center (80 m). After normalization, corners
    # should be ~-70 m relative to center.
    assert grid.elevation_min_m < -50


def test_fetch_terrain_uses_srtm_outside_conus() -> None:
    settings = _tmp_settings(api_key="DEMO_KEY")

    seen: dict[str, str] = {}

    class StubResponse:
        status_code = 200
        text = (
            "ncols 3\nnrows 3\nxllcorner 0\nyllcorner 0\n"
            "cellsize 1\nNODATA_value -9999\n"
            "10 20 10\n20 30 20\n10 20 10\n"
        )

    def stub_get(self: httpx.Client, url: str, params: dict) -> StubResponse:  # noqa: ARG001
        seen["demtype"] = params["demtype"]
        return StubResponse()

    with mock.patch.object(httpx.Client, "get", stub_get):
        grid = fetch_terrain(TerrainRequest(lat=35.68, lon=139.76), settings)
    assert seen["demtype"] == "SRTMGL3"
    assert grid.source == "SRTMGL3_90m"


# ------------------------------------------------------------------ router test


def test_router_happy_path(client: TestClient) -> None:
    res = client.get("/api/terrain", params={"lat": 34.05, "lon": -118.25})
    assert res.status_code == 200
    body = res.json()
    assert body["grid_nx"] >= 3
    assert body["grid_ny"] >= 3
    assert len(body["elevations_m"]) == body["grid_nx"] * body["grid_ny"]
    # center vertex is the reference elevation, so it should be exactly 0
    ci = body["grid_nx"] // 2
    cj = body["grid_ny"] // 2
    assert body["elevations_m"][cj * body["grid_nx"] + ci] == pytest.approx(0.0, abs=1e-9)
    assert body["window_m"] == pytest.approx(DEFAULT_WINDOW_M)


def test_router_rejects_out_of_range(client: TestClient) -> None:
    res = client.get("/api/terrain", params={"lat": 999.0, "lon": 0.0})
    assert res.status_code == 422
