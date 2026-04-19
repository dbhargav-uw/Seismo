from __future__ import annotations

import math

import numpy as np
import pytest

from app.models.scenario import ScenarioMeta
from app.models.structure import StructureSpec
from app.services.opensees_request import (
    SYSTEM_DAMPING_RATIO,
    SYSTEM_LATERAL_LABEL,
    build_request,
    derive_uniform_story_stiffness_kN_per_m,
    estimate_target_period_s,
    velocity_to_acceleration_mps2,
)


def _scenario(scenario_id: str = "demo_mid", source_id: int = 250) -> ScenarioMeta:
    return ScenarioMeta(
        scenario_id=scenario_id,
        label="Test scenario",
        description="",
        source_id=source_id,
    )


def _structure(**overrides: object) -> StructureSpec:
    base: dict[str, object] = {
        "stories": 5,
        "story_height_m": 3.0,
        "plan_x_m": 20.0,
        "plan_y_m": 20.0,
        "mass_per_floor_t": 500.0,
        "period_guess_s": 0.5,
        "system": "concrete_moment_frame",
    }
    base.update(overrides)
    return StructureSpec(**base)  # type: ignore[arg-type]


def _eigen_T1_for_uniform_chain(
    *, n_stories: int, mass_per_floor_kg: float, k_kN_per_m: float
) -> float:
    """Mirror of the closed-form formula used by the translator (independent
    derivation in the test so we don't tautologically assert the same code)."""
    k_n_per_m = k_kN_per_m * 1000.0
    if n_stories == 1:
        omega_1 = math.sqrt(k_n_per_m / mass_per_floor_kg)
    else:
        omega_1 = (
            2.0
            * math.sqrt(k_n_per_m / mass_per_floor_kg)
            * math.sin(math.pi / (2.0 * (2 * n_stories + 1)))
        )
    return 2.0 * math.pi / omega_1


# --- stiffness derivation ---------------------------------------------------


def test_stiffness_round_trips_through_eigen_for_5_story_target() -> None:
    """Derive k from target T, push k back through the closed-form eigen, and
    confirm we get the target T back. Catches off-by-one in the formula."""
    target_T = 0.5
    n = 5
    m_kg = 500_000.0
    k_kN_per_m = derive_uniform_story_stiffness_kN_per_m(
        n_stories=n,
        mass_per_floor_kg=m_kg,
        target_period_s=target_T,
    )
    recovered_T = _eigen_T1_for_uniform_chain(
        n_stories=n, mass_per_floor_kg=m_kg, k_kN_per_m=k_kN_per_m
    )
    assert recovered_T == pytest.approx(target_T, rel=1e-9)


def test_stiffness_matches_opensees_golden_within_1pct() -> None:
    """The OpenSees subproject ships a golden run with stiffness=80,000 kN/m,
    mass=100,000 kg, n=3 stories → eigen_T1=0.499153 s. Our formula should
    pick the same stiffness when handed that period back."""
    n = 3
    m_kg = 100_000.0
    target_T = 0.499153367187309  # from opensees fixtures/golden_run.json
    k_kN_per_m = derive_uniform_story_stiffness_kN_per_m(
        n_stories=n,
        mass_per_floor_kg=m_kg,
        target_period_s=target_T,
    )
    assert k_kN_per_m == pytest.approx(80_000.0, rel=0.01)


def test_stiffness_sdof_uses_simple_formula() -> None:
    """For N=1 the general formula degenerates; SDOF case must use k = m·ω²."""
    target_T = 0.5
    m_kg = 500_000.0
    k_kN_per_m = derive_uniform_story_stiffness_kN_per_m(
        n_stories=1,
        mass_per_floor_kg=m_kg,
        target_period_s=target_T,
    )
    expected_k_n_per_m = m_kg * (2.0 * math.pi / target_T) ** 2
    assert k_kN_per_m == pytest.approx(expected_k_n_per_m / 1000.0, rel=1e-12)


def test_stiffness_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        derive_uniform_story_stiffness_kN_per_m(
            n_stories=0, mass_per_floor_kg=1.0, target_period_s=1.0
        )
    with pytest.raises(ValueError):
        derive_uniform_story_stiffness_kN_per_m(
            n_stories=3, mass_per_floor_kg=0.0, target_period_s=1.0
        )
    with pytest.raises(ValueError):
        derive_uniform_story_stiffness_kN_per_m(
            n_stories=3, mass_per_floor_kg=1.0, target_period_s=0.0
        )


# --- velocity → acceleration -----------------------------------------------


def test_velocity_to_acceleration_preserves_length() -> None:
    v = np.linspace(0.0, 1.0, 600, dtype=np.float64)
    a = velocity_to_acceleration_mps2(v, dt_s=0.1)
    assert a.shape == (600,)


def test_velocity_to_acceleration_known_signal() -> None:
    """For a linear velocity ramp v=t, acceleration is the constant slope.
    np.gradient on a linear ramp returns the slope at every interior point."""
    dt = 0.1
    v = np.arange(100, dtype=np.float64) * dt  # v = t
    a = velocity_to_acceleration_mps2(v, dt_s=dt)
    # Interior points should be exactly 1.0 (dv/dt). Allow tiny FP slop at edges.
    assert np.allclose(a[1:-1], 1.0, rtol=1e-12)


def test_velocity_to_acceleration_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        velocity_to_acceleration_mps2(np.array([1.0, 2.0, 3.0]), dt_s=0.0)
    with pytest.raises(ValueError):
        velocity_to_acceleration_mps2(np.array([[1.0, 2.0]]), dt_s=0.1)
    with pytest.raises(ValueError):
        velocity_to_acceleration_mps2(np.array([1.0]), dt_s=0.1)


# --- system → damping / lateral mapping ------------------------------------


def test_system_damping_mapping_is_complete_and_in_range() -> None:
    expected = {
        "concrete_moment_frame": 0.05,
        "steel_moment_frame": 0.02,
        "wood_light_frame": 0.05,
        "masonry": 0.07,
    }
    assert SYSTEM_DAMPING_RATIO == expected
    for ratio in SYSTEM_DAMPING_RATIO.values():
        assert 0.0 <= ratio <= 0.5


def test_system_lateral_label_mapping() -> None:
    assert SYSTEM_LATERAL_LABEL["concrete_moment_frame"] == "moment_frame"
    assert SYSTEM_LATERAL_LABEL["steel_moment_frame"] == "moment_frame"
    assert SYSTEM_LATERAL_LABEL["wood_light_frame"] == "shear_wall"
    assert SYSTEM_LATERAL_LABEL["masonry"] == "shear_wall"


# --- target period selection -----------------------------------------------


def test_estimate_target_period_prefers_user_guess() -> None:
    s = _structure(period_guess_s=0.42)
    assert estimate_target_period_s(s) == 0.42


def test_estimate_target_period_falls_back_to_rule_of_thumb() -> None:
    s = _structure(period_guess_s=None)
    # 5 stories × 3 m × 0.073 = c·H^0.75 = 0.073 · 15^0.75 ≈ 0.555 s
    h = s.stories * s.story_height_m
    expected = 0.073 * (h**0.75)
    assert estimate_target_period_s(s) == pytest.approx(expected, rel=1e-12)


# --- full request shape ----------------------------------------------------


def test_build_request_shape_passes_opensees_pydantic() -> None:
    """Building a request and parsing it through the OpenSees-side Pydantic
    mirror catches any contract drift in field names/types."""
    from app.models.opensees import OPENSEES_SCHEMA_VERSION, OpenSeesAnalyzeRequest

    structure = _structure()
    velocity = np.sin(np.linspace(0.0, 6.0 * np.pi, 600)) * 0.05
    body = build_request(
        structure=structure,
        scenario=_scenario(),
        receiver_id=7,
        velocity_trace_mps=velocity,
        dt_s=0.1,
    )

    parsed = OpenSeesAnalyzeRequest.model_validate(body)
    assert parsed.schema_version == OPENSEES_SCHEMA_VERSION
    assert parsed.structure.model.floors == structure.stories
    assert len(parsed.structure.model.mdof_stick.mass_per_floor_kg) == structure.stories
    assert len(parsed.structure.model.mdof_stick.story_stiffness_kN_per_m) == structure.stories
    assert parsed.structure.model.mdof_stick.damping_ratio == 0.05
    assert parsed.ground_motion.units == "m/s^2"
    assert parsed.ground_motion.dt == 0.1
    assert parsed.ground_motion.channels == ["x"]
    assert len(parsed.ground_motion.samples[0]) == 600


def test_build_request_uses_user_period_for_stiffness() -> None:
    """Confirms that overriding period_guess_s flows all the way through to
    a different stiffness array — the most common reviewer question."""
    s_short = _structure(period_guess_s=0.3)
    s_long = _structure(period_guess_s=0.9)
    velocity = np.zeros(600, dtype=np.float64)

    body_short = build_request(
        structure=s_short, scenario=_scenario(), receiver_id=0,
        velocity_trace_mps=velocity, dt_s=0.1,
    )
    body_long = build_request(
        structure=s_long, scenario=_scenario(), receiver_id=0,
        velocity_trace_mps=velocity, dt_s=0.1,
    )

    k_short = body_short["structure"]["model"]["mdof_stick"]["story_stiffness_kN_per_m"][0]  # type: ignore[index]
    k_long = body_long["structure"]["model"]["mdof_stick"]["story_stiffness_kN_per_m"][0]  # type: ignore[index]
    # Shorter period → stiffer building (k ∝ 1/T²).
    ratio = k_short / k_long
    assert ratio == pytest.approx((0.9 / 0.3) ** 2, rel=1e-9)
