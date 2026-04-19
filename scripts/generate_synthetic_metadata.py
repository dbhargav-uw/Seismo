"""Emit synthetic SoCal receiver + source metadata for the demo.

The Scripps `.npy` ships without station coordinates, and the demo notebook
references a `source_locations.csv` we do not have. This script produces
deterministic placeholder metadata so the rest of the pipeline (preprocessing,
backend, frontend) has a stable schema to consume.

Outputs:
    data/processed/scripps_rom/receiver_metadata.json   (16 receivers, LA basin)
    data/processed/scripps_rom/source_metadata.json     (500 sources, synthetic grid)

Both files include `synthetic_for_demo: true` so the conceptual-screening
framing is unambiguous to downstream consumers.

Run from the repo root:
    python scripts/generate_synthetic_metadata.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "data" / "processed" / "scripps_rom"

NUM_RECEIVERS = 16
NUM_SOURCES = 500

LA_CENTER_LAT = 34.05
LA_CENTER_LON = -118.25
LAT_HALF_SPAN = 0.30
LON_HALF_SPAN = 0.35

VS30_MIN_MPS = 220.0
VS30_MAX_MPS = 720.0

SOURCE_GRID_SHAPE = (10, 10, 5)
SOURCE_HALF_LENGTH_M = 2000.0
SOURCE_HALF_WIDTH_M = 2000.0
SOURCE_HALF_DEPTH_M = 200.0


def _build_receivers() -> list[dict[str, object]]:
    grid_n = int(np.sqrt(NUM_RECEIVERS))
    if grid_n * grid_n != NUM_RECEIVERS:
        raise ValueError(f"NUM_RECEIVERS={NUM_RECEIVERS} must be a perfect square")

    lats = np.linspace(LA_CENTER_LAT - LAT_HALF_SPAN, LA_CENTER_LAT + LAT_HALF_SPAN, grid_n)
    lons = np.linspace(LA_CENTER_LON - LON_HALF_SPAN, LA_CENTER_LON + LON_HALF_SPAN, grid_n)

    rng = np.random.default_rng(seed=42)
    elevations = rng.uniform(20.0, 280.0, size=NUM_RECEIVERS)
    vs30s = rng.uniform(VS30_MIN_MPS, VS30_MAX_MPS, size=NUM_RECEIVERS)

    receivers: list[dict[str, object]] = []
    idx = 0
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            receivers.append(
                {
                    "id": idx,
                    "label": f"R{idx:02d}",
                    "lat": float(lat),
                    "lon": float(lon),
                    "grid_row": int(i),
                    "grid_col": int(j),
                    "elevation_m": round(float(elevations[idx]), 1),
                    "vs30_proxy_mps": round(float(vs30s[idx]), 1),
                }
            )
            idx += 1
    return receivers


def _build_sources() -> list[dict[str, object]]:
    nl, nw, nz = SOURCE_GRID_SHAPE
    if nl * nw * nz != NUM_SOURCES:
        raise ValueError(
            f"SOURCE_GRID_SHAPE {SOURCE_GRID_SHAPE} does not multiply to {NUM_SOURCES}"
        )

    delta_l = np.linspace(-SOURCE_HALF_LENGTH_M, SOURCE_HALF_LENGTH_M, nl)
    delta_w = np.linspace(-SOURCE_HALF_WIDTH_M, SOURCE_HALF_WIDTH_M, nw)
    delta_z = np.linspace(-SOURCE_HALF_DEPTH_M, SOURCE_HALF_DEPTH_M, nz)

    sources: list[dict[str, object]] = []
    idx = 0
    for i in range(nl):
        for j in range(nw):
            for k in range(nz):
                sources.append(
                    {
                        "id": idx,
                        "delta_l_m": round(float(delta_l[i]), 2),
                        "delta_w_m": round(float(delta_w[j]), 2),
                        "delta_z_m": round(float(delta_z[k]), 2),
                        "grid_index": [int(i), int(j), int(k)],
                    }
                )
                idx += 1
    return sources


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"  wrote {path.relative_to(REPO_ROOT)}")


def main() -> int:
    try:
        receivers = _build_receivers()
        sources = _build_sources()
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    receiver_payload: dict[str, object] = {
        "synthetic_for_demo": True,
        "description": (
            "Placeholder LA-basin coordinates. Not real seismic stations. "
            "Generated deterministically (seed=42) for hackathon screening only."
        ),
        "center": {"lat": LA_CENTER_LAT, "lon": LA_CENTER_LON},
        "count": len(receivers),
        "receivers": receivers,
    }

    source_payload: dict[str, object] = {
        "synthetic_for_demo": True,
        "description": (
            "Placeholder source-offset grid (\u0394\u2113, \u0394w, \u0394z) in meters. "
            "Stand-in for the unavailable source_locations.csv referenced in the demo notebook."
        ),
        "grid_shape": list(SOURCE_GRID_SHAPE),
        "extent_m": {
            "delta_l": [-SOURCE_HALF_LENGTH_M, SOURCE_HALF_LENGTH_M],
            "delta_w": [-SOURCE_HALF_WIDTH_M, SOURCE_HALF_WIDTH_M],
            "delta_z": [-SOURCE_HALF_DEPTH_M, SOURCE_HALF_DEPTH_M],
        },
        "count": len(sources),
        "sources": sources,
    }

    print("Writing synthetic metadata:")
    _write_json(OUT_DIR / "receiver_metadata.json", receiver_payload)
    _write_json(OUT_DIR / "source_metadata.json", source_payload)
    print(f"\nReceivers: {len(receivers)}, sources: {len(sources)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
