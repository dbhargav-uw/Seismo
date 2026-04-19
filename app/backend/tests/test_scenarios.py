from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_scenarios(client: TestClient) -> None:
    r = client.get("/api/scenarios")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    ids = {s["scenario_id"] for s in body}
    assert {"demo_low", "demo_mid", "demo_high"} == ids


def test_get_scenario_detail_shape(client: TestClient) -> None:
    r = client.get("/api/scenarios/demo_mid")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scenario_id"] == "demo_mid"
    assert body["synthetic_for_demo"] is True
    assert len(body["per_receiver"]) == 16
    rec0 = body["per_receiver"][0]
    assert {"receiver_id", "lat", "lon", "pgv", "trace_preview"}.issubset(rec0.keys())
    assert len(rec0["trace_preview"]) == body["sampling"]["preview_n_samples"]


def test_get_scenario_unknown_id_returns_404(client: TestClient) -> None:
    r = client.get("/api/scenarios/does_not_exist")
    assert r.status_code == 404
    assert r.json()["error"]


def test_simulate_returns_typed_result(client: TestClient) -> None:
    payload = {
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
    r = client.post("/api/simulate", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scenario"]["scenario_id"] == "demo_mid"
    assert 0.0 <= body["score"]["total"] <= 1.0
    assert len(body["score"]["top_drivers"]) == 3
    assert body["synthetic_for_demo"] is True


def test_site_hazard_returns_nearest_receivers(client: TestClient) -> None:
    payload = {"lat": 34.05, "lon": -118.25}
    r = client.post("/api/sites/hazard", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["nearest_receivers"]) == 4
    assert body["nearest_receivers"][0]["distance_km"] >= 0.0
    assert body["synthetic_for_demo"] is True
