"""Bundle three percentile-picked demo scenarios into compact JSON files.

Reads:
    data/processed/scripps_rom/receiver_metadata.json
    data/processed/scripps_rom/source_metadata.json
    data/processed/scripps_rom/waveform_summary.parquet
    data/processed/scripps_rom/traces_preview.npz

Writes:
    data/scenarios/demo_low.json    (5th-percentile mean PGV across receivers)
    data/scenarios/demo_mid.json    (median)
    data/scenarios/demo_high.json   (95th-percentile)

Each file is self-contained and small (< ~50 KB) so the backend can stream
scenarios directly to the frontend without re-touching the raw `.npy`.

Run from the repo root:
    python scripts/extract_demo_scenarios.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PROC_DIR = REPO_ROOT / "data" / "processed" / "scripps_rom"
SCEN_DIR = REPO_ROOT / "data" / "scenarios"

RECEIVER_META = PROC_DIR / "receiver_metadata.json"
SOURCE_META = PROC_DIR / "source_metadata.json"
SUMMARY_PARQUET = PROC_DIR / "waveform_summary.parquet"
TRACES_NPZ = PROC_DIR / "traces_preview.npz"

PERCENTILE_PICKS: list[tuple[str, str, str, float]] = [
    ("demo_low", "Light shaking", "5th-percentile mean PGV across receivers.", 5.0),
    ("demo_mid", "Moderate shaking", "Median mean-PGV scenario.", 50.0),
    ("demo_high", "Strong shaking", "95th-percentile mean PGV across receivers.", 95.0),
]


def _load_inputs() -> tuple[dict[str, object], dict[str, object], pd.DataFrame, dict[str, np.ndarray]]:
    missing = [p for p in (RECEIVER_META, SOURCE_META, SUMMARY_PARQUET, TRACES_NPZ) if not p.exists()]
    if missing:
        listing = "\n".join(f"  - {p.relative_to(REPO_ROOT)}" for p in missing)
        raise FileNotFoundError(
            "Missing processed inputs. Run scripts/generate_synthetic_metadata.py "
            f"and scripts/preprocess_rom.py first.\n{listing}"
        )

    receivers = json.loads(RECEIVER_META.read_text())
    sources = json.loads(SOURCE_META.read_text())
    summary = pd.read_parquet(SUMMARY_PARQUET)
    with np.load(TRACES_NPZ) as npz:
        traces = {
            "traces": npz["traces"].astype(np.float32),
            "t": npz["t"].astype(np.float32),
            "dt": float(npz["dt"]),
            "decimation": int(npz["decimation"]),
        }
    return receivers, sources, summary, traces


def _pick_source_id(summary: pd.DataFrame, percentile: float) -> int:
    per_source_mean_pgv = summary.groupby("source_id")["pgv"].mean()
    target = np.percentile(per_source_mean_pgv.to_numpy(), percentile)
    closest = (per_source_mean_pgv - target).abs().idxmin()
    return int(closest)


def _build_scenario(
    scenario_id: str,
    label: str,
    description: str,
    source_id: int,
    receivers: dict[str, object],
    sources: dict[str, object],
    summary: pd.DataFrame,
    traces: dict[str, np.ndarray],
) -> dict[str, object]:
    source_list = sources["sources"]  # type: ignore[index]
    if not isinstance(source_list, list) or source_id >= len(source_list):
        raise ValueError(f"source_id {source_id} out of range")
    source_meta = source_list[source_id]

    receiver_list = receivers["receivers"]  # type: ignore[index]
    if not isinstance(receiver_list, list):
        raise ValueError("receiver_metadata.receivers must be a list")
    receivers_by_id: dict[int, dict[str, object]] = {
        int(r["id"]): r for r in receiver_list  # type: ignore[index]
    }

    src_summary = summary[summary["source_id"] == source_id].set_index("receiver_id")
    trace_array = traces["traces"]  # shape (n_rec, n_t_preview, n_src)

    per_receiver: list[dict[str, object]] = []
    for rid in sorted(receivers_by_id.keys()):
        r = receivers_by_id[rid]
        if rid not in src_summary.index:
            raise ValueError(f"summary missing receiver_id={rid} for source_id={source_id}")
        row = src_summary.loc[rid]
        trace = trace_array[rid, :, source_id].tolist()
        per_receiver.append(
            {
                "receiver_id": rid,
                "label": r["label"],
                "lat": r["lat"],
                "lon": r["lon"],
                "vs30_proxy_mps": r["vs30_proxy_mps"],
                "pgv": float(row["pgv"]),
                "arias": float(row["arias"]),
                "dominant_hz": float(row["dominant_hz"]),
                "duration_s": float(row["duration_s"]),
                "zcr_hz": float(row["zcr_hz"]),
                "trace_preview": trace,
            }
        )

    return {
        "scenario_id": scenario_id,
        "label": label,
        "description": description,
        "synthetic_for_demo": True,
        "source": source_meta,
        "sampling": {
            "preview_dt_s": traces["dt"],
            "preview_decimation": traces["decimation"],
            "preview_n_samples": int(trace_array.shape[1]),
        },
        "per_receiver": per_receiver,
    }


def main() -> int:
    try:
        receivers, sources, summary, traces = _load_inputs()
    except FileNotFoundError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    SCEN_DIR.mkdir(parents=True, exist_ok=True)
    catalog: list[dict[str, object]] = []

    for scenario_id, label, description, percentile in PERCENTILE_PICKS:
        try:
            source_id = _pick_source_id(summary, percentile)
            scenario = _build_scenario(
                scenario_id=scenario_id,
                label=label,
                description=f"{description} (source_id={source_id})",
                source_id=source_id,
                receivers=receivers,
                sources=sources,
                summary=summary,
                traces=traces,
            )
        except ValueError as exc:
            print(f"FAIL building {scenario_id}: {exc}", file=sys.stderr)
            return 1

        out_path = SCEN_DIR / f"{scenario_id}.json"
        out_path.write_text(json.dumps(scenario, indent=2) + "\n")
        size_kb = out_path.stat().st_size / 1024
        print(
            f"  wrote {out_path.relative_to(REPO_ROOT)} "
            f"(source_id={source_id}, p{percentile:.0f}, {size_kb:.1f} KB)"
        )
        catalog.append(
            {
                "scenario_id": scenario_id,
                "label": label,
                "description": scenario["description"],
                "source_id": source_id,
            }
        )

    catalog_path = SCEN_DIR / "_catalog.json"
    catalog_path.write_text(
        json.dumps({"synthetic_for_demo": True, "scenarios": catalog}, indent=2) + "\n"
    )
    print(f"  wrote {catalog_path.relative_to(REPO_ROOT)} ({len(catalog)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
