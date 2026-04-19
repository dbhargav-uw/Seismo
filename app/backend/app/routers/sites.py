from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from ..models.site import ReceiverInfo, ReceiverList, SiteCoord, SiteHazardSummary
from ..services.data_loader import DataLoader, DataNotReadyError, get_data_loader
from ..services.hazard import per_receiver_pgv_map, site_hazard_summary

router = APIRouter(prefix="/api/sites", tags=["sites"])


@router.get("/receivers", response_model=ReceiverList)
def receivers(loader: DataLoader = Depends(get_data_loader)) -> ReceiverList:
    try:
        infos: list[ReceiverInfo] = []
        for r in loader.receivers():
            infos.append(
                ReceiverInfo(
                    receiver_id=int(r["id"]),  # type: ignore[arg-type]
                    label=str(r["label"]),
                    lat=float(r["lat"]),  # type: ignore[arg-type]
                    lon=float(r["lon"]),  # type: ignore[arg-type]
                    elevation_m=float(r["elevation_m"]),  # type: ignore[arg-type]
                    vs30_proxy_mps=float(r["vs30_proxy_mps"]),  # type: ignore[arg-type]
                )
            )
        return ReceiverList(receivers=infos)
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"receiver_metadata.json malformed: {exc}") from exc


@router.post("/hazard", response_model=SiteHazardSummary)
def hazard(
    site: SiteCoord = Body(...),
    scenario_id: str | None = None,
    loader: DataLoader = Depends(get_data_loader),
) -> SiteHazardSummary:
    try:
        pgv_map: dict[int, float] | None = None
        if scenario_id:
            try:
                detail = loader.scenario_detail(scenario_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=f"Unknown scenario_id: {scenario_id}") from exc
            pgv_map = per_receiver_pgv_map(detail.per_receiver)
        return site_hazard_summary(loader, site, pgv_map)
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
