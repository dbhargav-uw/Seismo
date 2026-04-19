"""Required deliverable: prove the .npy slice survives intact into OpenSees and
that the returned playback history is internally consistent.

Eight checks, each printed to test output so a CI log alone is enough to read
the byte trail end-to-end:

  1. selected receiver_id (computed from real nearest_receivers logic)
  2. selected source_id (read from the actual scenario JSON)
  3. dt
  4. first 5 velocity samples from raw_trace(...)
  5. first 5 acceleration samples after velocity_to_acceleration_mps2
  6. confirmation those same acceleration samples reach OpenSees verbatim
  7. confirmation the source_metadata block names the same receiver/source
  8. confirmation the returned time_series top-floor peak matches summary.peak_roof_disp_m

This test must pass before the frontend playback work is allowed to start.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock


@pytest.fixture(autouse=True)
def _force_opensees_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEISMO_SIMULATION_BACKEND", "opensees")
    from app import settings as settings_module

    settings_module._settings = None  # type: ignore[attr-defined]


@pytest.fixture
def opensees_client() -> TestClient:
    from app.main import create_app

    return TestClient(create_app())


_SITE = {"lat": 34.05, "lon": -118.25}
_SCENARIO_ID = "demo_high"
_STRUCTURE = {
    "stories": 5,
    "story_height_m": 3.0,
    "plan_x_m": 20.0,
    "plan_y_m": 20.0,
    "mass_per_floor_t": 500.0,
    "period_guess_s": 0.5,
    "system": "concrete_moment_frame",
}


def _expected_receiver_id() -> int:
    """Compute the receiver the simulate router will pick for our site, using
    the same nearest_receivers logic the router uses. Avoids hardcoding."""
    from app.models.site import SiteCoord
    from app.services.data_loader import get_data_loader
    from app.services.hazard import nearest_receivers

    loader = get_data_loader()
    site = SiteCoord(**_SITE)
    nearest = nearest_receivers(loader, site, limit=4)
    assert nearest, "nearest_receivers returned no entries — scenario data missing?"
    return nearest[0].receiver_id


def _expected_source_id() -> int:
    from app.services.data_loader import get_data_loader

    return get_data_loader().scenario_detail(_SCENARIO_ID).source.id


def _stub_opensees_response_with_known_history(n_floors: int) -> dict[str, Any]:
    """Synthetic 5-step history with first-mode-shape ordering. Top-floor peak
    (0.045) matches summary.peak_roof_disp_m so check #8 has something real
    to compare against."""
    floor_disp_m = [
        [0.0] * n_floors,
        [0.0001 * (k + 1) for k in range(n_floors)],
        [0.005 * (k + 1) for k in range(n_floors)],
        # top floor at 0.045 m == peak_roof_disp_m below
        [0.011 / n_floors * (k + 1) * (n_floors / 1) if k < n_floors - 1 else 0.045
         for k in range(n_floors)],
        [0.008 / (n_floors - 1) * k if k > 0 else 0.0 for k in range(n_floors)],
    ]
    # Force step-3 top floor to exactly 0.045 regardless of arithmetic above.
    floor_disp_m[3][-1] = 0.045
    return {
        "schema_version": "1.1.0",
        "simulation_id": "trace0123456789ab",
        "summary": {
            "peak_idr": 0.012,
            "peak_roof_disp_m": 0.045,
            "peak_floor_accel_g": 0.32,
            "base_shear_kN": 1850.0,
            "peak_idr_per_story": [0.012, 0.010, 0.008, 0.006, 0.004][:n_floors],
            "converged": True,
            "runtime": {
                "walltime_s": 0.234,
                "opensees_version": "3.5.1.12",
                "app_commit": "deadbeef",
                "eigen_T1_s": 0.498,
                "n_steps_requested": 600,
                "n_steps_completed": 600,
            },
        },
        "time_series": {
            "dt_s": 0.1,
            "floor_disp_m": floor_disp_m,
        },
        "warnings": [],
    }


def test_trace_provenance_npy_to_opensees_to_history(
    opensees_client: TestClient, httpx_mock: HTTPXMock, capsys: pytest.CaptureFixture[str]
) -> None:
    """Prove the .npy slice the router selected is the same byte sequence the
    OpenSees solver received, and that the returned time_series is internally
    consistent with the scalar peak."""

    # ---- Check 1: selected receiver_id ----
    expected_receiver_id = _expected_receiver_id()
    print(f"[1] selected receiver_id = {expected_receiver_id}")

    # ---- Check 2: selected source_id ----
    expected_source_id = _expected_source_id()
    print(f"[2] selected source_id   = {expected_source_id}")

    # ---- Check 3: dt ----
    expected_dt_s = 0.1
    print(f"[3] dt_s                 = {expected_dt_s}")

    # ---- Check 4: first 5 velocity samples from raw_trace ----
    from app.services.data_loader import DataLoader
    from app.services.opensees_request import velocity_to_acceleration_mps2
    from app.settings import get_settings

    loader = DataLoader(get_settings())
    velocity, dt = loader.raw_trace(expected_receiver_id, expected_source_id)
    assert dt == expected_dt_s, f"raw_trace dt {dt} != {expected_dt_s}"
    print(f"[4] velocity[0:5]        = {velocity[:5].tolist()}")

    # ---- Check 5: first 5 acceleration samples after conversion ----
    expected_accel = velocity_to_acceleration_mps2(velocity, dt)
    print(f"[5] derived accel[0:5]   = {expected_accel[:5].tolist()}")

    # ---- POST /api/simulate, capturing the body that hit OpenSees ----
    n_floors = _STRUCTURE["stories"]
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        json=_stub_opensees_response_with_known_history(n_floors),
    )
    response = opensees_client.post(
        "/api/simulate",
        json={"site": _SITE, "structure": _STRUCTURE, "scenario_id": _SCENARIO_ID},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    sent_requests = httpx_mock.get_requests()
    assert len(sent_requests) == 1
    sent_body = json.loads(sent_requests[0].read())
    sent_gm = sent_body["ground_motion"]

    # ---- Check 6: those samples reach OpenSees verbatim ----
    received_accel = sent_gm["samples"][0]
    assert sent_gm["units"] == "m/s^2", f"units={sent_gm['units']}, want m/s^2"
    assert sent_gm["dt"] == expected_dt_s
    assert len(received_accel) == len(expected_accel)
    np.testing.assert_allclose(received_accel[:5], expected_accel[:5], rtol=1e-12)
    np.testing.assert_allclose(received_accel, expected_accel, rtol=1e-12)
    print(f"[6] opensees received    = {received_accel[:5]}  ✓ matches derived (full {len(received_accel)} samples)")

    # ---- Check 7: source_metadata names the same receiver + source ----
    src_meta = sent_gm["source_metadata"]
    assert src_meta == {
        "receiver_id": expected_receiver_id,
        "source_id": expected_source_id,
        "synthetic_for_demo": True,
    }
    print(f"[7] source_metadata      = {src_meta}  ✓ identifies the chosen npy slice")

    # ---- Check 8: returned history top-floor peak == summary.peak_roof_disp_m ----
    summary_peak_roof = body["peak_roof_disp_m"]
    history = body["floor_disp_history_m"]
    assert history is not None, "Viability response should carry floor_disp_history_m"
    history_peak_roof = max(abs(row[-1]) for row in history)
    assert history_peak_roof == pytest.approx(summary_peak_roof, rel=1e-9), (
        f"history top-floor peak {history_peak_roof} != summary peak {summary_peak_roof}"
    )
    print(
        f"[8] summary peak_roof    = {summary_peak_roof:.4e} m   "
        f"history peak top-floor = {history_peak_roof:.4e} m   ✓ within 1e-9"
    )


def test_structured_trace_log_emitted_when_debug_env_set(
    opensees_client: TestClient,
    httpx_mock: HTTPXMock,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The opensees_client emits a single INFO line per call when
    SEISMO_DEBUG_TRACE_PROVENANCE=1, naming receiver_id, source_id, dt, sample
    count, first three accel samples, and the response peak. This is the
    runtime audit trail."""
    import logging

    monkeypatch.setenv("SEISMO_DEBUG_TRACE_PROVENANCE", "1")
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        json=_stub_opensees_response_with_known_history(_STRUCTURE["stories"]),
    )
    with caplog.at_level(logging.INFO, logger="seismo.opensees"):
        response = opensees_client.post(
            "/api/simulate",
            json={"site": _SITE, "structure": _STRUCTURE, "scenario_id": _SCENARIO_ID},
        )
    assert response.status_code == 200

    matches = [r for r in caplog.records if "trace-provenance" in r.getMessage()]
    assert len(matches) == 1, f"expected exactly one trace-provenance log line, got {len(matches)}"
    msg = matches[0].getMessage()
    assert "receiver_id=" in msg
    assert "source_id=" in msg
    assert "dt_s=0.1" in msg
    assert "units=m/s^2" in msg
    assert "response_peak_roof_m=0.045" in msg
