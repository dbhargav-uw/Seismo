"""HTTP client for the OpenSees `POST /v1/analyze` endpoint.

Synchronous httpx call wrapped in a tiny class with the URL and timeout
captured at construction. Returns a parsed `OpenSeesAnalyzeResponse`. Maps
remote errors onto a single `OpenSeesUnavailableError` exception so the
router can translate to HTTP status codes uniformly.

When `SEISMO_DEBUG_TRACE_PROVENANCE=1` is set in the environment, every call
emits one INFO-level log line with the receiver/source metadata, the dt, the
sample count, the first three acceleration samples, and the response peak.
That single line is the runtime audit trail proving "the bytes the OpenSees
solver received came from the .npy slice I selected."
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from pydantic import ValidationError

from ..models.opensees import OpenSeesAnalyzeResponse

logger = logging.getLogger("seismo.opensees")


class OpenSeesUnavailableError(RuntimeError):
    """Raised when the OpenSees service can't be reached or returns 5xx."""


class OpenSeesContractError(RuntimeError):
    """Raised when OpenSees returns a 4xx (we sent a bad request) or its
    response body fails our Pydantic validation (contract drift)."""


class OpenSeesClient:
    def __init__(self, base_url: str, timeout_s: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s

    def analyze(self, payload: dict[str, Any]) -> OpenSeesAnalyzeResponse:
        url = f"{self._base_url}/v1/analyze"
        try:
            response = httpx.post(url, json=payload, timeout=self._timeout_s)
        except httpx.RequestError as exc:
            raise OpenSeesUnavailableError(
                f"OpenSees service unreachable at {self._base_url}: {exc}"
            ) from exc

        if response.status_code >= 500:
            raise OpenSeesUnavailableError(
                f"OpenSees returned {response.status_code}: {response.text[:200]}"
            )
        if response.status_code >= 400:
            raise OpenSeesContractError(
                f"OpenSees rejected request ({response.status_code}): {response.text[:500]}"
            )

        try:
            parsed = OpenSeesAnalyzeResponse.model_validate(response.json())
        except ValidationError as exc:
            raise OpenSeesContractError(
                f"OpenSees response failed validation: {exc}"
            ) from exc

        if os.environ.get("SEISMO_DEBUG_TRACE_PROVENANCE") == "1":
            gm = payload.get("ground_motion", {})
            samples = gm.get("samples") or [[]]
            channel = samples[0] if samples else []
            src_meta = gm.get("source_metadata", {})
            logger.info(
                "trace-provenance: receiver_id=%s source_id=%s dt_s=%s "
                "n_samples=%s units=%s accel[0:3]=%s response_peak_roof_m=%s",
                src_meta.get("receiver_id"),
                src_meta.get("source_id"),
                gm.get("dt"),
                len(channel),
                gm.get("units"),
                channel[:3],
                parsed.summary.peak_roof_disp_m,
            )

        return parsed
