// The pure part of the live pipeline: PageModel + tasks in, results (with the realistic-search
// estimate attached) and fix plans out. No DOM access, so it runs identically in the engine worker
// and on the main thread.

import { evaluate } from "@/lib/engine";
import { applyFixes, planFixes } from "@/lib/fixes";
import type { FixPlan, PageModel, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { lexicalScorer, searchTask } from "@/lib/scent";

export const MC_SAMPLES = 400;

/**
 * Pinned task targets name an element by data-detour-id, but a real browser can lay a "row" out as a grid
 * (its spans become blocks), so the row is no longer one reading stop. Retarget a step whose element is not
 * something a user can land on to the stops inside it: the last one for "read" (hear the whole row), the
 * first otherwise. Steps that already point at a stop are untouched, and the input array is returned as is
 * when nothing needs to change.
 */
export function normalizeTasks(page: PageModel, tasks: Task[]): Task[] {
  const reading = new Set(page.readingOrder);
  const landable = (id: string) => {
    const n = page.nodes[id];
    return !!n && (reading.has(id) || n.focusable || n.actionable);
  };
  const stopsInside = (id: string): string[] => {
    const out: string[] = [];
    const walk = (nid: string) => {
      for (const c of page.nodes[nid]?.children ?? []) {
        if (landable(c)) out.push(c);
        walk(c);
      }
    };
    walk(id);
    return out;
  };
  let changed = false;
  const next = tasks.map((t) => {
    let touched = false;
    const steps = t.steps.map((s) => {
      if (!page.nodes[s.target] || landable(s.target)) return s;
      const inside = stopsInside(s.target);
      if (inside.length === 0) return s;
      touched = true;
      return { ...s, target: s.action === "read" ? inside[inside.length - 1] : inside[0] };
    });
    if (!touched) return t;
    changed = true;
    return { ...t, steps };
  });
  return changed ? next : tasks;
}

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
    let search: SearchEstimate | undefined;
    try {
      search = task ? searchEstimate(page, task) : undefined;
    } catch {
      search = undefined; // a step the scent model cannot place: keep the engine's numbers, skip the extra panel
    }
    if (!search) return r;
    return { ...r, personas: { ...r.personas, screenreader: { ...r.personas.screenreader, search } } };
  });
}

export function evaluateAll(page: PageModel, tasks: Task[]): TaskResult[] {
  const t = normalizeTasks(page, tasks);
  return attachSearch(page, t, evaluate(page, t, { samples: MC_SAMPLES }));
}

export interface PlanResult {
  plan: FixPlan;
  page: PageModel;
  results: TaskResult[];
}

export function planAll(page: PageModel, tasks: Task[], k: number): PlanResult {
  const t = normalizeTasks(page, tasks);
  const plan = planFixes(page, t, evaluate, { k });
  const patched = applyFixes(page, plan.chosen);
  return { plan, page: patched, results: evaluateAll(patched, t) };
}
