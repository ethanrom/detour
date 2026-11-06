// Fix-set optimiser: plain greedy selection (every remaining candidate is re-evaluated each round, so
// complementary fixes are found), certified against exhaustive search when k is small. The engine is
// injected, so this file never imports it.

import { BLOCKED_PENALTY_SECONDS } from "@/lib/contracts";
import type { FixGain, FixPlan, Objective, PersonaId, PlanFixes, TaskResult } from "@/lib/contracts";
import { applyFixes } from "./apply";
import { generateCandidates } from "./candidates";

/** Stop adding fixes once the best marginal gain is no more than this many seconds. */
export const MIN_GAIN_SECONDS = 0.01;
/** With at most this many candidates the exhaustive search covers all of them. */
export const EXHAUSTIVE_ALL_MAX = 14;
/** Above that, the pool takes this many top candidates from each of the first three greedy rounds. */
export const EXHAUSTIVE_TOP_PER_ROUND = 8;

/** planFixes also attaches the size of the exhaustive pool (outside the frozen FixPlan contract). */
export type FixPlanWithPool = FixPlan & { exhaustivePool?: number };

/** Number of candidates the exhaustive search drew its subsets from; undefined when it did not run. */
export const exhaustivePoolSize = (plan: FixPlan): number | undefined => (plan as FixPlanWithPool).exhaustivePool;

const OBJECTIVE_PERSONAS: PersonaId[] = ["keyboard", "screenreader"];

/** Seconds a persona is charged: its mixture seconds, or the blocked penalty when it cannot finish. */
function chargedSeconds(p: TaskResult["personas"][PersonaId] | undefined): number {
  if (!p) return 0;
  return p.blocked || !Number.isFinite(p.seconds) ? BLOCKED_PENALTY_SECONDS : p.seconds;
}

/** Sum over tasks of keyboard + screen-reader seconds; a blocked persona costs BLOCKED_PENALTY_SECONDS. */
export const defaultObjective: Objective = (results) => {
  let total = 0;
  for (const r of results) for (const persona of OBJECTIVE_PERSONAS) total += chargedSeconds(r.personas[persona]);
  return total;
};

type After = FixGain["after"];

/** Persona seconds per task. Blocked personas are recorded as BLOCKED_PENALTY_SECONDS. */
function summarise(results: TaskResult[]): After {
  const out: After = {};
  for (const r of results) {
    const row: Partial<Record<PersonaId, number>> = {};
    for (const persona of Object.keys(r.personas) as PersonaId[]) row[persona] = chargedSeconds(r.personas[persona]);
    out[r.taskId] = row;
  }
  return out;
}

function* subsets(pool: number[], maxSize: number): Generator<number[]> {
  function* rec(start: number, acc: number[]): Generator<number[]> {
    if (acc.length > 0) yield acc;
    if (acc.length === maxSize) return;
    for (let i = start; i < pool.length; i++) yield* rec(i + 1, [...acc, pool[i]]);
  }
  yield* rec(0, []);
}

/** Indices of the `n` largest values (ties: lowest index first). */
function topIndices(values: Map<number, number>, n: number): number[] {
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, n)
    .map(([i]) => i);
}

export const planFixes: PlanFixes = (page, tasks, evaluate, opts = {}) => {
  const objective = opts.objective ?? defaultObjective;
  const k = Math.max(0, Math.floor(opts.k ?? 3));
  const exhaustiveMaxK = opts.exhaustiveMaxK ?? 3;
  const candidates = generateCandidates(page, tasks);

  let evaluations = 0;
  const memo = new Map<string, { value: number; after: After }>();
  /** Objective of the page with the candidates at `idxs` applied (in candidate order, so the result
   *  does not depend on pick order). Every distinct set is evaluated once. */
  const evalSet = (idxs: number[]) => {
    const sorted = [...idxs].sort((a, b) => a - b);
    const key = sorted.join(",");
    const hit = memo.get(key);
    if (hit) return hit;
    const fixed = sorted.length ? applyFixes(page, sorted.map((i) => candidates[i])) : page;
    evaluations++;
    const results = evaluate(fixed, tasks, { samples: 0 });
    const entry = { value: objective(results), after: summarise(results) };
    memo.set(key, entry);
    return entry;
  };

  const baseline = evalSet([]);

  // Plain greedy: every round re-evaluates the marginal gain of every remaining candidate on top of
  // the current set. Gains can grow as fixes are added (a skip link is worth little until the size
  // picker is reachable), so cached bounds are not safe; evaluations are cheap and memoised.
  const chosen: number[] = [];
  const gains: FixGain[] = [];
  let current = baseline;
  /** Marginal gain of each candidate in rounds 0 (single-fix gains), 1 and 2 (after the first picks). */
  const roundGains: Array<Map<number, number>> = [];
  while (chosen.length < k) {
    const marginal = new Map<number, number>();
    for (let i = 0; i < candidates.length; i++) {
      if (!chosen.includes(i)) marginal.set(i, current.value - evalSet([...chosen, i]).value);
    }
    if (roundGains.length < 3) roundGains.push(marginal);
    let best = -1;
    for (const [i, g] of marginal) if (best < 0 || g > (marginal.get(best) as number)) best = i;
    if (best < 0 || (marginal.get(best) as number) <= MIN_GAIN_SECONDS) break;
    chosen.push(best);
    const next = evalSet(chosen);
    gains.push({ fixId: candidates[best].id, secondsSaved: current.value - next.value, after: next.after });
    current = next;
  }

  const plan: FixPlanWithPool = {
    candidates,
    chosen: chosen.map((i) => candidates[i]),
    gains,
    baselineObjective: baseline.value,
    plannedObjective: current.value,
    k,
    method: "greedy",
    evaluations: 0,
  };

  // Exhaustive certification. Small candidate sets are searched in full; larger ones use the union of the
  // top candidates by single-fix gain and by marginal gain after greedy's first and second picks, plus
  // the greedy picks themselves (so the greedy plan is always compared and the gap cannot be negative).
  if (k <= exhaustiveMaxK) {
    const all = candidates.map((_, i) => i);
    const exPool =
      candidates.length <= EXHAUSTIVE_ALL_MAX
        ? all
        : [...new Set([...roundGains.flatMap((g) => topIndices(g, EXHAUSTIVE_TOP_PER_ROUND)), ...chosen])].sort((a, b) => a - b);
    let best = baseline.value;
    for (const subset of subsets(exPool, k)) best = Math.min(best, evalSet(subset).value);
    plan.method = "greedy+exhaustive";
    plan.exhaustiveObjective = best;
    plan.optimalityGap = current.value - best;
    plan.exhaustivePool = exPool.length;
  }

  plan.evaluations = evaluations;
  return plan;
};

