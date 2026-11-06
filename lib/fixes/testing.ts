// Test helpers for lib/fixes: a toy evaluator standing in for the real engine, and small utilities.
// Not part of the public API (index.ts does not export it).

import type { Evaluate, PageModel, PersonaId, PersonaResult, Task, TaskResult } from "@/lib/contracts";

export function personaResult(id: PersonaId, seconds: number, blocked: boolean): PersonaResult {
  const s = blocked ? 0 : seconds;
  return {
    persona: id,
    seconds: s,
    interval: [s, s],
    strategies: [],
    weights: {},
    representative: id === "mouse" ? "point" : id === "keyboard" ? "tab" : "linear",
    ...(blocked ? { blocked: { stepIndex: 0, reason: "toy evaluator: not reachable" } } : {}),
  };
}

/** Keyboard seconds for one target: its index in focusOrder (a skip link shortcuts everything at or
 *  after its landing stop); null when the target is not focusable. */
function keyboardSteps(page: PageModel, target: string): number | null {
  const i = page.focusOrder.indexOf(target);
  if (i < 0) return null;
  let best = i;
  for (const s of page.skipLinks) {
    const from = page.focusOrder.indexOf(s.from);
    const toRead = page.readingOrder.indexOf(s.to);
    if (from < 0 || toRead < 0) continue;
    const landing = page.focusOrder.findIndex((f) => page.readingOrder.indexOf(f) >= toRead);
    if (landing >= 0 && i >= landing) best = Math.min(best, from + 1 + (i - landing));
  }
  return best;
}

/** Screen-reader seconds for one target: its reading index, divided by 4 when a heading comes before it. */
function screenReaderSteps(page: PageModel, target: string): number | null {
  const i = page.readingOrder.indexOf(target);
  if (i < 0) return null;
  const headingBefore = page.headings.some((h) => {
    const hi = page.readingOrder.indexOf(h);
    return hi >= 0 && hi < i;
  });
  return i / (1 + 3 * (headingBefore ? 1 : 0));
}

/** Deterministic stand-in for the engine. Keyboard = index of each step target in focusOrder (blocked if
 *  absent); screen reader = index in readingOrder / (1 + 3 * [heading before target]); mouse = 1 s per step. */
export const toyEvaluate: Evaluate = (page: PageModel, tasks: Task[]): TaskResult[] =>
  tasks.map((task) => {
    let kb = 0;
    let sr = 0;
    let kbBlocked = false;
    let srBlocked = false;
    for (const step of task.steps) {
      const k = keyboardSteps(page, step.target);
      if (k === null) kbBlocked = true;
      else kb += k;
      const s = screenReaderSteps(page, step.target);
      if (s === null) srBlocked = true;
      else sr += s;
    }
    return {
      taskId: task.id,
      personas: {
        mouse: personaResult("mouse", task.steps.length, false),
        keyboard: personaResult("keyboard", kb, kbBlocked),
        screenreader: personaResult("screenreader", sr, srBlocked),
      },
      explanation: [],
    };
  });

/** Wrap an evaluator and count its calls. */
export function counting(evaluate: Evaluate): { evaluate: Evaluate; calls: () => number } {
  let n = 0;
  return {
    evaluate: (page, tasks, opts) => {
      n++;
      return evaluate(page, tasks, opts);
    },
    calls: () => n,
  };
}

/** Recursively freeze a value so any accidental mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
