"""Step 1 tests: env + reward + masking + heuristic baseline.

Run from repo root:

    python -m pytest scripts/rl/tests -q

These tests do NOT require gymnasium, stable-baselines3, torch, or any
OpenSees service. The env is exercised directly as a plain class against
the synthetic initial-state source.
"""

from __future__ import annotations

import math

import pytest

from scripts.rl.env.delta_model import ActionSpec, DeltaRule, apply_delta
from scripts.rl.env.fragility import hazus_fragility
from scripts.rl.env.initial_state import synthetic_initial_state
from scripts.rl.env.retrofit_env import RetrofitEnv
from scripts.rl.heuristic import pick_action


# -------------------------------------------------------- fragility tests


def test_hazus_fragility_monotone() -> None:
    theta, beta = 0.02, 0.6
    prev = hazus_fragility(1e-6, theta, beta)
    for idr in (0.001, 0.005, 0.01, 0.02, 0.04, 0.08):
        p = hazus_fragility(idr, theta, beta)
        assert 0.0 <= p < 1.0
        assert p >= prev, f"non-monotone at IDR={idr}: prev={prev}, p={p}"
        prev = p


def test_hazus_fragility_at_theta_is_half() -> None:
    # At IDR = theta, Phi(0) = 0.5.
    p = hazus_fragility(0.02, 0.02, 0.6)
    assert math.isclose(p, 0.5, abs_tol=1e-9)


def test_hazus_fragility_rejects_bad_params() -> None:
    with pytest.raises(ValueError):
        hazus_fragility(0.01, 0.0, 0.6)
    with pytest.raises(ValueError):
        hazus_fragility(0.01, 0.02, -0.1)
    with pytest.raises(ValueError):
        hazus_fragility(float("nan"), 0.02, 0.6)


def test_hazus_fragility_zero_drift_returns_zero() -> None:
    assert hazus_fragility(0.0, 0.02, 0.6) == 0.0


# -------------------------------------------------------- delta model tests


def test_apply_delta_damper_reduces_target_and_adjacent() -> None:
    profile = [0.004, 0.007, 0.010, 0.008, 0.005]
    rule = DeltaRule(
        drift_reduction_at_target=0.25,
        drift_reduction_at_adjacent=0.08,
        t1_change_fraction=0.0,
    )
    action = ActionSpec(action_id=3, type="add_damper", story=3)  # story=3 → index 2
    new_profile, new_t1 = apply_delta(profile, 0.85, action, rule)
    assert math.isclose(new_profile[2], 0.010 * 0.75, abs_tol=1e-9)
    assert math.isclose(new_profile[1], 0.007 * 0.92, abs_tol=1e-9)
    assert math.isclose(new_profile[3], 0.008 * 0.92, abs_tol=1e-9)
    assert new_profile[0] == 0.004  # untouched
    assert new_profile[4] == 0.005  # untouched
    assert math.isclose(new_t1, 0.85, abs_tol=1e-9)  # damper doesn't change T1


def test_apply_delta_do_nothing_is_noop() -> None:
    profile = [0.004, 0.007, 0.010]
    action = ActionSpec(action_id=0, type="do_nothing", story=None)
    new_profile, new_t1 = apply_delta(profile, 0.55, action, None)
    assert new_profile == profile
    assert new_t1 == 0.55


def test_apply_delta_rejects_oob_story() -> None:
    profile = [0.004, 0.007, 0.010]
    rule = DeltaRule(
        drift_reduction_at_target=0.25,
        drift_reduction_at_adjacent=0.08,
        t1_change_fraction=0.0,
    )
    action = ActionSpec(action_id=5, type="add_damper", story=5)
    with pytest.raises(ValueError):
        apply_delta(profile, 0.85, action, rule)


# -------------------------------------------------------- env basic invariants


def test_env_reset_returns_valid_observation() -> None:
    env = RetrofitEnv()
    obs, info = env.reset(seed=42)
    assert obs.shape == (env.obs_dim,)
    assert info["step"] == 0
    assert info["source"] == "synthetic"
    assert 0.0 <= info["fragility"] <= 1.0


def test_env_action_masks_obey_stories_and_budget() -> None:
    env = RetrofitEnv()
    env.reset(seed=123)
    rt = env._require_runtime()
    mask = env.action_masks()
    # do_nothing must always be valid for a fresh episode
    assert mask[0], "do_nothing must always be valid"
    # Every action targeting a story > current stories must be masked out.
    for spec in env._action_specs:
        if spec.story is not None and spec.story > rt.initial.stories:
            assert not mask[spec.action_id], f"mask leaked OOB story: {spec}"
    # Every masked-in action must fit remaining budget.
    remaining = rt.initial.total_budget_usd - rt.spent_usd
    for spec in env._action_specs:
        if mask[spec.action_id]:
            assert env._costs[spec.type] <= remaining + 1e-6


def test_env_step_fragility_non_increasing_after_retrofit() -> None:
    # For any valid non-do-nothing action the delta rules strictly reduce
    # (or leave equal) the peak drift → fragility is non-increasing.
    env = RetrofitEnv()
    env.reset(seed=7)
    before = env._rt.fragility_curr  # noqa: SLF001
    mask = env.action_masks()
    # Pick the first non-do_nothing action that is valid.
    picked = next(spec for spec in env._action_specs if spec.action_id != 0 and mask[spec.action_id])
    _, reward, terminated, truncated, info = env.step(picked.action_id)
    assert info["fragility"] <= before + 1e-9
    assert isinstance(reward, float)
    assert isinstance(terminated, bool)
    assert isinstance(truncated, bool)


def test_env_budget_exhaustion_terminates() -> None:
    env = RetrofitEnv()
    env.reset(seed=9)
    # Force budget exhaustion by spending every step on the priciest affordable
    # action until failure or success.
    terminated = False
    steps = 0
    while not terminated and steps < 50:
        mask = env.action_masks()
        non_noop = [i for i in range(env.n_actions) if i != 0 and mask[i]]
        if not non_noop:
            # No money for any real action: do_nothing until truncation or
            # budget-exhaustion termination fires naturally.
            _, _, terminated, truncated, _ = env.step(0)
            assert terminated or truncated
            break
        _, _, terminated, truncated, info = env.step(non_noop[0])
        steps += 1
    assert steps < 50, "budget should have forced termination well within 50 steps"


def test_env_infeasible_bypass_safety_net() -> None:
    # Caller bypasses the mask by emitting an action the mask says is invalid
    # (e.g., story = 5 for a 3-story building). Env must not mutate physical
    # state and must terminate cleanly with the HARD penalty applied.
    env = RetrofitEnv()
    env.reset(seed=4)
    rt = env._require_runtime()
    # Find an invalid story action guaranteed by the runtime.
    if rt.initial.stories < 5:
        target = next(
            spec for spec in env._action_specs
            if spec.story is not None and spec.story > rt.initial.stories
        )
        prev_fragility = rt.fragility_curr
        _, reward, terminated, truncated, info = env.step(target.action_id)
        assert terminated
        assert not truncated
        # Physical state unchanged beyond the step counter.
        assert info["fragility"] == prev_fragility
        # HARD penalty dominates for bypass actions.
        assert reward < 0


# -------------------------------------------------------- heuristic baseline


def test_heuristic_always_emits_valid_action() -> None:
    env = RetrofitEnv()
    for seed in range(20):
        env.reset(seed=seed)
        for _ in range(env._max_steps):
            dec = pick_action(env)
            mask = env.action_masks()
            assert mask[dec.action_id], f"heuristic emitted invalid action {dec}"
            _, _, terminated, truncated, _ = env.step(dec.action_id)
            if terminated or truncated:
                break


def test_heuristic_stops_at_target() -> None:
    # When fragility is already below target, the heuristic must pick
    # do_nothing rather than spend budget.
    env = RetrofitEnv()
    env.reset(seed=2)
    # Force fragility low by directly modifying runtime.
    env._rt.fragility_curr = 0.01  # noqa: SLF001
    dec = pick_action(env)
    assert dec.action_id == 0
