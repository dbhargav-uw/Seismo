"""End-to-end tests for `/api/simulate` against a stubbed OpenSees service.

The Viability backend's TestClient sends a real HTTP POST to the simulate
router; we use `pytest-httpx` to intercept the *outbound* httpx call to
OpenSees and return a canned response. This exercises the full vertical
slice except the OpenSees subprocess itself.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock


@pytest.fixture(autouse=True)
def _force_opensees_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test in this module runs with the OpenSees backend selected,
    regardless of the production default."""
    monkeypatch.setenv("SEISMO_SIMULATION_BACKEND", "opensees")
    # Reset the lru_cache'd settings so the env var actually takes effect.
    from app import settings as settings_module

    settings_module._settings = None  # type: ignore[attr-defined]


@pytest.fixture
def opensees_client() -> TestClient:
    """Fresh TestClient that picks up the env-var override above."""
    from app.main import create_app

    return TestClient(create_app())


_VALID_PAYLOAD: dict[str, Any] = {
    "site": {"lat": 34.05, "lon": -118.25},
    "structure": {
        "stories": 5,
        "story_height_m": 3.0,
        "plan_x_m": 20.0,
        "plan_y_m": 20.0,
        "mass_per_floor_t": 500.0,
        "period_guess_s": 0.5,
        "system": "concrete_moment_frame",
    },
    "scenario_id": "demo_mid",
}


def _stub_response(simulation_id: str = "abcdef0123456789") -> dict[str, Any]:
    # Synthesize a 5-step displacement history. Index convention: row[i] is the
    # state at step i; row[k] is floor k+1 (1-indexed in OpenSees terms) so
    # row[-1] is the top floor. First-mode shape: top floor moves most. The
    # peak top-floor value (0.045 at step 3) matches summary.peak_roof_disp_m
    # so the trace-provenance check has a non-degenerate consistency assertion.
    floor_disp_m = [
        [0.0, 0.0, 0.0, 0.0, 0.0],
        [0.0002, 0.0005, 0.0007, 0.0009, 0.001],
        [0.005, 0.010, 0.014, 0.018, 0.020],
        [0.011, 0.022, 0.032, 0.040, 0.045],   # top-floor peak == peak_roof_disp_m
        [0.008, 0.015, 0.022, 0.027, 0.030],
    ]
    return {
        "schema_version": "1.1.0",
        "simulation_id": simulation_id,
        "summary": {
            "peak_idr": 0.012,
            "peak_roof_disp_m": 0.045,
            "peak_floor_accel_g": 0.32,
            "base_shear_kN": 1850.0,
            "peak_idr_per_story": [0.012, 0.010, 0.008, 0.006, 0.004],
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


def test_happy_path_consumes_opensees_response_into_score(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        json=_stub_response(),
    )

    response = opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["physics_backend"] == "opensees"
    assert body["peak_drift_ratio"] == 0.012
    assert body["peak_accel_g"] == 0.32
    assert body["peak_roof_disp_m"] == 0.045
    assert body["base_shear_kN"] == 1850.0
    assert body["peak_idr_per_story"] == [0.012, 0.010, 0.008, 0.006, 0.004]
    assert body["simulation_id"] == "abcdef0123456789"
    assert body["converged"] is True
    assert body["eigen_T1_s"] == 0.498
    # eigen overrides the rule-of-thumb estimated_period_s.
    assert body["estimated_period_s"] == 0.498
    # Score breakdown should reflect real drift (0.012 / 0.025 = 0.48).
    assert body["score"]["breakdown"]["structural_response"] == pytest.approx(0.48, rel=1e-9)
    # OpenSees provenance should land in notes.
    assert any("OpenSees" in n for n in body["notes"])
    # Time-history flows through to the Viability response and the top-floor
    # peak agrees with the summary peak_roof_disp_m.
    assert body["history_dt_s"] == 0.1
    assert len(body["floor_disp_history_m"]) == 5
    assert all(len(row) == 5 for row in body["floor_disp_history_m"])
    history_peak_roof = max(abs(row[-1]) for row in body["floor_disp_history_m"])
    assert history_peak_roof == pytest.approx(body["peak_roof_disp_m"], rel=1e-9)


def test_request_body_sent_to_opensees_has_correct_shape(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    """Verify the translator output is what OpenSees actually receives."""
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        json=_stub_response(),
    )

    opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)

    sent = httpx_mock.get_requests()
    assert len(sent) == 1
    sent_body = sent[0].read()
    import json

    parsed = json.loads(sent_body)
    assert parsed["schema_version"] == "1.1.0"
    assert parsed["structure"]["model"]["floors"] == 5
    assert len(parsed["structure"]["model"]["mdof_stick"]["mass_per_floor_kg"]) == 5
    assert parsed["ground_motion"]["dt"] == 0.1
    assert parsed["ground_motion"]["units"] == "m/s^2"
    assert len(parsed["ground_motion"]["samples"][0]) == 600


def test_opensees_unreachable_returns_503(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    import httpx

    httpx_mock.add_exception(httpx.ConnectError("Cannot connect"))

    response = opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)

    assert response.status_code == 503
    body = response.json()
    assert "OpenSees" in body["error"]


def test_opensees_5xx_returns_503(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        status_code=500,
        text="boom",
    )

    response = opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)
    assert response.status_code == 503


def test_opensees_4xx_returns_502(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    """If OpenSees rejects our payload as malformed, that's our bug — not the
    user's. 502 (bad gateway from us) rather than 400 (user error)."""
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        status_code=422,
        json={"detail": "missing field"},
    )

    response = opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)
    assert response.status_code == 502


def test_opensees_warnings_propagate_to_notes(
    opensees_client: TestClient, httpx_mock: HTTPXMock
) -> None:
    stub = _stub_response()
    stub["warnings"] = ["Convergence failed after 350 of 600 steps; labels reflect partial response."]
    stub["summary"]["converged"] = False
    httpx_mock.add_response(
        url="http://localhost:8001/v1/analyze",
        method="POST",
        json=stub,
    )

    response = opensees_client.post("/api/simulate", json=_VALID_PAYLOAD)

    assert response.status_code == 200
    body = response.json()
    assert body["converged"] is False
    assert any("Convergence failed" in n for n in body["notes"])
