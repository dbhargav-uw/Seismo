from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..models.scenario import ScenarioDetail, ScenarioMeta
from ..services.data_loader import DataLoader, DataNotReadyError, get_data_loader

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("", response_model=list[ScenarioMeta])
def list_scenarios(loader: DataLoader = Depends(get_data_loader)) -> list[ScenarioMeta]:
    try:
        return loader.catalog().scenarios
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{scenario_id}", response_model=ScenarioDetail)
def get_scenario(scenario_id: str, loader: DataLoader = Depends(get_data_loader)) -> ScenarioDetail:
    try:
        return loader.scenario_detail(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown scenario_id: {scenario_id}") from exc
    except DataNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
