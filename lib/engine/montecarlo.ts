// Monte Carlo over parameter ranges and strategy draws.
//
// APPROXIMATION: for speed, each strategy's path is optimised once at *nominal* parameters and
// then only re-costed under every sampled parameter set (one dot product per strategy, see
// cost.ts). A sampled parameter set could in principle make a different path optimal (for example
// a very fast speech rate makes listening to more items cheaper than pressing H), so this
// slightly over-estimates the cost of unlucky draws. `sampleSecondsReoptimised` re-runs the
// shortest-path search per sample; montecarlo.test.ts shows on mini-shop that the two give a p50
// within 10% of each other. Blocked strategies cannot be drawn: weights are renormalised.

import type { PageModel, PersonaId, Task } from "@/lib/contracts";
import { costOf } from "./cost";
import type { PageIndex } from "./pageindex";
import { sampleParams, type Rng } from "./params";
import { mixture, planPersona } from "./persona";
import type { Planned } from "./trace";

/** Linear-interpolated quantile (type 7) of an ascending-sorted array. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = Math.min(Math.max(q, 0), 1) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function cumulativeWeights(persona: PersonaId, plans: Planned[]): { live: number[]; cumulative: number[] } {
  const { weights, live } = mixture(persona, plans);
  const cumulative: number[] = [];
  let acc = 0;
  for (const i of live) {
    acc += weights[plans[i].result.strategy] ?? 0;
    cumulative.push(acc);
  }
  if (cumulative.length > 0) cumulative[cumulative.length - 1] = Infinity;
  return { live, cumulative };
}

function pick(cumulative: number[], u: number): number {
  for (let i = 0; i < cumulative.length; i++) if (u < cumulative[i]) return i;
  return cumulative.length - 1;
}

/** Sampled task seconds with paths fixed at their nominal optimum. Ascending. Empty when every strategy is blocked. */
export function sampleSeconds(persona: PersonaId, plans: Planned[], samples: number, rng: Rng): Float64Array {
  const { live, cumulative } = cumulativeWeights(persona, plans);
  if (live.length === 0 || samples <= 0) return new Float64Array(0);
  const out = new Float64Array(samples);
  for (let s = 0; s < samples; s++) {
    const p = sampleParams(rng);
    const k = pick(cumulative, rng());
    out[s] = costOf(plans[live[k]].total, p);
  }
  return out.sort();
}

/**
 * Same draws as `sampleSeconds`, but every sample re-runs the shortest-path search under its own
 * parameters. Slow (used to validate the approximation, not by evaluate()).
 */
export function sampleSecondsReoptimised(
  page: PageModel,
  idx: PageIndex,
  task: Task,
  persona: PersonaId,
  nominalPlans: Planned[],
  samples: number,
  rng: Rng,
): Float64Array {
  const { live, cumulative } = cumulativeWeights(persona, nominalPlans);
  if (live.length === 0 || samples <= 0) return new Float64Array(0);
  const out = new Float64Array(samples);
  for (let s = 0; s < samples; s++) {
    const p = sampleParams(rng);
    const k = pick(cumulative, rng());
    const plans = planPersona(page, idx, task, persona, p);
    out[s] = plans[live[k]].result.seconds;
  }
  return out.sort();
}
