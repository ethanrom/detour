// Persona = a set of strategies with prior weights. This module plans every strategy of a
// persona, and mixes the unblocked ones into the contract's PersonaResult.

import type { PageModel, PersonaId, PersonaResult, StrategyId, Task } from "@/lib/contracts";
import { LITERATURE } from "@/lib/params/literature";
import { planKeyboard } from "./keyboard";
import { planMouse } from "./mouse";
import type { PageIndex } from "./pageindex";
import type { Params } from "./params";
import { planScreenReader, SCREEN_READER_STRATEGIES } from "./screenreader";
import type { Planned } from "./trace";

export const PERSONAS: PersonaId[] = ["mouse", "keyboard", "screenreader"];

/** Prior strategy weights of a persona (from the literature for screen-reader users). */
export function priorWeights(persona: PersonaId): Partial<Record<StrategyId, number>> {
  if (persona === "mouse") return { point: 1 };
  if (persona === "keyboard") return { tab: 1 };
  const s = LITERATURE.screenReaderStrategies;
  return { headings: s.headings, find: s.find, linear: s.linear, landmarks: s.landmarks, tab: s.tab };
}

export function personaStrategies(persona: PersonaId): StrategyId[] {
  if (persona === "mouse") return ["point"];
  if (persona === "keyboard") return ["tab"];
  return SCREEN_READER_STRATEGIES;
}

/** Plan every strategy of a persona for one task under a parameter set (Dijkstra at these params). */
export function planPersona(page: PageModel, idx: PageIndex, task: Task, persona: PersonaId, p: Params): Planned[] {
  if (persona === "mouse") return [planMouse(page, task, p)];
  if (persona === "keyboard") return [planKeyboard(page, idx, task, p)];
  return SCREEN_READER_STRATEGIES.map((s) => planScreenReader(page, idx, task, s, p));
}

export interface Mixture {
  /** Effective weights: prior weights renormalised over unblocked strategies (0 for blocked). */
  weights: Partial<Record<StrategyId, number>>;
  /** Indices (into the plan list) of unblocked strategies. */
  live: number[];
}

/** Renormalise prior weights over the unblocked plans. */
export function mixture(persona: PersonaId, plans: Planned[]): Mixture {
  const prior = priorWeights(persona);
  const live: number[] = [];
  let total = 0;
  plans.forEach((pl, i) => {
    if (!pl.result.blocked) {
      live.push(i);
      total += prior[pl.result.strategy] ?? 0;
    }
  });
  const weights: Partial<Record<StrategyId, number>> = {};
  if (live.length === 0) {
    // Everything blocked: report the prior weights so the UI can still list the strategies.
    for (const pl of plans) weights[pl.result.strategy] = prior[pl.result.strategy] ?? 0;
    return { weights, live };
  }
  for (const pl of plans) weights[pl.result.strategy] = 0;
  for (const i of live) {
    const s = plans[i].result.strategy;
    weights[s] = total > 0 ? (prior[s] ?? 0) / total : 1 / live.length;
  }
  return { weights, live };
}

/** PersonaResult at nominal parameters; the interval is left as [seconds, seconds]. */
export function summarise(persona: PersonaId, plans: Planned[]): PersonaResult {
  const { weights, live } = mixture(persona, plans);
  let seconds = 0;
  let representative: StrategyId = plans[0].result.strategy;
  let best = -1;
  for (const i of live) {
    const r = plans[i].result;
    const w = weights[r.strategy] ?? 0;
    seconds += w * r.seconds;
    if (w > best) {
      best = w;
      representative = r.strategy;
    }
  }
  const result: PersonaResult = {
    persona,
    seconds,
    interval: [seconds, seconds],
    strategies: plans.map((pl) => pl.result),
    weights,
    representative,
  };
  if (live.length === 0) result.blocked = plans[0].result.blocked;
  return result;
}
