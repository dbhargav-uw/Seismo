"""Greedy heuristic baseline for the retrofit design-search problem.

The RL policy must beat this by at least 10 percentage points on success
rate (see §10 of the approved plan) to justify shipping a trained model
instead of the heuristic itself. This baseline is therefore a first-class
deliverable — step 1 ships the heuristic and the env together.

Rule:
  1. If fragility is already at/below target, return do_nothing.
  2. Otherwise, find the story with the highest current IDR.
  3. Pick the cheapest affordable action targeting that story. Preference
     order is (add_brace, add_damper, upgrade_column) — cheapest first —
     restricted to actions the env currently considers feasible.
  4. If no affordable action exists, return do_nothing (episode will end
     on budget-exhaustion check).
"""

from __future__ import annotations

from dataclasses import dataclass

from .env.retrofit_env import RetrofitEnv


@dataclass(frozen=True)
class HeuristicDecision:
    action_id: int
    reasoning: str


# Cheap-first order, restricted to v1 action types.
_PREFERRED_TYPES: tuple[str, ...] = ("add_brace", "add_damper", "upgrade_column")


def pick_action(env: RetrofitEnv) -> HeuristicDecision:
    """Return the heuristic's next action for the given env's current state.

    Relies on the env's public surface only: observation is not required;
    this reads the live runtime fields and action masks directly. Keeps the
    heuristic honest about what the env permits, so any invalid actions are
    impossible by construction.
    """
    rt = env._require_runtime()  # noqa: SLF001 - intentional coupling; env owns state
    mask = env.action_masks()
    target = env._target_fragility  # noqa: SLF001
    if rt.fragility_curr <= target:
        return HeuristicDecision(
            action_id=0,
            reasoning=f"fragility {rt.fragility_curr:.3f} already at/below target {target:.3f}",
        )

    # Find the worst-drift story (1-indexed to match action spec convention).
    if not rt.drift_profile:
        return HeuristicDecision(action_id=0, reasoning="empty drift profile")
    worst_story = max(range(len(rt.drift_profile)), key=lambda k: rt.drift_profile[k]) + 1

    for action_type in _PREFERRED_TYPES:
        # Reverse-lookup the action_id for this (type, story). The env config
        # already enumerates 16 actions; we scan and match once.
        for spec in env._action_specs:  # noqa: SLF001
            if spec.type != action_type or spec.story != worst_story:
                continue
            if not mask[spec.action_id]:
                continue
            return HeuristicDecision(
                action_id=spec.action_id,
                reasoning=(
                    f"worst drift at story {worst_story} ({rt.drift_profile[worst_story - 1]:.4f}); "
                    f"cheapest feasible: {action_type}"
                ),
            )

    return HeuristicDecision(
        action_id=0,
        reasoning="no affordable story-targeted action; deferring to do_nothing",
    )
