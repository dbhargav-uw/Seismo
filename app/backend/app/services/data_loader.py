"""Reads processed + scenario artifacts. Also mmap-loads the raw Scripps `.npy`
when the OpenSees simulation backend is enabled — see `raw_trace`.

We avoid touching `data/raw/` for *user-facing* flows (per the project layout
rule), but the OpenSees integration legitimately needs the un-decimated
velocity trace because the preview's 0.5 s timestep is too coarse for a
Newmark transient on T₁ ≈ 0.5 s structures.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..models.scenario import ScenarioCatalog, ScenarioDetail, ScenarioMeta
from ..settings import Settings

# Raw Scripps array: (receivers, timesteps, sources) at 10 Hz, float64, m/s.
# Shape and sampling rate confirmed in scripts/preprocess_rom.py.
RAW_NPY_RELPATH = Path("raw") / "scripps_rom" / "seismos_16_receivers.npy"
RAW_SAMPLING_DT_S = 0.1
RAW_EXPECTED_SHAPE: tuple[int, int, int] = (16, 600, 500)


class DataNotReadyError(RuntimeError):
    """Raised when expected processed/scenario artifacts are missing."""


def _read_json(path: Path) -> object:
    if not path.exists():
        raise DataNotReadyError(
            f"Missing artifact: {path}. Run scripts/generate_synthetic_metadata.py, "
            "scripts/preprocess_rom.py, scripts/extract_demo_scenarios.py."
        )
    return json.loads(path.read_text())


class DataLoader:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._scenario_cache: dict[str, ScenarioDetail] = {}
        self._catalog_cache: ScenarioCatalog | None = None
        self._receivers_cache: list[dict[str, object]] | None = None
        self._raw_seismos: np.ndarray | None = None

    def receivers(self) -> list[dict[str, object]]:
        if self._receivers_cache is None:
            payload = _read_json(self._settings.processed_dir / "receiver_metadata.json")
            if not isinstance(payload, dict) or "receivers" not in payload:
                raise DataNotReadyError("receiver_metadata.json malformed (no 'receivers' key)")
            receivers = payload["receivers"]
            if not isinstance(receivers, list):
                raise DataNotReadyError("receiver_metadata.json 'receivers' is not a list")
            self._receivers_cache = receivers
        return self._receivers_cache

    def catalog(self) -> ScenarioCatalog:
        if self._catalog_cache is None:
            payload = _read_json(self._settings.scenarios_dir / "_catalog.json")
            self._catalog_cache = ScenarioCatalog.model_validate(payload)
        return self._catalog_cache

    def scenario_meta(self, scenario_id: str) -> ScenarioMeta:
        for entry in self.catalog().scenarios:
            if entry.scenario_id == scenario_id:
                return entry
        raise KeyError(scenario_id)

    def scenario_detail(self, scenario_id: str) -> ScenarioDetail:
        if scenario_id in self._scenario_cache:
            return self._scenario_cache[scenario_id]
        # Validate against catalog first to avoid arbitrary path lookups.
        self.scenario_meta(scenario_id)
        path = self._settings.scenarios_dir / f"{scenario_id}.json"
        payload = _read_json(path)
        detail = ScenarioDetail.model_validate(payload)
        self._scenario_cache[scenario_id] = detail
        return detail

    def raw_trace(self, receiver_id: int, source_id: int) -> tuple[np.ndarray, float]:
        """Return the un-decimated velocity trace for one (receiver, source) pair.

        Memory-maps `data/raw/scripps_rom/seismos_16_receivers.npy` once and
        slices on every call. The slice is copied into a fresh contiguous
        float64 array so downstream consumers can mutate or pass it across
        process boundaries without keeping the mmap alive.

        Returns `(velocity_mps, dt_s)`.
        """
        if self._raw_seismos is None:
            path = self._settings.data_root / RAW_NPY_RELPATH
            if not path.exists():
                raise DataNotReadyError(
                    f"Missing raw Scripps array at {path}. "
                    "Place the file or set SEISMO_SIMULATION_BACKEND=placeholder."
                )
            arr = np.load(path, mmap_mode="r")
            if arr.shape != RAW_EXPECTED_SHAPE:
                raise DataNotReadyError(
                    f"Raw Scripps array has unexpected shape {arr.shape}; "
                    f"expected {RAW_EXPECTED_SHAPE}."
                )
            self._raw_seismos = arr

        n_rec, _n_t, n_src = self._raw_seismos.shape
        if not 0 <= receiver_id < n_rec:
            raise ValueError(f"receiver_id {receiver_id} out of range [0, {n_rec})")
        if not 0 <= source_id < n_src:
            raise ValueError(f"source_id {source_id} out of range [0, {n_src})")

        return np.ascontiguousarray(
            self._raw_seismos[receiver_id, :, source_id], dtype=np.float64
        ), RAW_SAMPLING_DT_S


@lru_cache(maxsize=1)
def _singleton_loader() -> DataLoader:
    from ..settings import get_settings

    return DataLoader(get_settings())


def get_data_loader() -> DataLoader:
    return _singleton_loader()
