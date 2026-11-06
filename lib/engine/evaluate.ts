// evaluate(): the engine entry point. For each task and persona it plans every strategy at nominal
// parameters (Dijkstra), mixes the unblocked strategies, runs Monte Carlo for an interval, and
// writes a deterministic explanation.

import type { Evaluate, EvaluateOptions, PageModel, PersonaId, PersonaResult, Task, TaskResult } from "@/lib/contracts";
import { explain } from "./explain";
import { quantile, sampleSeconds } from "./montecarlo";
import { getIndex, type PageIndex } from "./pageindex";
import { deriveSeed, mulberry32, nominalParams, type Params } from "./params";
import { PERSONAS, personaStrategies, planPersona, summarise } from "./persona";

export const DEFAULT_SAMPLES = 400;
export const DEFAULT_SEED = 1;

/** Placeholder for a persona that was not requested (the contract requires all three keys). */
function skipped(persona: PersonaId): PersonaResult {
  return { persona, seconds: 0, interval: [0, 0], strategies: [], weights: {}, representative: personaStrategies(persona)[0] };
}

function evaluateTask(page: PageModel, idx: PageIndex, task: Task, p: Params, personas: PersonaId[], samples: number, seed: number): TaskResult {
  const done: Partial<Record<PersonaId, PersonaResult>> = {};
  for (const persona of personas) {
    const plans = planPersona(page, idx, task, persona, p);
    const result = summarise(persona, plans);
    if (samples > 0 && !result.blocked) {
      const draws = sampleSeconds(persona, plans, samples, mulberry32(deriveSeed(seed, task.id, persona)));
      if (draws.length > 0) {
        // A mixture's mean can sit outside its own 5th-95th percentile band when a rare, very slow
        // strategy dominates it; widen the band just enough to always contain the point estimate.
        result.interval = [Math.min(quantile(draws, 0.05), result.seconds), Math.max(quantile(draws, 0.95), result.seconds)];
      }
    }
    done[persona] = result;
  }
  return {
    taskId: task.id,
    personas: {
      mouse: done.mouse ?? skipped("mouse"),
      keyboard: done.keyboard ?? skipped("keyboard"),
      screenreader: done.screenreader ?? skipped("screenreader"),
    },
    explanation: explain(idx, task, done),
  };
}

/** Evaluate under an explicit parameter set, without Monte Carlo (intervals are [s, s]). */
export function evaluateWithParams(page: PageModel, tasks: Task[], params: Params, opts: Pick<EvaluateOptions, "personas"> = {}): TaskResult[] {
  const idx = getIndex(page);
  return tasks.map((t) => evaluateTask(page, idx, t, params, opts.personas ?? PERSONAS, 0, DEFAULT_SEED));
}

export const evaluate: Evaluate = (page, tasks, opts = {}) => {
  const idx = getIndex(page);
  const p = nominalParams();
  const samples = opts.samples ?? DEFAULT_SAMPLES;
  const seed = opts.seed ?? DEFAULT_SEED;
  const personas = opts.personas ?? PERSONAS;
  return tasks.map((t) => evaluateTask(page, idx, t, p, personas, samples, seed));
};
