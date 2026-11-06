// Cross-checks the engine against independently written brute-force oracles (Bellman-Ford over
// explicitly enumerated edges) on random pages, and checks that every emitted trace is a legal walk.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { wordCount } from "@/lib/a11y/announce";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import type { PageModel, StrategyId, Task, TraceEvent } from "@/lib/contracts";
import { evaluate, findQuery, nominalParams } from "./index";
import { words } from "./testkit";

const p = nominalParams();

// ---------- random pages ----------

interface Item {
  kind: "p" | "h" | "l" | "b";
  nWords: number;
  seed: number;
}

const itemArb = fc.record({
  kind: fc.constantFrom<Item["kind"]>("p", "p", "p", "h", "l", "l", "b"),
  nWords: fc.integer({ min: 1, max: 5 }),
  seed: fc.integer({ min: 0, max: 6 }),
});

const pageArb = fc.record({
  items: fc.array(itemArb, { minLength: 3, maxLength: 26 }),
  navStart: fc.nat(),
  navLen: fc.integer({ min: 0, max: 8 }),
  skipTo: fc.option(fc.nat(), { nil: undefined }),
  target: fc.nat(),
  second: fc.nat(),
});

type Generated = ReturnType<typeof makePage>;

function makePage(g: { items: Item[]; navStart: number; navLen: number; skipTo: number | undefined; target: number; second: number }) {
  const specs: Spec[] = g.items.map((it, i) => {
    const name = words(it.seed, it.nWords);
    const rect = { x: 10, y: 40 * i, w: 120, h: 24 };
    if (it.kind === "h") return { id: `i${i}`, role: "heading", level: 2, name, tag: "h2", rect };
    if (it.kind === "l") return { id: `i${i}`, role: "link", name, tag: "a", rect };
    if (it.kind === "b") return { id: `i${i}`, role: "button", name, tag: "button", rect };
    return { id: `i${i}`, role: "paragraph", name, tag: "p", rect };
  });
  const n = specs.length;
  const start = g.navStart % n;
  const len = Math.min(g.navLen, n - start);
  const body: Spec[] =
    len >= 1
      ? [...specs.slice(0, start), { id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, hints: { repetitiveBlock: true }, children: specs.slice(start, start + len) }, ...specs.slice(start + len)]
      : specs;
  const kids: Spec[] = g.skipTo === undefined ? body : [{ id: "skip", role: "link", name: "Skip", tag: "a", href: `i${g.skipTo % n}`, rect: { x: 0, y: -40, w: 50, h: 20 } }, ...body];
  const page = buildPage({ id: "root", role: "document", stop: false, children: kids }, { title: "Random page here" });
  return { page, n, targetId: `i${g.target % n}`, secondId: `i${g.second % n}` };
}

// ---------- oracle: screen reader ----------

/** Cheapest cost of reaching `targetId` from before the first stop, or Infinity. Reading only (no activation). */
function oracleScreenReader(page: PageModel, strategy: StrategyId, targetId: string): number {
  const ro = page.readingOrder;
  const N = ro.length;
  const t = ro.indexOf(targetId);
  const ann = ro.map((id) => page.nodes[id].announcement);
  const wordsOf = ann.map(wordCount);
  const speech = (j: number) => (wordsOf[j] * 60) / p.speechWpm * (j === t ? 1 : p.listenFraction);
  const arrive = (j: number) => p.K + speech(j);
  const headingPos = new Set(page.headings.map((h) => ro.indexOf(h)));
  // Landmark entry stops: the first reading stop that has the landmark as an ancestor.
  const landmarkStart = new Set<number>();
  for (const lm of page.landmarks) {
    for (let j = 0; j < N; j++) {
      let cur: string | null = ro[j];
      let inside = false;
      while (cur) {
        if (cur === lm) inside = true;
        cur = page.nodes[cur].parentId;
      }
      if (inside) {
        landmarkStart.add(j);
        break;
      }
    }
  }
  const focusPos = new Set(page.focusOrder.map((id) => ro.indexOf(id)));
  const firstAfter = (pred: (j: number) => boolean, p0: number) => {
    for (let j = p0 + 1; j < N; j++) if (pred(j)) return j;
    return -1;
  };
  const query = findQuery(page.nodes[targetId].name).toLowerCase();
  const matches = (j: number) => ann[j].toLowerCase().includes(query);

  const cmds: Record<string, string[]> = {
    headings: ["next", "prev", "heading", "tab"],
    linear: ["next"],
    find: ["find", "next"],
    landmarks: ["landmark", "next"],
    tab: ["tab"],
  };
  const allowed = cmds[strategy];
  // State = (layer, p + 1); layer 1 = a find query is active.
  const idx = (layer: number, pos: number) => layer * (N + 1) + pos + 1;
  const dist = new Array<number>(2 * (N + 1)).fill(Infinity);
  dist[idx(0, -1)] = 0;
  for (let round = 0; round < 2 * (N + 1); round++) {
    let changed = false;
    for (let layer = 0; layer < 2; layer++) {
      for (let pos = -1; pos < N; pos++) {
        const d = dist[idx(layer, pos)];
        if (d === Infinity) continue;
        const relax = (toLayer: number, j: number, w: number) => {
          if (j >= 0 && j < N && d + w < dist[idx(toLayer, j)] - 1e-15) {
            dist[idx(toLayer, j)] = d + w;
            changed = true;
          }
        };
        if (allowed.includes("next")) relax(layer, pos + 1, arrive(pos + 1));
        if (allowed.includes("prev") && pos - 1 >= 0) relax(layer, pos - 1, arrive(pos - 1));
        if (allowed.includes("heading")) relax(layer, firstAfter((j) => headingPos.has(j), pos), arrive(firstAfter((j) => headingPos.has(j), pos)));
        if (allowed.includes("landmark")) relax(layer, firstAfter((j) => landmarkStart.has(j), pos), arrive(firstAfter((j) => landmarkStart.has(j), pos)));
        if (allowed.includes("tab")) {
          const j = pos < 0 ? ro.indexOf(page.focusOrder[0] ?? "") : firstAfter((q) => focusPos.has(q), pos);
          relax(layer, j, j >= 0 ? arrive(j) : 0);
        }
        if (allowed.includes("find") && query.length > 0) {
          const j = firstAfter(matches, pos);
          if (j >= 0) relax(1, j, layer === 0 ? (2 + query.length) * p.K + speech(j) : arrive(j));
        }
      }
    }
  }
  return Math.min(dist[idx(0, t)], dist[idx(1, t)]);
}

// ---------- oracle: keyboard ----------

function oracleKeyboard(page: PageModel, targetId: string): number {
  const kf = p.K * p.keyboardMotorFactor;
  const F = page.focusOrder.length;
  const f = page.focusOrder.indexOf(targetId);
  if (f < 0) return Infinity;
  // Document order by explicit DFS.
  const doc = new Map<string, number>();
  const walk = (id: string) => {
    doc.set(id, doc.size);
    for (const c of page.nodes[id].children) walk(c);
  };
  walk(page.root);
  const edges: Array<[number, number]> = []; // between focus indices, shifted by one (0 = before first)
  for (let s = 0; s < F; s++) edges.push([s, s + 1]);
  for (let s = 2; s <= F; s++) edges.push([s, s - 1]);
  for (const sl of page.skipLinks) {
    const from = page.focusOrder.indexOf(sl.from);
    if (from < 0) continue;
    const dest = page.focusOrder.map((id, i) => ({ id, i })).filter((x) => doc.get(x.id)! >= doc.get(sl.to)!).sort((a, b) => doc.get(a.id)! - doc.get(b.id)!)[0];
    if (dest) edges.push([from + 1, dest.i + 1]);
  }
  const dist = new Array<number>(F + 1).fill(Infinity);
  dist[0] = 0;
  for (let round = 0; round <= F; round++) for (const [a, b] of edges) if (dist[a] + kf < dist[b]) dist[b] = dist[a] + kf;
  return dist[f + 1];
}

// ---------- legal-walk checker ----------

function checkWalk(page: PageModel, events: TraceEvent[]): void {
  const ro = page.readingOrder;
  const headingPos = new Set(page.headings.map((h) => ro.indexOf(h)));
  let pos = -1;
  for (const e of events) {
    if (!e.nodeId || !e.utterance || e.command === "think") continue;
    const j = ro.indexOf(e.nodeId);
    expect(j, `${e.label} lands on a reading stop`).toBeGreaterThanOrEqual(0);
    if (e.command === "next") expect(j).toBe(pos + 1);
    else if (e.command === "prev") expect(j).toBe(pos - 1);
    else if (e.command === "nextHeading") {
      expect(headingPos.has(j)).toBe(true);
      for (let q = pos + 1; q < j; q++) expect(headingPos.has(q)).toBe(false);
    } else if (e.command === "tab") {
      expect(page.focusOrder).toContain(e.nodeId);
      for (let q = pos + 1; q < j; q++) expect(page.focusOrder).not.toContain(ro[q]);
    } else if (e.command === "shiftTab") {
      expect(page.focusOrder).toContain(e.nodeId);
    } else if (e.command === "find") {
      expect(j).toBeGreaterThan(pos);
    }
    pos = j;
  }
}

describe("oracles on random pages", () => {
  const task = (g: Generated, steps: Array<"activate" | "read">): Task => ({
    id: "t",
    siteId: "s",
    label: "t",
    grounding: "fixture",
    steps: steps.map((action, i) => ({ target: i === 0 ? g.targetId : g.secondId, action })),
  });

  it("every screen-reader strategy equals the brute-force shortest path", () => {
    fc.assert(
      fc.property(pageArb, (raw) => {
        const g = makePage(raw);
        const result = evaluate(g.page, [task(g, ["read"])], { samples: 0 })[0].personas.screenreader;
        const title = (wordCount(g.page.title) * 60) / p.speechWpm;
        for (const s of result.strategies) {
          const expected = oracleScreenReader(g.page, s.strategy, g.targetId);
          if (expected === Infinity) {
            expect(s.blocked, `${s.strategy} should be blocked`).toBeDefined();
          } else {
            expect(s.blocked, `${s.strategy} should not be blocked`).toBeUndefined();
            expect(s.seconds - title - p.M).toBeCloseTo(expected, 9);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it("the keyboard Tab / Shift+Tab / skip-link path equals the brute-force shortest path", () => {
    fc.assert(
      fc.property(pageArb, (raw) => {
        const g = makePage(raw);
        const kb = evaluate(g.page, [task(g, ["activate"])], { samples: 0 })[0].personas.keyboard;
        const expected = oracleKeyboard(g.page, g.targetId);
        if (expected === Infinity) {
          expect(kb.blocked).toBeDefined();
        } else {
          expect(kb.blocked).toBeUndefined();
          expect(kb.seconds).toBeCloseTo(p.M + expected + p.K * p.keyboardMotorFactor, 9);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("every emitted screen-reader move is a legal command from the previous position (two-step tasks)", () => {
    fc.assert(
      fc.property(pageArb, (raw) => {
        const g = makePage(raw);
        const result = evaluate(g.page, [task(g, ["activate", "read"])], { samples: 0 })[0].personas.screenreader;
        for (const s of result.strategies) {
          if (s.blocked) continue;
          for (const step of s.steps) {
            // Each step starts where the previous one ended.
            const prevEnd = s.steps[step.stepIndex - 1]?.target ?? null;
            const events = step.events;
            if (prevEnd) {
              const first = events.find((e) => e.utterance && e.command !== "think");
              if (first) checkWalkFrom(g.page, events, g.page.readingOrder.indexOf(prevEnd));
            } else {
              checkWalk(g.page, events);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("totals are consistent: seconds = sum of step seconds = sum of event durations; mixture is the weighted mean", () => {
    fc.assert(
      fc.property(pageArb, (raw) => {
        const g = makePage(raw);
        const r = evaluate(g.page, [task(g, ["activate", "read"])], { samples: 20 })[0];
        for (const persona of Object.values(r.personas)) {
          let mix = 0;
          for (const s of persona.strategies) {
            const evSum = s.steps.reduce((a, st) => a + st.events.reduce((b, e) => b + e.dt, 0), 0);
            expect(s.seconds).toBeCloseTo(evSum, 9);
            if (!s.blocked) mix += (persona.weights[s.strategy] ?? 0) * s.seconds;
          }
          if (!persona.blocked) expect(persona.seconds).toBeCloseTo(mix, 9);
          expect(persona.interval[0]).toBeLessThanOrEqual(persona.seconds + 1e-9);
          expect(persona.interval[1]).toBeGreaterThanOrEqual(persona.seconds - 1e-9);
        }
      }),
      { numRuns: 60 },
    );
  });
});

/** Same as checkWalk, but starting from a known cursor position (steps after the first). */
function checkWalkFrom(page: PageModel, events: TraceEvent[], start: number): void {
  const ro = page.readingOrder;
  const headingPos = new Set(page.headings.map((h) => ro.indexOf(h)));
  let pos = start;
  for (const e of events) {
    if (!e.nodeId || !e.utterance || e.command === "think") continue;
    const j = ro.indexOf(e.nodeId);
    if (e.command === "next") expect(j).toBe(pos + 1);
    else if (e.command === "prev") expect(j).toBe(pos - 1);
    else if (e.command === "nextHeading") {
      expect(headingPos.has(j)).toBe(true);
      for (let q = pos + 1; q < j; q++) expect(headingPos.has(q)).toBe(false);
    } else if (e.command === "tab") expect(j).toBeGreaterThan(pos);
    else if (e.command === "shiftTab") expect(j).toBeLessThan(pos);
    else if (e.command === "find") expect(j).toBeGreaterThan(pos);
    pos = j;
  }
}
