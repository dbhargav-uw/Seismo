from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.services.data_loader import (
    RAW_EXPECTED_SHAPE,
    RAW_NPY_RELPATH,
    RAW_SAMPLING_DT_S,
    DataLoader,
    DataNotReadyError,
)
from app.settings import Settings


def _settings_with_raw_data() -> Settings | None:
    """Return real settings if the raw npy is on disk; else None to skip."""
    s = Settings()
    if not (s.data_root / RAW_NPY_RELPATH).exists():
        return None
    return s


def test_raw_trace_returns_correct_shape_and_dtype() -> None:
    settings = _settings_with_raw_data()
    if settings is None:
        pytest.skip(f"raw Scripps array not present at data/{RAW_NPY_RELPATH}")
    loader = DataLoader(settings)

    velocity, dt = loader.raw_trace(receiver_id=0, source_id=0)

    n_t = RAW_EXPECTED_SHAPE[1]
    assert velocity.shape == (n_t,)
    assert velocity.dtype == np.float64
    assert dt == RAW_SAMPLING_DT_S


def test_raw_trace_mmap_is_cached_across_calls() -> None:
    settings = _settings_with_raw_data()
    if settings is None:
        pytest.skip(f"raw Scripps array not present at data/{RAW_NPY_RELPATH}")
    loader = DataLoader(settings)

    loader.raw_trace(0, 0)
    handle_1 = loader._raw_seismos
    loader.raw_trace(7, 250)
    handle_2 = loader._raw_seismos
    assert handle_1 is handle_2


def test_raw_trace_rejects_out_of_range_indices() -> None:
    settings = _settings_with_raw_data()
    if settings is None:
        pytest.skip(f"raw Scripps array not present at data/{RAW_NPY_RELPATH}")
    loader = DataLoader(settings)

    with pytest.raises(ValueError):
        loader.raw_trace(receiver_id=99, source_id=0)
    with pytest.raises(ValueError):
        loader.raw_trace(receiver_id=0, source_id=9999)


def test_raw_trace_raises_data_not_ready_when_file_missing(tmp_path: Path) -> None:
    """Hand a settings whose data_root is empty — `raw_trace` must surface
    DataNotReadyError, not crash with a bare FileNotFoundError."""
    settings = Settings(data_root=tmp_path)
    loader = DataLoader(settings)
    with pytest.raises(DataNotReadyError):
        loader.raw_trace(0, 0)
