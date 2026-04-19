"""Viability scoring.

Two entry points:

- `compute_placeholder_result` — original Milestone 1 deterministic path.
  Fabricates `peak_drift_ratio` and `peak_accel_g` from PGV; used when
  `SEISMO_SIMULATION_BACKEND=placeholder` (the default during initial rollout).
- `compute_result_from_edps` — the OpenSees path. Takes real EDPs from the
  OpenSees response and feeds them into the same 4-component score formula.

The score formula itself is intentionally unchanged between the two paths.
Changing the formula and the simulation engine in the same PR would make
regressions impossible to attribute. The score becomes more meaningful
because its `structural_response` component is now driven by a real
shear-stick transient instead of a fabricated drift estimate.
"""

from __future__ import annotations

import math

from ..models.result import ScoreBreakdown, SimulateResult, ViabilityScore
from ..models.scenario import ScenarioDetail, ScenarioMeta
from ..models.site import SiteCoord
from ..models.structure import StructureSpec

PGV_REFERENCE_MPS = 0.001
SCORE_WEIGHTS: tuple[float, float, float, float] = (0.35, 0.20, 0.30, 0.15)
UNCERTAINTY_PENALTY = 0.25
DRIFT_NORM_DENOM = 0.025  # 2.5% drift maps to 1.0 on the structural-response axis


def _normalize_to_unit(value: float, scale: float) -> float:
    return min(max(value / scale, 0.0), 1.0)


def _estimate_period_s(spec: StructureSpec) -> float:
    if spec.period_guess_s is not None:
        return spec.period_guess_s
    h = spec.stories * spec.story_height_m
    coeff = {
        "concrete_moment_frame": 0.073,
        "steel_moment_frame": 0.085,
        "wood_light_frame": 0.06,
        "masonry": 0.05,
    }[spec.system]
    return coeff * (h ** 0.75)


def _scenario_dominant_hz(scenario: ScenarioDetail) -> float:
    if not scenario.per_receiver:
        return 1.0
    weights = [t.arias for t in scenario.per_receiver]
    total = sum(weights)
    if total <= 0:
        return sum(t.dominant_hz for t in scenario.per_receiver) / len(scenario.per_receiver)
    return sum(w * t.dominant_hz for w, t in zip(weights, scenario.per_receiver, strict=True)) / total


def _compose_score(
    *,
    pgv_at_site_mps: float,
    vs30_proxy_mps: float,
    peak_drift_ratio: float,
    drivers: list[tuple[str, float]],
) -> ViabilityScore:
    """Shared 4-component weighted score used by both backends."""
    site_hazard = _normalize_to_unit(pgv_at_site_mps, PGV_REFERENCE_MPS * 2.0)
    ground_failure = _normalize_to_unit(800.0 - vs30_proxy_mps, 600.0)
    structural_response = _normalize_to_unit(peak_drift_ratio, DRIFT_NORM_DENOM)

    w0, w1, w2, w3 = SCORE_WEIGHTS
    total = (
        w0 * site_hazard
        + w1 * ground_failure
        + w2 * structural_response
        + w3 * UNCERTAINTY_PENALTY
    )
    drivers.sort(key=lambda x: x[1], reverse=True)
    return ViabilityScore(
        total=min(max(total, 0.0), 1.0),
        breakdown=ScoreBreakdown(
            site_hazard=site_hazard,
            ground_failure=ground_failure,
            structural_response=structural_response,
            uncertainty_penalty=UNCERTAINTY_PENALTY,
        ),
        top_drivers=[d for d, _ in drivers[:3]],
    )


def compute_placeholder_result(
    *,
    site: SiteCoord,
    structure: StructureSpec,
    scenario_meta: ScenarioMeta,
    scenario_detail: ScenarioDetail,
    nearest_receiver_id: int,
    nearest_distance_km: float,
    pgv_at_site_mps: float,
    vs30_proxy_mps: float,
) -> SimulateResult:
    """Original Milestone 1 path. Fabricates EDPs from PGV and resonance detuning."""
    period_s = _estimate_period_s(structure)
    structure_hz = 1.0 / period_s
    dom_hz = _scenario_dominant_hz(scenario_detail)
    detuning = abs(math.log2(max(structure_hz, 0.05) / max(dom_hz, 0.05)))
    resonance_factor = math.exp(-detuning)

    peak_drift_ratio = 0.5 * resonance_factor * (pgv_at_site_mps / PGV_REFERENCE_MPS) * (1.0 / structure.stories)
    peak_drift_ratio = min(peak_drift_ratio, 0.05)
    peak_accel_g = 1.5 * resonance_factor * (pgv_at_site_mps / PGV_REFERENCE_MPS) * structure_hz / 10.0
    peak_accel_g = min(peak_accel_g, 1.5)

    drivers: list[tuple[str, float]] = [
        (f"Site PGV {pgv_at_site_mps * 1000:.2f} mm/s", _normalize_to_unit(pgv_at_site_mps, PGV_REFERENCE_MPS * 2.0) * SCORE_WEIGHTS[0]),
        (f"Vs30 proxy {vs30_proxy_mps:.0f} m/s", _normalize_to_unit(800.0 - vs30_proxy_mps, 600.0) * SCORE_WEIGHTS[1]),
        (f"Resonance detuning factor {resonance_factor:.2f}", _normalize_to_unit(peak_drift_ratio, DRIFT_NORM_DENOM) * SCORE_WEIGHTS[2]),
        ("Conceptual-screening uncertainty", UNCERTAINTY_PENALTY * SCORE_WEIGHTS[3]),
    ]

    score = _compose_score(
        pgv_at_site_mps=pgv_at_site_mps,
        vs30_proxy_mps=vs30_proxy_mps,
        peak_drift_ratio=peak_drift_ratio,
        drivers=drivers,
    )

    notes = [
        "Conceptual screening only — not for engineering decisions.",
        f"Estimated period {period_s:.2f} s (system={structure.system}).",
    ]

    return SimulateResult(
        scenario=scenario_meta,
        nearest_receiver_id=nearest_receiver_id,
        nearest_distance_km=nearest_distance_km,
        pgv_at_site_mps=pgv_at_site_mps,
        estimated_period_s=period_s,
        peak_drift_ratio=peak_drift_ratio,
        peak_accel_g=peak_accel_g,
        score=score,
        notes=notes,
        physics_backend="placeholder",
    )


def compute_result_from_edps(
    *,
    site: SiteCoord,
    structure: StructureSpec,
    scenario_meta: ScenarioMeta,
    nearest_receiver_id: int,
    nearest_distance_km: float,
    pgv_at_site_mps: float,
    vs30_proxy_mps: float,
    peak_drift_ratio: float,
    peak_accel_g: float,
    peak_roof_disp_m: float,
    base_shear_kN: float,
    peak_idr_per_story: list[float],
    eigen_T1_s: float,
    simulation_id: str,
    converged: bool,
    opensees_version: str,
    opensees_warnings: list[str],
    floor_disp_history_m: list[list[float]] | None = None,
    history_dt_s: float | None = None,
) -> SimulateResult:
    """OpenSees path. EDPs come from a real Newmark transient."""
    drivers: list[tuple[str, float]] = [
        (f"Site PGV {pgv_at_site_mps * 1000:.2f} mm/s", _normalize_to_unit(pgv_at_site_mps, PGV_REFERENCE_MPS * 2.0) * SCORE_WEIGHTS[0]),
        (f"Vs30 proxy {vs30_proxy_mps:.0f} m/s", _normalize_to_unit(800.0 - vs30_proxy_mps, 600.0) * SCORE_WEIGHTS[1]),
        (f"Peak drift {peak_drift_ratio * 100:.2f}%", _normalize_to_unit(peak_drift_ratio, DRIFT_NORM_DENOM) * SCORE_WEIGHTS[2]),
        ("Conceptual-screening uncertainty", UNCERTAINTY_PENALTY * SCORE_WEIGHTS[3]),
    ]

    score = _compose_score(
        pgv_at_site_mps=pgv_at_site_mps,
        vs30_proxy_mps=vs30_proxy_mps,
        peak_drift_ratio=peak_drift_ratio,
        drivers=drivers,
    )

    notes = [
        "Conceptual screening only — not for engineering decisions.",
        f"Estimated period {eigen_T1_s:.2f} s (system={structure.system}).",
        f"Analyzed by OpenSees v{opensees_version} · sim {simulation_id[:8]}",
    ]
    notes.extend(opensees_warnings)

    return SimulateResult(
        scenario=scenario_meta,
        nearest_receiver_id=nearest_receiver_id,
        nearest_distance_km=nearest_distance_km,
        pgv_at_site_mps=pgv_at_site_mps,
        estimated_period_s=eigen_T1_s,
        peak_drift_ratio=peak_drift_ratio,
        peak_accel_g=peak_accel_g,
        score=score,
        notes=notes,
        peak_roof_disp_m=peak_roof_disp_m,
        base_shear_kN=base_shear_kN,
        peak_idr_per_story=peak_idr_per_story,
        simulation_id=simulation_id,
        converged=converged,
        eigen_T1_s=eigen_T1_s,
        physics_backend="opensees",
        floor_disp_history_m=floor_disp_history_m,
        history_dt_s=history_dt_s,
    )
