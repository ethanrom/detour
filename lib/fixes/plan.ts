// Fix-set optimiser: lazy greedy (CELF) selection, certified against exhaustive search over the
// most promising candidates when k is small. The engine is injected, so this file never imports it.

import { BLOCKED_PENALTY_SECONDS } from "@/lib/contracts";
import type { FixGain, FixPlan, Objective, PersonaId, PlanFixes, TaskResult } from "@/lib/contracts";
import { applyFixes } from "./apply";
import { generateCandidates } from "./candidates";

/** Stop adding fixes once the best marginal gain is no more than this many seconds. */
export const MIN_GAIN_SECONDS = 0.01;
/** Exhaustive certification looks at this many candidates, ranked by single-fix gain. */
export const EXHAUSTIVE_POOL_SIZE = 12;

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

  // Single-fix gains: the initial upper bounds.
  const singleGain = candidates.map((_, i) => (k > 0 ? baseline.value - evalSet([i]).value : 0));

  // CELF: take the candidate with the highest upper bound; if that bound is stale for the current
  // set, refresh it and look again. A fresh bound at the top is the true best marginal gain.
  const pool = candidates.map((_, i) => ({ i, ub: singleGain[i], stamp: 0 }));
  const chosen: number[] = [];
  const gains: FixGain[] = [];
  let current = baseline;
  while (chosen.length < k && pool.length > 0) {
    let top = 0;
    for (let j = 1; j < pool.length; j++) {
      if (pool[j].ub > pool[top].ub || (pool[j].ub === pool[top].ub && pool[j].i < pool[top].i)) top = j;
    }
    const entry = pool[top];
    if (entry.ub <= MIN_GAIN_SECONDS) break;
    if (entry.stamp === chosen.length) {
      chosen.push(entry.i);
      const next = evalSet(chosen);
      gains.push({ fixId: candidates[entry.i].id, secondsSaved: current.value - next.value, after: next.after });
      current = next;
      pool.splice(top, 1);
    } else {
      entry.ub = current.value - evalSet([...chosen, entry.i]).value;
      entry.stamp = chosen.length;
    }
  }

  const plan: FixPlan = {
    candidates,
    chosen: chosen.map((i) => candidates[i]),
    gains,
    baselineObjective: baseline.value,
    plannedObjective: current.value,
    k,
    method: "greedy",
    evaluations: 0,
  };

  // Exhaustive certification over the top candidates by single-fix gain (plus the greedy picks, so the
  // greedy plan is always one of the subsets compared and the gap cannot be negative).
  if (k <= exhaustiveMaxK) {
    const ranked = candidates
      .map((_, i) => i)
      .sort((a, b) => singleGain[b] - singleGain[a] || a - b)
      .slice(0, EXHAUSTIVE_POOL_SIZE);
    const exPool = [...new Set([...ranked, ...chosen])].sort((a, b) => a - b);
    let best = baseline.value;
    for (const subset of subsets(exPool, k)) best = Math.min(best, evalSet(subset).value);
    plan.method = "greedy+exhaustive";
    plan.exhaustiveObjective = best;
    plan.optimalityGap = current.value - best;
  }

  plan.evaluations = evaluations;
  return plan;
};
