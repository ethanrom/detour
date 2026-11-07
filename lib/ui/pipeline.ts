// The pure part of the live pipeline: PageModel + tasks in, results (with the realistic-search
// estimate attached) and fix plans out. No DOM access, so it runs identically in the engine worker
// and on the main thread.

import { evaluate } from "@/lib/engine";
import { applyFixes, planFixes } from "@/lib/fixes";
import { componentKey } from "@/lib/fixes/candidates";
import type { A11yNode, FixPlan, PageModel, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { lexicalScorer, searchTask } from "@/lib/scent";
import { roleWord, taskForNode } from "./pick";

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

/** `samples` 0 skips the Monte Carlo intervals (point estimates only), which is all a re-check compares. */
export function evaluateAll(page: PageModel, tasks: Task[], samples: number = MC_SAMPLES): TaskResult[] {
  const t = normalizeTasks(page, tasks);
  return attachSearch(page, t, evaluate(page, t, { samples }));
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

// ---------------------------------------------------------------------------------------------------------
// Suggested tasks: controls some people cannot use

const SCAN_CAP = 200;
/** A component repeated this many times counts as one suggestion. */
const COLLAPSE_AT = 4;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** The task for a control, worded for the card: an unnamed control is described by what it looks like. */
function barrierTask(page: PageModel, siteId: string, node: A11yNode): Task | null {
  const task = taskForNode(page, siteId, node.id);
  if (!task || clean(node.name)) return task;
  const look = clean(node.hints.visualLabel ?? "");
  const what = ["generic", "text", "paragraph"].includes(node.role) ? "control" : roleWord(node);
  return { ...task, label: `Reach and activate the unnamed ${what}${look ? ` (looks like “${look}”)` : ""}` };
}

/**
 * Controls some people cannot use, as ready-made tasks: every actionable reading stop (up to 200) is timed for
 * the keyboard and screen-reader personas without Monte Carlo, and the ones where either is blocked come
 * first (blocked for both, then document order). A component repeated four or more times (five size options)
 * is offered once; a smaller group (three icon buttons) is listed in full. Short of `limit`, the slowest
 * screen-reader tasks fill the rest.
 */
export function scanBarriers(page: PageModel, siteId: string, limit = 5): Task[] {
  const tasks: Task[] = [];
  const owners: A11yNode[] = [];
  for (const id of page.readingOrder) {
    if (tasks.length >= SCAN_CAP) break;
    const n = page.nodes[id];
    if (!n?.actionable || owners.includes(n)) continue;
    const t = barrierTask(page, siteId, n);
    if (!t) continue;
    tasks.push(t);
    owners.push(n);
  }
  const results = evaluate(page, tasks, { samples: 0, personas: ["keyboard", "screenreader"] });

  const rows = tasks.map((task, order) => {
    const p = results[order].personas;
    return { task, node: owners[order], order, blocked: Number(!!p.keyboard.blocked) + Number(!!p.screenreader.blocked), sr: p.screenreader.seconds };
  });
  const blocked = rows.filter((r) => r.blocked > 0).sort((a, b) => b.blocked - a.blocked || a.order - b.order);
  const groupSize = new Map<string, number>();
  for (const r of blocked) {
    const key = componentKey(r.node);
    if (key !== undefined) groupSize.set(key, (groupSize.get(key) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const barriers = blocked
    .filter((r) => {
      const key = componentKey(r.node);
      if (key === undefined || (groupSize.get(key) ?? 0) < COLLAPSE_AT) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  const chosen = new Set(barriers.map((r) => r.task.id));
  const slowest = rows
    .filter((r) => r.blocked === 0 && !chosen.has(r.task.id))
    .sort((a, b) => b.sr - a.sr || a.order - b.order)
    .slice(0, Math.max(0, limit - barriers.length));
  return [...barriers, ...slowest].map((r) => r.task);
}
