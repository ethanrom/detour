// The pure part of the live pipeline: PageModel + tasks in, results (with the realistic-search
// estimate attached) and fix plans out. No DOM access, so it runs identically in the engine worker
// and on the main thread.

import { evaluate } from "@/lib/engine";
import { applyFixes, planFixes } from "@/lib/fixes";
import type { FixPlan, PageModel, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { lexicalScorer, searchTask } from "@/lib/scent";

export const MC_SAMPLES = 400;

/** Screen-reader information-scent search for one task, or undefined when no step needs a heading search. */
export function searchEstimate(page: PageModel, task: Task): SearchEstimate | undefined {
  const { steps } = searchTask(page, task, lexicalScorer, {});
  if (steps.length === 0 || steps.every((s) => s.mode === "local")) return undefined;
  const seconds = steps.reduce((a, s) => a + s.seconds, 0);
  const shortestSeconds = steps.reduce((a, s) => a + s.shortestSeconds, 0);
  const dominant = steps.reduce((best, s) => (s.seconds - s.shortestSeconds > best.seconds - best.shortestSeconds ? s : best), steps[0]);
  return {
    seconds,
    shortestSeconds,
    pFoundFirstPass: dominant.pFoundFirstPass,
    expectedWrongSections: dominant.expectedWrongSections,
    perHeading: dominant.perHeading.map((h) => ({
      nodeId: h.nodeId,
      label: h.label,
      scent: h.scent,
      pEnter: h.pEnter,
      expectedVisits: h.expectedVisits,
      containsTarget: h.containsTarget,
    })),
  };
}

/** Attach `personas.screenreader.search` to every result whose task needs a heading search. */
export function attachSearch(page: PageModel, tasks: Task[], results: TaskResult[]): TaskResult[] {
  return results.map((r) => {
    const task = tasks.find((t) => t.id === r.taskId);
    const search = task ? searchEstimate(page, task) : undefined;
    if (!search) return r;
    return { ...r, personas: { ...r.personas, screenreader: { ...r.personas.screenreader, search } } };
  });
}

export function evaluateAll(page: PageModel, tasks: Task[]): TaskResult[] {
  return attachSearch(page, tasks, evaluate(page, tasks, { samples: MC_SAMPLES }));
}

export interface PlanResult {
  plan: FixPlan;
  page: PageModel;
  results: TaskResult[];
}

export function planAll(page: PageModel, tasks: Task[], k: number): PlanResult {
  const plan = planFixes(page, tasks, evaluate, { k });
  const patched = applyFixes(page, plan.chosen);
  return { plan, page: patched, results: evaluateAll(patched, tasks) };
}
