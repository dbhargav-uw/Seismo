"""Manual smoke test: run 10 episodes of the greedy heuristic against the
synthetic initial-state source and print an end-to-end summary.

Run from repo root:

    python -m scripts.rl.smoke_test

This prints per-episode action traces plus aggregate stats. It exists so a
human can eyeball the env + reward + heuristic against the approved v1 plan
before any ML training work. The RL policy itself must beat these numbers
by at least 10 percentage points on success rate (see plan §10).
"""

from __future__ import annotations

from dataclasses import asdict

from scripts.rl.env.retrofit_env import RetrofitEnv
from scripts.rl.heuristic import pick_action


def run_episode(env: RetrofitEnv, seed: int, verbose: bool = True) -> dict:
    obs, info = env.reset(seed=seed)
    initial = env._rt.initial  # noqa: SLF001
    initial_fragility = env._rt.fragility_curr  # noqa: SLF001
    total_reward = 0.0
    trace: list[dict] = []
    terminated = truncated = False
    step = 0
    while not (terminated or truncated):
        dec = pick_action(env)
        obs, reward, terminated, truncated, info = env.step(dec.action_id)
        total_reward += reward
        trace.append(
            {
                "step": step,
                "action_id": dec.action_id,
                "reason": dec.reasoning,
                "reward": round(reward, 3),
                "fragility": round(info["fragility"], 4),
                "max_drift": round(info["max_drift"], 5),
                "spent_usd": info["spent_usd"],
            }
        )
        step += 1

    success = env._rt.fragility_curr <= env._target_fragility  # noqa: SLF001
    summary = {
        "seed": seed,
        "stories": initial.stories,
        "pga_g": initial.pga_g,
        "budget_usd": initial.total_budget_usd,
        "initial_fragility": round(initial_fragility, 4),
        "final_fragility": round(env._rt.fragility_curr, 4),  # noqa: SLF001
        "total_reward": round(total_reward, 3),
        "steps": step,
        "spent_usd": env._rt.spent_usd,  # noqa: SLF001
        "success": success,
        "actions": [t["action_id"] for t in trace],
    }

    if verbose:
        print(
            f"\n── seed {seed} — stories={initial.stories} "
            f"pga={initial.pga_g:.2f}g budget=${int(initial.total_budget_usd):,}"
        )
        print(
            f"   initial fragility {initial_fragility:.3f}  "
            f"→ final {env._rt.fragility_curr:.3f}  "  # noqa: SLF001
            f"({'SUCCESS' if success else 'fail'})"
        )
        for t in trace:
            print(
                f"   step {t['step']:2d}  action={t['action_id']:2d}  "
                f"fragility={t['fragility']:.3f}  r={t['reward']:+.2f}  "
                f"— {t['reason']}"
            )

    return summary


def main(n_episodes: int = 10) -> None:
    env = RetrofitEnv()
    results = [run_episode(env, seed=s) for s in range(n_episodes)]

    n_success = sum(1 for r in results if r["success"])
    print("\n── summary over", n_episodes, "episodes ───────────────────────────")
    print(f"success rate:           {n_success}/{n_episodes}")
    print(
        "mean initial fragility: "
        f"{sum(r['initial_fragility'] for r in results) / len(results):.3f}"
    )
    print(
        "mean final fragility:   "
        f"{sum(r['final_fragility'] for r in results) / len(results):.3f}"
    )
    print(
        "mean spent:             "
        f"${sum(r['spent_usd'] for r in results) / len(results):,.0f}"
    )
    print(
        "mean steps:             "
        f"{sum(r['steps'] for r in results) / len(results):.1f}"
    )


if __name__ == "__main__":
    main()
