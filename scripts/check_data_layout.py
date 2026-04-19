"""Validate the local Scripps ROM data layout.

Run from the repo root:
    python scripts/check_data_layout.py

Exits non-zero on any failure. Designed to be the first thing a fresh clone runs.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw" / "scripps_rom"

NPY_PATH = RAW_DIR / "seismos_16_receivers.npy"
NOTEBOOK_PATH = RAW_DIR / "seismogram_rom_demo.ipynb"

EXPECTED_SHAPE = (16, 600, 500)
EXPECTED_DTYPE = np.float64


def _check_exists(label: str, path: Path) -> bool:
    ok = path.exists()
    status = "OK     " if ok else "MISSING"
    print(f"  [{status}] {label}: {path.relative_to(REPO_ROOT)}")
    return ok


def _check_npy(path: Path) -> bool:
    try:
        arr = np.load(path, mmap_mode="r")
    except Exception as exc:
        print(f"  [FAIL  ] could not load .npy: {exc!r}")
        return False

    ok_shape = arr.shape == EXPECTED_SHAPE
    ok_dtype = arr.dtype == EXPECTED_DTYPE
    print(f"  [{'OK     ' if ok_shape else 'FAIL  '}] shape == {EXPECTED_SHAPE}, got {arr.shape}")
    print(f"  [{'OK     ' if ok_dtype else 'FAIL  '}] dtype == {EXPECTED_DTYPE.__name__}, got {arr.dtype}")
    print(f"  [INFO  ] size on disk: {path.stat().st_size / 1e6:.1f} MB")
    return ok_shape and ok_dtype


def main() -> int:
    print(f"Repo root: {REPO_ROOT}")
    print("Required raw files:")
    have_npy = _check_exists("velocity seismograms", NPY_PATH)
    have_nb = _check_exists("demo notebook", NOTEBOOK_PATH)

    if not (have_npy and have_nb):
        print("\nFAIL: required raw files missing. See docs/DATA_LAYOUT.md.")
        return 1

    print("\nValidating .npy contents:")
    if not _check_npy(NPY_PATH):
        print("\nFAIL: .npy did not match expected shape/dtype.")
        return 1

    print("\nNote: source_locations.csv is intentionally not required —")
    print("      synthetic SoCal placeholders are emitted by")
    print("      scripts/generate_synthetic_metadata.py.")
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
