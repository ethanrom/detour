// Monte Carlo simulation of the same foraging process, used to verify the analytic Markov solution.
// It deliberately shares no cost or matrix code with ./model: each simulated user physically walks the
// reading order, paying K + speech per stop, flipping a seeded coin at every heading.

import type { PageModel, Task } from "@/lib/contracts";
import { enterProbability, giveUpStops, prepareStep, type ScentOptions } from "./model";

export interface SimulationResult {
  users: number;
  meanSeconds: number;
  sdSeconds: number;
  /** Standard error of meanSeconds. */
  seSeconds: number;
  pFoundFirstPass: number;
  pFoundHeadings: number;
  meanHeadingsHeard: number;
  meanWrongSections: number;
}

/** mulberry32: small, fast, seedable PRNG with a 2^32 period. Returns floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSearch(
  page: PageModel,
  task: Task,
  stepIndex: number,
  scores: number[],
  opts: ScentOptions = {},
  sim: { users?: number; seed?: number } = {},
): SimulationResult {
  const users = sim.users ?? 20000;
  const rng = mulberry32(sim.seed ?? 1);
  const s = prepareStep(page, task, stepIndex, opts);
  const { K, listenFraction: lf, M, alpha, theta, beta, pMin2 } = s.params;
  const sp = s.speech;
  const tp = s.targetPos;
  const H = s.headings.length;

  const hear = (j: number): number => K + sp[j] * (j === tp ? 1 : lf);

  if (s.mode === "local") {
    let t = 0;
    if (tp > s.cursorPos) for (let j = s.cursorPos + 1; j <= tp; j++) t += hear(j);
    else if (tp < s.cursorPos) for (let j = s.cursorPos - 1; j >= tp; j--) t += hear(j);
    return { users, meanSeconds: t, sdSeconds: 0, seSeconds: 0, pFoundFirstPass: 1, pFoundHeadings: 1, meanHeadingsHeard: 0, meanWrongSections: 0 };
  }

  let mean = 0;
  let m2 = 0;
  let found1 = 0;
  let found12 = 0;
  let heardSum = 0;
  let wrongSum = 0;

  for (let u = 1; u <= users; u++) {
    let t = 0;
    let found = false;
    let pass1 = false;
    let heard = 0;
    let wrong = 0;
    if (s.mode === "search") {
      passes: for (let pass = 1; pass <= 2; pass++) {
        for (let q = 0; q < H; q++) {
          const k = (s.startHeading + q) % H;
          const h = s.headings[k];
          t += K + sp[h.pos] * lf; // press H, skim the heading
          heard++;
          const base = enterProbability(scores[k], alpha, theta);
          const p = pass === 1 ? base : Math.max(base, pMin2);
          if (rng() >= p) continue; // skip
          if (k === s.targetSection) {
            for (let j = h.pos + 1; j <= tp; j++) t += hear(j);
            if (h.pos === tp) t += sp[tp] * (1 - lf);
            found = true;
            pass1 = pass === 1;
            break passes;
          }
          wrong++;
          const r = giveUpStops(h.len, beta);
          for (let j = 1; j <= r; j++) t += K + sp[h.pos + j] * lf;
          t += M; // decide this is not it
        }
      }
      if (!found) t += K; // Ctrl+Home
    }
    if (!found) for (let j = 0; j <= tp; j++) t += hear(j);

    if (found) found12++;
    if (pass1) found1++;
    heardSum += heard;
    wrongSum += wrong;
    const d = t - mean;
    mean += d / u;
    m2 += d * (t - mean);
  }

  const sd = users > 1 ? Math.sqrt(m2 / (users - 1)) : 0;
  return {
    users,
    meanSeconds: mean,
    sdSeconds: sd,
    seSeconds: sd / Math.sqrt(users),
    pFoundFirstPass: found1 / users,
    pFoundHeadings: found12 / users,
    meanHeadingsHeard: heardSum / users,
    meanWrongSections: wrongSum / users,
  };
}
