/**
 * Self-contained test for the auto-collapse trigger.
 *
 * Run from app/frontend:
 *   npx tsx scripts/test-collapse-trigger.ts
 *
 * Exits non-zero on any assertion failure. No backends, no browser, no Vitest.
 *
 * What this proves:
 *   1. `collapseAutoTriggered` fires above the 4% IDR threshold and not below.
 *   2. `collapseFailureStoryIdx` picks the story with the largest |IDR|.
 *   3. `computeCollapseSlabFrame` lands every falling slab on the pancake stack
 *      after enough elapsed time (no slab floats; no slab clips through).
 *   4. The Zustand store auto-flips `responseMode` to `'collapse'` when an
 *      OpenSees result lands with peak IDR above the threshold, and stays in
 *      `'shape'` otherwise. This is the user-visible auto-trigger behavior.
 */

import {
  COLLAPSE_THRESHOLD_IDR,
  collapseAutoTriggered,
  collapseFailureStoryIdx,
  computeCollapseSlabFrame,
} from '../src/features/structure/responseShape';
import { useViabilityStore } from '../src/features/viability/store';
import type { SimulateResult } from '../src/api/types';

let failed = 0;
const assert = (cond: boolean, msg: string): void => {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  }
};

const approx = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

const buildResult = (peakIdrPerStory: number[]): SimulateResult => ({
  scenario: {
    scenario_id: 'demo_high',
    label: 'Strong shaking',
    description: '',
    source_id: 373,
  },
  nearest_receiver_id: 9,
  nearest_distance_km: 5,
  pgv_at_site_mps: 0.001,
  estimated_period_s: 0.5,
  peak_drift_ratio: Math.max(...peakIdrPerStory.map(Math.abs)),
  peak_accel_g: 0,
  score: {
    total: 0.5,
    breakdown: {
      site_hazard: 0.2,
      ground_failure: 0.2,
      structural_response: 0.2,
      uncertainty_penalty: 0.25,
    },
    top_drivers: [],
  },
  synthetic_for_demo: true,
  notes: [],
  peak_roof_disp_m: 0.05,
  base_shear_kN: 100,
  peak_idr_per_story: peakIdrPerStory,
  simulation_id: 'test',
  converged: true,
  eigen_T1_s: 0.5,
  physics_backend: 'opensees',
  floor_disp_history_m: null,
  history_dt_s: null,
});

console.log(`COLLAPSE_THRESHOLD_IDR = ${COLLAPSE_THRESHOLD_IDR}`);

console.log('\n[1] collapseAutoTriggered');
assert(
  collapseAutoTriggered([0.045, 0.03, 0.02, 0.01, 0.005]),
  'IDR with 4.5% peak > 4% threshold → triggers',
);
assert(
  !collapseAutoTriggered([0.039, 0.03, 0.02, 0.01, 0.005]),
  'IDR with 3.9% peak < 4% threshold → does NOT trigger',
);
assert(
  !collapseAutoTriggered([3.2e-7, 2.6e-7, 2.0e-7, 1.3e-7, 6.7e-8]),
  'real Scripps-scale IDR (~1e-7) → does NOT trigger',
);
assert(!collapseAutoTriggered([]), 'empty array → does NOT trigger');
assert(
  collapseAutoTriggered([-0.05, 0.01]),
  'absolute value: peak |-5%| > 4% → triggers (sign-agnostic)',
);

console.log('\n[2] collapseFailureStoryIdx');
assert(
  collapseFailureStoryIdx([0.01, 0.04, 0.02, 0.01]) === 1,
  'argmax of |IDR| = index 1',
);
assert(collapseFailureStoryIdx([]) === -1, 'empty → -1');
assert(collapseFailureStoryIdx([0, 0, 0]) === -1, 'all-zero → -1');
assert(
  collapseFailureStoryIdx([0.01, -0.05, 0.02]) === 1,
  'sign-agnostic argmax',
);

console.log('\n[3] computeCollapseSlabFrame (pancake landing)');
const geo = {
  failureStoryIdx: 0,
  nStories: 5,
  storyHeightM: 3.0,
  slabThicknessM: 0.2,
};
const restFrame = computeCollapseSlabFrame(20.0, geo, [0, 0, 0, 0, 0]);
assert(
  approx(restFrame[0]!.y, 0.1),
  `bottom slab lands at y=0.1 (got ${restFrame[0]!.y})`,
);
assert(
  approx(restFrame[1]!.y, 0.3),
  `2nd slab lands at y=0.3 (got ${restFrame[1]!.y})`,
);
assert(
  approx(restFrame[4]!.y, 0.9),
  `top slab lands at y=0.9 (got ${restFrame[4]!.y})`,
);
const t0Frame = computeCollapseSlabFrame(0, geo, [0, 0, 0, 0, 0]);
assert(
  approx(t0Frame[0]!.y, 1 * 3.0 - 0.1),
  `at t=0, bottom slab still at original y=2.9 (got ${t0Frame[0]!.y})`,
);
assert(
  approx(t0Frame[4]!.y, 5 * 3.0 - 0.1),
  `at t=0, top slab still at original y=14.9 (got ${t0Frame[4]!.y})`,
);

const geoMid = { ...geo, failureStoryIdx: 2 };
const midFrame = computeCollapseSlabFrame(20.0, geoMid, [0, 0, 0, 0, 0]);
assert(
  approx(midFrame[0]!.y, 1 * 3.0 - 0.1),
  `with failure at story 2, slab 0 stays standing at y=2.9 (got ${midFrame[0]!.y})`,
);
assert(
  approx(midFrame[2]!.y, 2 * 3.0 + 0.1),
  `with failure at story 2, first falling slab lands at y=6.1 (got ${midFrame[2]!.y})`,
);

console.log('\n[4] store auto-trigger on result land');
const store = useViabilityStore;
store.getState().setResult(buildResult([3.2e-7, 2.6e-7, 2.0e-7, 1.3e-7, 6.7e-8]));
assert(
  store.getState().responseMode === 'shape',
  `low-IDR result → responseMode='shape' (got '${store.getState().responseMode}')`,
);
store.getState().setResult(buildResult([0.045, 0.03, 0.02, 0.01, 0.005]));
assert(
  store.getState().responseMode === 'collapse',
  `high-IDR result → responseMode='collapse' (got '${store.getState().responseMode}')`,
);
store.getState().setResult(buildResult([0.001, 0.001, 0.001, 0.001, 0.001]));
assert(
  store.getState().responseMode === 'shape',
  `setting another low-IDR result resets back to 'shape' (got '${store.getState().responseMode}')`,
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
