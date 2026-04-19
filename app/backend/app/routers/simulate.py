from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..models.result import SimulateRequest, SimulateResult
from ..services.data_loader import DataLoader, DataNotReadyError, get_data_loader
from ..services.hazard import nearest_receivers, per_receiver_pgv_map
from ..services.opensees_client import (
    OpenSeesClient,
    OpenSeesContractError,
    OpenSeesUnavailableError,
)
from ..services.opensees_request import build_request
from ..services.scoring import compute_placeholder_result, compute_result_from_edps
from ..settings import Settings, get_settings

router = APIRouter(prefix="/api", tags=["simulate"])


def _idw_hazard_scalars(
    nearest: list[object], pgv_map: dict[int, float]
) -> tuple[float, float]:
    """Inverse-distance-weighted PGV-at-site and Vs30 proxy from up to 4
    nearest receivers. Mirrored from the original simulate.py logic."""
    weights_raw = [1.0 / max(n.distance_km, 1e-3) ** 2 for n in nearest]  # type: ignore[attr-defined]
    total_w = sum(weights_raw)
    weights = [w / total_w for w in weights_raw]
    pgv_at_site = sum(
        w * pgv_map.get(n.receiver_id, 0.0)  # type: ignore[attr-defined]
        for w, n in zip(weights, nearest, strict=True)
    )
    vs30 = sum(
        w * n.vs30_proxy_mps  # type: ignore[attr-defined]
        for w, n in zip(weights, nearest, strict=True)
    )
    return pgv_at_site, vs30


@router.post("/simulate", response_model=SimulateResult)
def simulate(
    payload: SimulateRequest,
    loader: DataLoader = Depends(get_data_loader),
    settings: Settings = Depends(get_settings),
) -> SimulateResult:
    try:
        meta = loader.scenario_meta(payload.scenario_id)
        detail = loader.scenario_detail(payload.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown scenario_id: {payload.scenario_id}") from exc
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    nearest = nearest_receivers(loader, payload.site, limit=4)
    if not nearest:
        raise HTTPException(status_code=503, detail="No receivers available")
    pgv_map = per_receiver_pgv_map(detail.per_receiver)
    pgv_at_site, vs30 = _idw_hazard_scalars(nearest, pgv_map)

    if settings.simulation_backend == "placeholder":
        return compute_placeholder_result(
            site=payload.site,
            structure=payload.structure,
            scenario_meta=meta,
            scenario_detail=detail,
            nearest_receiver_id=nearest[0].receiver_id,
            nearest_distance_km=nearest[0].distance_km,
            pgv_at_site_mps=pgv_at_site,
            vs30_proxy_mps=vs30,
        )

    # OpenSees path. Single nearest receiver's full-rate trace; IDW only used
    # for hazard scalars (blending waveforms without phase alignment is
    # mathematically meaningless).
    try:
        velocity, dt_s = loader.raw_trace(
            receiver_id=nearest[0].receiver_id,
            source_id=detail.source.id,
        )
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    request_body = build_request(
        structure=payload.structure,
        scenario=meta,
        receiver_id=nearest[0].receiver_id,
        velocity_trace_mps=velocity,
        dt_s=dt_s,
    )

    client = OpenSeesClient(
        base_url=settings.opensees_base_url,
        timeout_s=settings.opensees_timeout_s,
    )
    try:
        analysis = client.analyze(request_body)
    except OpenSeesUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OpenSeesContractError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return compute_result_from_edps(
        site=payload.site,
        structure=payload.structure,
        scenario_meta=meta,
        nearest_receiver_id=nearest[0].receiver_id,
        nearest_distance_km=nearest[0].distance_km,
        pgv_at_site_mps=pgv_at_site,
        vs30_proxy_mps=vs30,
        peak_drift_ratio=analysis.summary.peak_idr,
        peak_accel_g=analysis.summary.peak_floor_accel_g,
        peak_roof_disp_m=analysis.summary.peak_roof_disp_m,
        base_shear_kN=analysis.summary.base_shear_kN,
        peak_idr_per_story=list(analysis.summary.peak_idr_per_story),
        eigen_T1_s=analysis.summary.runtime.eigen_T1_s,
        simulation_id=analysis.simulation_id,
        converged=analysis.summary.converged,
        opensees_version=analysis.summary.runtime.opensees_version,
        opensees_warnings=list(analysis.warnings),
        floor_disp_history_m=(
            [list(row) for row in analysis.time_series.floor_disp_m]
            if analysis.time_series is not None
            else None
        ),
        history_dt_s=(
            analysis.time_series.dt_s if analysis.time_series is not None else None
        ),
    )
