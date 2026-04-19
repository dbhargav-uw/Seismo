from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("SEISMO_DATA_ROOT", str(REPO_ROOT / "data"))
# Hardwire the default `client` fixture to the placeholder backend so the
# generic integration tests don't try to hit a real OpenSees server.
# Tests that exercise the OpenSees path override this with monkeypatch +
# their own TestClient (see test_simulate_opensees.py).
os.environ.setdefault("SEISMO_SIMULATION_BACKEND", "placeholder")


@pytest.fixture(scope="session")
def client() -> TestClient:
    # Import after env vars are set so settings pick them up.
    from app.main import app

    return TestClient(app)
