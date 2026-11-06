// Shared generators and reference implementations for the scent tests. Not imported by production code.

import fc from "fast-check";
import { wordCount } from "@/lib/a11y/announce";
import type { PageModel, Task } from "@/lib/contracts";
import { LITERATURE } from "@/lib/params/literature";
import { sectionedPage } from "./demo-pages";
import { enterProbability, giveUpStops, type ResolvedScentOptions, type ScentOptions } from "./model";

export interface Scenario {
  page: PageModel;
  task: Task;
  stepIndex: 0 | 1;
  scores: number[];
  opts: ScentOptions;
  /** Index of the target's section (-1 = preamble) and number of headings, for convenience. */
  headings: number;
}

const MAX_SECTIONS = 6;

export const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    preamble: fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 5 }),
    sections: fc.array(fc.array(fc.integer({ min: 1, max: 14 }), { maxLength: 9 }), { minLength: 1, maxLength: MAX_SECTIONS }),
    scents: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: MAX_SECTIONS, maxLength: MAX_SECTIONS }),
    prevPick: fc.double({ min: 0, max: 0.999999, noNaN: true }),
    targetPick: fc.double({ min: 0, max: 0.999999, noNaN: true }),
    stepIndex: fc.constantFrom(0 as const, 1 as const),
    wpm: fc.integer({ min: 150, max: 450 }),
    listenFraction: fc.double({ min: 0.2, max: 1, noNaN: true }),
    alpha: fc.integer({ min: 2, max: 30 }),
    theta: fc.double({ min: 0.1, max: 0.6, noNaN: true }),
    beta: fc.double({ min: 0, max: 1, noNaN: true }),
    pMin2: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map((g) => {
    const page = sectionedPage({ preamble: g.preamble, sections: g.sections.map((stops, k) => ({ heading: `Section number ${k}`, stops })) });
    const ro = page.readingOrder;
    const prev = ro[Math.floor(g.prevPick * ro.length)];
    const target = ro[Math.floor(g.targetPick * ro.length)];
    const task: Task = {
      id: "t",
      siteId: "s",
      label: "Find the thing",
      grounding: "fixture",
      steps: [
        { target: prev, action: "read" },
        { target, action: "read" },
      ],
    };
    // Step 0 targets `prev` too, so the same page serves both start states.
    if (g.stepIndex === 0) task.steps[0] = { target, action: "read" };
    return {
      page,
      task,
      stepIndex: g.stepIndex,
      scores: g.scents.slice(0, page.headings.length),
      opts: { wpm: g.wpm, listenFraction: g.listenFraction, alpha: g.alpha, theta: g.theta, beta: g.beta, pMin2: g.pMin2 },
      headings: page.headings.length,
    };
  });

/** Independent backward-recursion reference for the expected seconds (no matrices, no shared cost code). */
export function referenceExpectedSeconds(s: Scenario, override: { scores?: number[] } = {}): number {
  const { page, task, stepIndex } = s;
  const scores = override.scores ?? s.scores;
  const o = s.opts;
  const K = o.K ?? LITERATURE.klm.K.value;
  const wpm = o.wpm ?? LITERATURE.speech.wpm.value;
  const lf = o.listenFraction ?? LITERATURE.speech.listenFraction.value;
  const M = o.M ?? LITERATURE.klm.M.value;
  const ro = page.readingOrder;
  const sp = (j: number) => (wordCount(page.nodes[ro[j]].announcement) / wpm) * 60;
  const target = ro.indexOf(task.steps[stepIndex].target);
  const cursor = stepIndex > 0 ? ro.indexOf(task.steps[stepIndex - 1].target) : -1;
  const hpos = page.headings.map((h) => ro.indexOf(h));
  const H = hpos.length;
  const sectionOf = (p: number) => hpos.reduce((acc, hp, k) => (hp <= p ? k : acc), -1);
  const hear = (j: number) => K + sp(j) * (j === target ? 1 : lf);
  const ks = sectionOf(target);

  if (cursor >= 0 && sectionOf(cursor) === ks) {
    let t = 0;
    if (target > cursor) for (let j = cursor + 1; j <= target; j++) t += hear(j);
    else if (target < cursor) for (let j = cursor - 1; j >= target; j--) t += hear(j);
    return t;
  }
  let linear = 0;
  for (let j = 0; j <= target; j++) linear += hear(j);
  if (H === 0) return linear;

  let f = hpos.findIndex((hp) => hp > cursor);
  if (f < 0) f = 0;
  const fallback = K + linear;
  const alpha = o.alpha ?? 10;
  const theta = o.theta ?? 0.35;
  const beta = o.beta ?? 0.4;
  const pMin2 = o.pMin2 ?? 0.5;

  // V[pass][q]: expected remaining seconds on arriving at the q-th heading of the pass.
  const V: number[][] = [new Array(H).fill(0), new Array(H).fill(0)];
  for (let pass = 1; pass >= 0; pass--) {
    for (let q = H - 1; q >= 0; q--) {
      const k = (f + q) % H;
      const next = q + 1 < H ? V[pass][q + 1] : pass === 0 ? V[1][0] : fallback;
      const base = enterProbability(scores[k], alpha, theta);
      const p = pass === 0 ? base : Math.max(base, pMin2);
      const arrive = K + sp(hpos[k]) * lf;
      let enterCost: number;
      if (k === ks) {
        enterCost = hpos[k] === target ? sp(target) * (1 - lf) : 0;
        if (hpos[k] !== target) for (let j = hpos[k] + 1; j <= target; j++) enterCost += hear(j);
        V[pass][q] = arrive + p * enterCost + (1 - p) * next;
      } else {
        const len = (k + 1 < H ? hpos[k + 1] : ro.length) - hpos[k] - 1;
        enterCost = M;
        for (let j = 1; j <= giveUpStops(len, beta); j++) enterCost += K + sp(hpos[k] + j) * lf;
        V[pass][q] = arrive + p * enterCost + next;
      }
    }
  }
  return V[0][0];
}

/** Perfect-knowledge cost, walking H presses from the cursor with wrap-around. */
export function deterministicSeconds(s: Scenario, resolved: Pick<ResolvedScentOptions, "K" | "wpm" | "listenFraction">): number {
  const { page, task, stepIndex } = s;
  const { K, wpm, listenFraction: lf } = resolved;
  const ro = page.readingOrder;
  const sp = (j: number) => (wordCount(page.nodes[ro[j]].announcement) / wpm) * 60;
  const target = ro.indexOf(task.steps[stepIndex].target);
  let cursor = stepIndex > 0 ? ro.indexOf(task.steps[stepIndex - 1].target) : -1;
  const hpos = page.headings.map((h) => ro.indexOf(h));
  const sectionOf = (p: number) => hpos.reduce((acc, hp, k) => (hp <= p ? k : acc), -1);
  const ks = sectionOf(target);
  let t = 0;
  for (let guard = 0; guard < 2 * hpos.length + 2; guard++) {
    let k = hpos.findIndex((hp) => hp > cursor);
    if (k < 0) k = 0;
    t += K + sp(hpos[k]) * lf;
    cursor = hpos[k];
    if (k === ks) {
      if (cursor === target) return t + sp(target) * (1 - lf);
      for (let j = cursor + 1; j <= target; j++) t += K + sp(j) * (j === target ? 1 : lf);
      return t;
    }
  }
  throw new Error("target section is not reachable by H");
}
