"""Runtime settings for the Seismo backend.

`SEISMO_DATA_ROOT` defaults to `<repo>/data` (computed from this file's path).
Override via env var when running from outside the repo.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DATA_ROOT = _REPO_ROOT / "data"

SimulationBackend = Literal["opensees", "placeholder"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SEISMO_", env_file=".env", extra="ignore")

    data_root: Path = Field(default=_DEFAULT_DATA_ROOT)
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Real OpenSees physics is the default. Set SEISMO_SIMULATION_BACKEND=placeholder
    # for demos without OpenSees running (or when openseespy isn't installable).
    simulation_backend: SimulationBackend = "opensees"
    opensees_base_url: str = "http://localhost:8001"
    opensees_timeout_s: float = 30.0

    # OpenTopography API for the terrain endpoint. When empty / unset, the
    # terrain service falls back to a deterministic synthetic heightfield
    # (demo stays runnable offline).
    opentopo_api_key: str = ""
    opentopo_timeout_s: float = 10.0
    opentopo_base_url: str = "https://portal.opentopography.org/API/globaldem"

    @property
    def processed_dir(self) -> Path:
        return self.data_root / "processed" / "scripps_rom"

    @property
    def scenarios_dir(self) -> Path:
        return self.data_root / "scenarios"

    @property
    def terrain_cache_dir(self) -> Path:
        return self.data_root / "processed" / "terrain_cache"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
