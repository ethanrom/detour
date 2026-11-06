// Before/after comparison helpers: per-persona deltas, and the per-fix impact derived from FixPlan.gains.

import { BLOCKED_PENALTY_SECONDS, type FixPlan, type PersonaId, type PersonaResult, type TaskResult } from "@/lib/contracts";
import { fmtNum, fmtPercentLess, fmtSeconds, percentLess } from "./format";
import { PERSONA_ORDER } from "./timeline";

export interface PersonaView {
  /** Mixture seconds; undefined when the persona cannot finish. */
  seconds?: number;
  interval?: [number, number];
  /** Reason, when the persona cannot finish. */
  blocked?: string;
}

export function personaView(pr: PersonaResult): PersonaView {
  if (pr.blocked) return { blocked: pr.blocked.reason };
  return { seconds: pr.seconds, interval: pr.interval };
}

export type Change = "faster" | "slower" | "same" | "unblocked" | "newly-blocked" | "still-blocked";

export interface PersonaDelta {
  persona: PersonaId;
  before: PersonaView;
  after: PersonaView;
  change: Change;
  /** Seconds saved (positive is faster). 0 when blocked on either side. */
  savedSeconds: number;
  /** percentLess(before, after); 0 when blocked on either side. */
  percent: number;
  /** True when the time moved by less than NEARLY_SAME_PERCENT but is not exactly unchanged ("17 s → 17 s, about the same"). */
  nearlySame: boolean;
  /** "52 s → 9 s, 83% less" / "Can't finish → 6 s" / "4.3 s, no change". */
  headline: string;
}

/** Changes smaller than this (in percent) read as noise, not as a win or a loss. */
export const NEARLY_SAME_PERCENT = 3;

const EPS = 0.05;

export function comparePersona(persona: PersonaId, before: PersonaResult, after: PersonaResult): PersonaDelta {
  const b = personaView(before);
  const a = personaView(after);
  let change: Change;
  let headline: string;
  let saved = 0;
  let percent = 0;
  let nearlySame = false;
  if (b.seconds === undefined && a.seconds === undefined) {
    change = "still-blocked";
    headline = "Can't finish, before or after";
  } else if (b.seconds === undefined && a.seconds !== undefined) {
    change = "unblocked";
    headline = `Can't finish → ${fmtSeconds(a.seconds)}`;
  } else if (b.seconds !== undefined && a.seconds === undefined) {
    change = "newly-blocked";
    headline = `${fmtSeconds(b.seconds)} → Can't finish`;
  } else {
    const bs = b.seconds as number;
    const as = a.seconds as number;
    saved = bs - as;
    percent = percentLess(bs, as);
    if (Math.abs(saved) < EPS || percent === 0) {
      change = "same";
      headline = `${fmtSeconds(as)}, no change`;
    } else if (Math.abs(percent) < NEARLY_SAME_PERCENT) {
      change = "same";
      nearlySame = true;
      headline = `${fmtSeconds(bs)} → ${fmtSeconds(as)}, about the same`;
    } else {
      change = saved > 0 ? "faster" : "slower";
      headline = `${fmtSeconds(bs)} → ${fmtSeconds(as)}, ${fmtPercentLess(bs, as)}`;
    }
  }
  return { persona, before: b, after: a, change, savedSeconds: saved, percent, nearlySame, headline };
}

export function compareTask(before: TaskResult, after: TaskResult): PersonaDelta[] {
  return PERSONA_ORDER.map((p) => comparePersona(p, before.personas[p], after.personas[p]));
}

/** One sentence for the polite live region once a before/after comparison is shown. */
export function describeComparison(label: string, deltas: readonly PersonaDelta[]): string {
  const names: Record<PersonaId, string> = { mouse: "Mouse", keyboard: "Keyboard", screenreader: "Screen reader" };
  return `After the fixes, for the task ${label}. ${deltas.map((d) => `${names[d.persona]}: ${d.headline.replace("→", "to")}`).join(". ")}.`;
}

// ----- Per-fix impact -----------------------------------------------------------------------------

export interface FixImpact {
  fixId: string;
  /** Objective reduction reported by the planner (includes blocked-persona penalties). */
  objectiveSaved: number;
  /** Real seconds saved for people who could already finish, summed over tasks, by persona. */
  secondsByPersona: Record<PersonaId, number>;
  /** Total of secondsByPersona. */
  seconds: number;
  /** (task, persona) pairs that could not finish before this fix and can afterwards. */
  unblocked: Array<{ taskId: string; persona: PersonaId }>;
}

type Cell = number | "blocked";

function cellFromGain(v: number | undefined, fallback: Cell): Cell {
  if (v === undefined) return fallback;
  if (!Number.isFinite(v) || v >= BLOCKED_PENALTY_SECONDS) return "blocked";
  return v;
}

/**
 * Split the planner's cumulative `gains[].after` into what each fix did on its own:
 * seconds saved for personas that could already finish, and which personas it unblocked.
 */
export function fixImpacts(plan: FixPlan, baseline: readonly TaskResult[]): FixImpact[] {
  const state = new Map<string, Record<PersonaId, Cell>>();
  for (const r of baseline) {
    state.set(r.taskId, {
      mouse: r.personas.mouse.blocked ? "blocked" : r.personas.mouse.seconds,
      keyboard: r.personas.keyboard.blocked ? "blocked" : r.personas.keyboard.seconds,
      screenreader: r.personas.screenreader.blocked ? "blocked" : r.personas.screenreader.seconds,
    });
  }
  return plan.gains.map((g) => {
    const secondsByPersona: Record<PersonaId, number> = { mouse: 0, keyboard: 0, screenreader: 0 };
    const unblocked: FixImpact["unblocked"] = [];
    for (const [taskId, per] of Object.entries(g.after)) {
      const cur = state.get(taskId) ?? { mouse: "blocked", keyboard: "blocked", screenreader: "blocked" };
      for (const persona of PERSONA_ORDER) {
        const old = cur[persona];
        const next = cellFromGain(per[persona], old);
        if (old === "blocked" && next !== "blocked") unblocked.push({ taskId, persona });
        else if (old !== "blocked" && next !== "blocked") secondsByPersona[persona] += old - next;
        cur[persona] = next;
      }
      state.set(taskId, cur);
    }
    const seconds = secondsByPersona.mouse + secondsByPersona.keyboard + secondsByPersona.screenreader;
    return { fixId: g.fixId, objectiveSaved: g.secondsSaved, secondsByPersona, seconds, unblocked };
  });
}

/** "−15 s for screen reader · unblocks keyboard" style fragments for a fix card. */
export function describeImpact(impact: FixImpact): { savings: string[]; unblocks: string[] } {
  const names: Record<PersonaId, string> = { mouse: "mouse", keyboard: "keyboard", screenreader: "screen reader" };
  const savings = PERSONA_ORDER.filter((p) => impact.secondsByPersona[p] >= 0.5).map(
    (p) => `${fmtNum(impact.secondsByPersona[p])} s faster for ${names[p]}`,
  );
  const seen = new Set<string>();
  const unblocks: string[] = [];
  for (const u of impact.unblocked) {
    const key = u.persona;
    if (seen.has(key)) continue;
    seen.add(key);
    unblocks.push(`unblocks ${names[u.persona]}`);
  }
  return { savings, unblocks };
}
