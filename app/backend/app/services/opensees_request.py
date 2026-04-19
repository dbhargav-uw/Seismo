"""Translator from Viability `(StructureSpec, scenario, trace)` to the OpenSees
`/v1/analyze` request shape.

This is a pure module: no I/O, no globals, no clock. Every modeling assumption
the Viability app makes upstream of OpenSees lives here, so reviewers have a
single file to audit.

Modeling assumptions encoded:

1. **Mass distribution** — the user's single `mass_per_floor_t` scalar is
   repeated across all floors. The Viability `StructureSpec` doesn't model
   non-uniform mass.
2. **Story stiffness** — uniform across floors, back-solved from the user's
   `period_guess_s` (or, if absent, the engineering rule `T = c · H^0.75`)
   using the closed-form fundamental frequency of an N-story uniform shear
   chain:

       ω₁ = 2 · √(k/m) · sin( π / (2·(2N+1)) )

   solved for k. SDOF case (N=1) uses `k = m · ω²` directly.
3. **System → damping ratio** — concrete=0.05, steel=0.02, wood=0.05,
   masonry=0.07. Conventional values typical of PEER ground-motion analyses.
4. **System → lateral_system label** — moment frames (concrete/steel) → label
   "moment_frame"; wood/masonry → "shear_wall". OpenSees treats this as
   metadata only.
5. **Velocity → acceleration** — Scripps data is velocity (m/s). Differentiate
   with `np.gradient` (central differences, length-preserving) to get
   acceleration in m/s². No low-pass; the ROM data is already band-limited.
6. **Receiver choice** — single nearest receiver. The IDW logic in
   `routers/simulate.py` is for hazard scalars only; blending waveforms
   without phase alignment is meaningless.

The first three are first-class modeling decisions that affect EDPs.
"""

from __future__ import annotations

import math
import uuid

import numpy as np

from ..models.opensees import OPENSEES_SCHEMA_VERSION
from ..models.scenario import ScenarioMeta
from ..models.structure import StructureSpec, StructureSystem

# Conventional modal damping ratios per lateral system.
SYSTEM_DAMPING_RATIO: dict[StructureSystem, float] = {
    "concrete_moment_frame": 0.05,
    "steel_moment_frame": 0.02,
    "wood_light_frame": 0.05,
    "masonry": 0.07,
}

# Coarse mapping from Viability `system` enum to OpenSees `lateral_system` label.
# OpenSees ignores this for physics; it's free-form metadata.
SYSTEM_LATERAL_LABEL: dict[StructureSystem, str] = {
    "concrete_moment_frame": "moment_frame",
    "steel_moment_frame": "moment_frame",
    "wood_light_frame": "shear_wall",
    "masonry": "shear_wall",
}

# Same coefficients used in services/scoring.py for the rule-of-thumb period
# fallback when the user hasn't supplied `period_guess_s`. T = c · H^0.75.
SYSTEM_PERIOD_COEFF: dict[StructureSystem, float] = {
    "concrete_moment_frame": 0.073,
    "steel_moment_frame": 0.085,
    "wood_light_frame": 0.06,
    "masonry": 0.05,
}

KG_PER_TONNE = 1000.0
N_PER_KN = 1000.0


def estimate_target_period_s(structure: StructureSpec) -> float:
    """Return the period the OpenSees stick should target.

    Prefer the user's `period_guess_s` if supplied; otherwise fall back to the
    engineering rule of thumb `T = c · H^0.75`. This is the same logic used by
    the placeholder scoring path so the two backends stay aligned.
    """
    if structure.period_guess_s is not None and structure.period_guess_s > 0.0:
        return structure.period_guess_s
    h = structure.stories * structure.story_height_m
    coeff = SYSTEM_PERIOD_COEFF[structure.system]
    return coeff * (h**0.75)


def derive_uniform_story_stiffness_kN_per_m(
    *,
    n_stories: int,
    mass_per_floor_kg: float,
    target_period_s: float,
) -> float:
    """Closed-form story stiffness for a uniform N-story shear chain.

    Derives the per-story stiffness `k` (kN/m) such that the fundamental period
    of the resulting MDOF stick equals `target_period_s` exactly. SDOF case is
    handled separately because the general formula degenerates at N=1.

    The formula comes from the eigenvalue problem on a uniform shear chain
    with mass `m` per floor and stiffness `k` per story:

        ω_1 = 2 · √(k/m) · sin( π / (2·(2N + 1)) )

    Solving for k:

        k = m · (ω_1 / (2·sin(π/(2·(2N+1)))))²

    Returned in kN/m to match the OpenSees contract.
    """
    if n_stories < 1:
        raise ValueError(f"n_stories must be >= 1, got {n_stories}")
    if mass_per_floor_kg <= 0:
        raise ValueError(f"mass_per_floor_kg must be > 0, got {mass_per_floor_kg}")
    if target_period_s <= 0:
        raise ValueError(f"target_period_s must be > 0, got {target_period_s}")

    omega_1 = 2.0 * math.pi / target_period_s
    if n_stories == 1:
        k_n_per_m = mass_per_floor_kg * omega_1 * omega_1
    else:
        denom = 2.0 * math.sin(math.pi / (2.0 * (2 * n_stories + 1)))
        k_n_per_m = mass_per_floor_kg * (omega_1 / denom) ** 2
    return k_n_per_m / N_PER_KN


def velocity_to_acceleration_mps2(
    velocity_mps: np.ndarray, dt_s: float
) -> np.ndarray:
    """Differentiate a velocity trace to acceleration via central differences.

    Length-preserving (uses `np.gradient`, not `np.diff`). The Scripps ROM
    output is already band-limited to a few Hz, so no low-pass is applied.
    """
    if dt_s <= 0:
        raise ValueError(f"dt_s must be > 0, got {dt_s}")
    if velocity_mps.ndim != 1:
        raise ValueError(f"velocity must be 1-D, got shape {velocity_mps.shape}")
    if velocity_mps.size < 2:
        raise ValueError(f"velocity must have >=2 samples, got {velocity_mps.size}")
    return np.gradient(velocity_mps.astype(np.float64), dt_s)


def build_request(
    *,
    structure: StructureSpec,
    scenario: ScenarioMeta,
    receiver_id: int,
    velocity_trace_mps: np.ndarray,
    dt_s: float,
) -> dict[str, object]:
    """Build the contract-shaped dict for `POST /v1/analyze`.

    Returns a plain dict (not a Pydantic model) so the caller can pass it
    straight to `httpx.post(..., json=...)` without an extra serialization
    step. The shape is validated by the OpenSees side's strict
    `extra="forbid"` Pydantic.
    """
    target_T = estimate_target_period_s(structure)
    mass_per_floor_kg = structure.mass_per_floor_t * KG_PER_TONNE
    k_kN_per_m = derive_uniform_story_stiffness_kN_per_m(
        n_stories=structure.stories,
        mass_per_floor_kg=mass_per_floor_kg,
        target_period_s=target_T,
    )
    damping = SYSTEM_DAMPING_RATIO[structure.system]
    lateral_label = SYSTEM_LATERAL_LABEL[structure.system]

    accel_mps2 = velocity_to_acceleration_mps2(velocity_trace_mps, dt_s)

    return {
        "schema_version": OPENSEES_SCHEMA_VERSION,
        "structure": {
            "schema_version": OPENSEES_SCHEMA_VERSION,
            "structure_id": uuid.uuid4().hex,
            "units": "SI",
            "model": {
                "floors": structure.stories,
                "lateral_system": lateral_label,
                "mass_distribution": "lumped",
                "mdof_stick": {
                    "story_height_m": structure.story_height_m,
                    "mass_per_floor_kg": [mass_per_floor_kg] * structure.stories,
                    "story_stiffness_kN_per_m": [k_kN_per_m] * structure.stories,
                    "damping_ratio": damping,
                    "pdelta_flag": False,
                },
            },
        },
        "ground_motion": {
            "schema_version": OPENSEES_SCHEMA_VERSION,
            "scenario_id": scenario.scenario_id,
            "dt": dt_s,
            "channels": ["x"],
            "units": "m/s^2",
            "samples": [accel_mps2.tolist()],
            "source_metadata": {
                "receiver_id": receiver_id,
                "source_id": scenario.source_id,
                "synthetic_for_demo": True,
            },
        },
    }
