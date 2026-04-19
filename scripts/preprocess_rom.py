"""Reduce the raw Scripps `.npy` to per-trace summary metrics + a small preview.

Inputs:
    data/raw/scripps_rom/seismos_16_receivers.npy   shape (16, 600, 500), float64

Outputs:
    data/processed/scripps_rom/waveform_summary.parquet   one row per (receiver, source)
    data/processed/scripps_rom/traces_preview.npz         downsampled traces for fast lookup

Per-trace columns in the parquet:
    receiver_id, source_id,
    pgv         (m/s, max |v|),
    arias       (m^2/s,  \u222bv\u00b2 dt),
    dominant_hz (FFT magnitude peak, restricted to >= 0.1 Hz),
    duration_s  (5\u201395% Arias window),
    zcr_hz      (mean zero-crossing rate)

Run from the repo root:
    python scripts/preprocess_rom.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_NPY = REPO_ROOT / "data" / "raw" / "scripps_rom" / "seismos_16_receivers.npy"
OUT_DIR = REPO_ROOT / "data" / "processed" / "scripps_rom"

EXPECTED_SHAPE = (16, 600, 500)
SAMPLING_RATE_HZ = 10.0
DT = 1.0 / SAMPLING_RATE_HZ
PREVIEW_DECIMATION = 5
DOMINANT_HZ_FLOOR = 0.1


def _load_velocity() -> np.ndarray:
    if not RAW_NPY.exists():
        raise FileNotFoundError(
            f"Missing raw input: {RAW_NPY.relative_to(REPO_ROOT)}. "
            "Run scripts/check_data_layout.py for guidance."
        )
    arr = np.load(RAW_NPY)
    if arr.shape != EXPECTED_SHAPE:
        raise ValueError(f"Expected shape {EXPECTED_SHAPE}, got {arr.shape}")
    if arr.dtype != np.float64:
        raise ValueError(f"Expected dtype float64, got {arr.dtype}")
    return arr


def _summarize(v: np.ndarray) -> pd.DataFrame:
    n_rec, n_t, n_src = v.shape

    pgv = np.max(np.abs(v), axis=1)
    v2 = v * v
    arias = v2.sum(axis=1) * DT

    fft_mag = np.abs(np.fft.rfft(v, axis=1))
    freqs = np.fft.rfftfreq(n_t, d=DT)
    freq_mask = freqs >= DOMINANT_HZ_FLOOR
    fft_mag_band = fft_mag[:, freq_mask, :]
    freqs_band = freqs[freq_mask]
    peak_idx = np.argmax(fft_mag_band, axis=1)
    dominant_hz = freqs_band[peak_idx]

    cum = np.cumsum(v2, axis=1) * DT
    total = cum[:, -1:, :]
    safe_total = np.where(total > 0.0, total, 1.0)
    norm_cum = cum / safe_total
    idx_5 = np.argmax(norm_cum >= 0.05, axis=1)
    idx_95 = np.argmax(norm_cum >= 0.95, axis=1)
    duration_s = np.maximum(idx_95 - idx_5, 0) * DT
    duration_s = np.where(total[:, 0, :] > 0.0, duration_s, 0.0)

    sign = np.sign(v)
    sign[sign == 0.0] = 1.0
    crossings = np.sum(np.abs(np.diff(sign, axis=1)) > 0, axis=1)
    zcr_hz = crossings / (n_t * DT)

    rec_idx, src_idx = np.meshgrid(np.arange(n_rec), np.arange(n_src), indexing="ij")
    return pd.DataFrame(
        {
            "receiver_id": rec_idx.ravel().astype(np.int32),
            "source_id": src_idx.ravel().astype(np.int32),
            "pgv": pgv.ravel(),
            "arias": arias.ravel(),
            "dominant_hz": dominant_hz.ravel(),
            "duration_s": duration_s.ravel(),
            "zcr_hz": zcr_hz.ravel(),
        }
    )


def _write_preview(v: np.ndarray, path: Path) -> None:
    preview = np.ascontiguousarray(v[:, ::PREVIEW_DECIMATION, :].astype(np.float32))
    t_preview = np.arange(preview.shape[1], dtype=np.float32) * (DT * PREVIEW_DECIMATION)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        traces=preview,
        t=t_preview,
        dt=np.float32(DT * PREVIEW_DECIMATION),
        decimation=np.int32(PREVIEW_DECIMATION),
    )


def main() -> int:
    try:
        v = _load_velocity()
    except (FileNotFoundError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"Loaded velocity array shape={v.shape} dtype={v.dtype}")

    summary = _summarize(v)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    parquet_path = OUT_DIR / "waveform_summary.parquet"
    summary.to_parquet(parquet_path, index=False)
    print(f"  wrote {parquet_path.relative_to(REPO_ROOT)} ({len(summary)} rows)")

    preview_path = OUT_DIR / "traces_preview.npz"
    _write_preview(v, preview_path)
    size_kb = preview_path.stat().st_size / 1024
    print(
        f"  wrote {preview_path.relative_to(REPO_ROOT)} "
        f"(decimation={PREVIEW_DECIMATION}x, {size_kb:.1f} KB)"
    )

    print("\nSummary stats:")
    print(summary[["pgv", "arias", "dominant_hz", "duration_s", "zcr_hz"]].describe().round(6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
