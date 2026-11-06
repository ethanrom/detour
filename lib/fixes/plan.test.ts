import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BLOCKED_PENALTY_SECONDS, type Evaluate, type PageModel, type Task, type TaskResult } from "@/lib/contracts";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { applyFixes, defaultObjective, generateCandidates, planFixes } from "./index";
import { counting, personaResult, toyEvaluate } from "./testing";

const results = (kb: number, sr: number, opts: { kbBlocked?: boolean; srBlocked?: boolean; mouse?: number } = {}): TaskResult[] => [
  {
    taskId: "t",
    personas: {
      mouse: personaResult("mouse", opts.mouse ?? 1, false),
      keyboard: personaResult("keyboard", kb, !!opts.kbBlocked),
      screenreader: personaResult("screenreader", sr, !!opts.srBlocked),
    },
    explanation: [],
  },
];

/** An evaluator whose cost is an arbitrary function of the page (charged to the keyboard persona of task 1). */
const fromFeatures =
  (cost: (page: PageModel) => number): Evaluate =>
  (page, tasks) =>
    tasks.map((t, i) => ({ taskId: t.id, personas: { mouse: personaResult("mouse", 1, false), keyboard: personaResult("keyboard", i === 0 ? cost(page) : 0, false), screenreader: personaResult("screenreader", 0, false) }, explanation: [] }));

describe("defaultObjective", () => {
  it("sums keyboard and screen-reader seconds over tasks and ignores the mouse", () => {
    expect(defaultObjective(results(10, 20, { mouse: 999 }))).toBe(30);
    expect(defaultObjective([...results(10, 20), ...results(1, 2)])).toBe(33);
    expect(defaultObjective([])).toBe(0);
  });

  it("charges the blocked penalty to blocked personas", () => {
    expect(defaultObjective(results(10, 20, { kbBlocked: true }))).toBe(BLOCKED_PENALTY_SECONDS + 20);
    expect(defaultObjective(results(10, 20, { kbBlocked: true, srBlocked: true }))).toBe(2 * BLOCKED_PENALTY_SECONDS);
  });
});

describe("planFixes with the toy evaluator on mini-shop", () => {
  const counter = counting(toyEvaluate);
  const plan = planFixes(miniShop, miniShopTasks, counter.evaluate);

  it("picks a plan that beats the baseline and reports consistent numbers", () => {
    expect(plan.k).toBe(3);
    expect(plan.candidates).toEqual(generateCandidates(miniShop, miniShopTasks));
    expect(plan.chosen.length).toBeGreaterThan(0);
    expect(plan.chosen.length).toBeLessThanOrEqual(3);
    expect(plan.chosen.map((c) => c.id)).toEqual(plan.gains.map((g) => g.fixId));
    expect(plan.baselineObjective).toBe(defaultObjective(toyEvaluate(miniShop, miniShopTasks)));
    // The size picker is unreachable by keyboard (blocked), so making it real buttons is the first win.
    expect(plan.chosen[0].id).toBe("real-button:sizes");
    expect(plan.gains[0].secondsSaved).toBeGreaterThan(BLOCKED_PENALTY_SECONDS - 100);
    const final = applyFixes(miniShop, plan.chosen);
    expect(plan.plannedObjective).toBe(defaultObjective(toyEvaluate(final, miniShopTasks)));
    expect(plan.plannedObjective).toBeLessThan(plan.baselineObjective);
  });

  it("gains are positive, sum to the total saving and carry cumulative per-persona seconds", () => {
    for (const g of plan.gains) expect(g.secondsSaved).toBeGreaterThan(0.01);
    const total = plan.gains.reduce((s, g) => s + g.secondsSaved, 0);
    expect(total).toBeCloseTo(plan.baselineObjective - plan.plannedObjective, 9);
    const last = plan.gains[plan.gains.length - 1];
    const finalResults = toyEvaluate(applyFixes(miniShop, plan.chosen), miniShopTasks);
    for (const r of finalResults) {
      expect(last.after[r.taskId].keyboard).toBe(r.personas.keyboard.blocked ? BLOCKED_PENALTY_SECONDS : r.personas.keyboard.seconds);
      expect(last.after[r.taskId].screenreader).toBe(r.personas.screenreader.seconds);
    }
    // After the first fix the size picker is reachable, so keyboard stops being blocked.
    expect(plan.gains[0].after["buy-m"].keyboard).toBeLessThan(BLOCKED_PENALTY_SECONDS);
  });

  it("gains do not increase as more fixes are added (diminishing returns on this instance)", () => {
    for (let i = 1; i < plan.gains.length; i++) expect(plan.gains[i].secondsSaved).toBeLessThanOrEqual(plan.gains[i - 1].secondsSaved + 1e-9);
  });

  it("certifies the greedy plan against exhaustive search", () => {
    expect(plan.method).toBe("greedy+exhaustive");
    expect(plan.exhaustiveObjective).toBeDefined();
    expect(plan.optimalityGap).toBeDefined();
    expect(plan.optimalityGap as number).toBeGreaterThanOrEqual(0);
    expect(plan.plannedObjective).toBeGreaterThanOrEqual(plan.exhaustiveObjective as number);
    expect(plan.optimalityGap).toBeCloseTo(plan.plannedObjective - (plan.exhaustiveObjective as number), 9);
  });

  it("counts every evaluate call exactly", () => {
    expect(plan.evaluations).toBe(counter.calls());
    // All 63 non-empty subsets of size <= 3 of the 7 candidates, plus the baseline, are evaluated once each.
    expect(plan.candidates).toHaveLength(7);
    expect(plan.evaluations).toBe(1 + 7 + 21 + 35);
  });

  it("is deterministic", () => {
    expect(planFixes(miniShop, miniShopTasks, toyEvaluate)).toEqual(plan);
  });

  it("evaluates without Monte Carlo samples", () => {
    const seen: Array<number | undefined> = [];
    planFixes(miniShop, miniShopTasks, (p, t, o) => {
      seen.push(o?.samples);
      return toyEvaluate(p, t, o);
    });
    expect(seen.every((s) => s === 0)).toBe(true);
  });

  it("chooses nothing when k = 0", () => {
    const c = counting(toyEvaluate);
    const p = planFixes(miniShop, miniShopTasks, c.evaluate, { k: 0 });
    expect(p.chosen).toEqual([]);
    expect(p.gains).toEqual([]);
    expect(p.k).toBe(0);
    expect(p.plannedObjective).toBe(p.baselineObjective);
    expect(p.method).toBe("greedy+exhaustive");
    expect(p.exhaustiveObjective).toBe(p.baselineObjective);
    expect(p.optimalityGap).toBe(0);
    expect(p.evaluations).toBe(1);
    expect(c.calls()).toBe(1);
  });

  it("skips exhaustive search above exhaustiveMaxK", () => {
    const p = planFixes(miniShop, miniShopTasks, toyEvaluate, { k: 4, exhaustiveMaxK: 3 });
    expect(p.method).toBe("greedy");
    expect(p.exhaustiveObjective).toBeUndefined();
    expect(p.optimalityGap).toBeUndefined();
    expect(p.chosen.length).toBeLessThanOrEqual(4);
    const q = planFixes(miniShop, miniShopTasks, toyEvaluate, { k: 2, exhaustiveMaxK: 1 });
    expect(q.method).toBe("greedy");
  });

  it("honours a custom objective", () => {
    // Only the screen reader counts: the unreachable size picker no longer matters for keyboard.
    const srOnly = (rs: TaskResult[]) => rs.reduce((s, r) => s + r.personas.screenreader.seconds, 0);
    const p = planFixes(miniShop, miniShopTasks, toyEvaluate, { objective: srOnly });
    expect(p.baselineObjective).toBe(srOnly(toyEvaluate(miniShop, miniShopTasks)));
    expect(p.chosen.map((c) => c.id)).not.toContain("real-button:sizes");
    expect(p.chosen.every((c) => c.kind === "promote-heading" || c.kind === "add-landmark" || c.kind === "skip-link")).toBe(true);
  });

  it("stops when no candidate saves more than 0.01 s", () => {
    const flat = planFixes(miniShop, miniShopTasks, fromFeatures(() => 42));
    expect(flat.chosen).toEqual([]);
    expect(flat.plannedObjective).toBe(42);
    const tiny = planFixes(miniShop, miniShopTasks, fromFeatures((p) => 42 - 0.005 * p.headings.length));
    expect(tiny.chosen).toEqual([]);
  });

  it("returns an empty plan for a page with nothing to fix", () => {
    const fixed = applyFixes(miniShop, generateCandidates(miniShop, miniShopTasks));
    const p = planFixes(fixed, miniShopTasks, toyEvaluate);
    expect(p.candidates).toEqual([]);
    expect(p.chosen).toEqual([]);
    expect(p.plannedObjective).toBe(p.baselineObjective);
    expect(p.exhaustiveObjective).toBe(p.baselineObjective);
    expect(p.evaluations).toBe(1);
  });
});

describe("lazy greedy evaluation count", () => {
  // Additive costs: every fix saves a fixed amount regardless of the others, so cached marginals stay exact.
  const additive = fromFeatures((p) => {
    let s = 100;
    if (p.nodes["fix-skip-link"]) s -= 8;
    if (p.landmarks.some((l) => p.nodes[l].landmark === "main")) s -= 6;
    if (p.headings.includes("size-label")) s -= 5;
    if (p.headings.includes("reviews-title")) s -= 4;
    if (p.headings.includes("returns-title")) s -= 3;
    if (p.nodes["size-m"].focusable) s -= 20;
    if (p.nodes["cart-icon"].name) s -= 2;
    return s;
  });

  it("re-evaluates only the current leader each round and finds the optimum", () => {
    const c = counting(additive);
    const p = planFixes(miniShop, miniShopTasks, c.evaluate, { k: 3, exhaustiveMaxK: 2 });
    expect(p.method).toBe("greedy");
    expect(p.chosen.map((x) => x.id)).toEqual(["real-button:sizes", "skip-link:main", "add-landmark:content+footer"]);
    expect(p.plannedObjective).toBe(66);
    // baseline + 7 singles + one refresh for each of picks 2 and 3 (naive greedy would need 1 + 7 + 6 + 5).
    expect(p.evaluations).toBe(1 + 7 + 2);
    expect(c.calls()).toBe(10);

    const ex = planFixes(miniShop, miniShopTasks, additive, { k: 3 });
    expect(ex.optimalityGap).toBe(0);
    expect(ex.exhaustiveObjective).toBe(66);
  });
});

describe("exhaustive pool cap", () => {
  it("looks at the 12 best candidates by single-fix gain", () => {
    const heading = (i: number): Spec => ({
      id: `h${i}`,
      role: "generic",
      name: `Section ${i}`,
      tag: "div",
      hints: { looksLikeHeading: { fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: 2 } },
    });
    const page = buildPage({ id: "root", role: "document", stop: false, children: Array.from({ length: 15 }, (_, i) => heading(i + 1)) });
    // Heading i saves i seconds, so h15, h14, h13 ... are the most valuable.
    const cost = fromFeatures((p) => 1000 - p.headings.reduce((s, id) => s + Number(id.slice(1)), 0));
    const c = counting(cost);
    const p = planFixes(page, [{ id: "t", siteId: "s", label: "x", grounding: "fixture", steps: [{ target: "h1", action: "read" }] }], c.evaluate);
    expect(p.candidates).toHaveLength(15);
    expect(p.chosen.map((x) => x.id)).toEqual(["promote-heading:h15", "promote-heading:h14", "promote-heading:h13"]);
    expect(p.optimalityGap).toBe(0);
    // baseline + 15 singles + 2 refreshes + the remaining subsets of the 12-candidate pool
    // (12 + 66 + 220 non-empty subsets of size <= 3, minus 12 singles and 2 chosen sets already evaluated).
    expect(p.evaluations).toBe(1 + 15 + 2 + (12 + 66 + 220 - 12 - 2));
    expect(c.calls()).toBe(p.evaluations);
  });
});

describe("greedy can be suboptimal, and the gap says so", () => {
  // Two fixes help only together: a skip link is worthless unless it lands on a main landmark.
  // Each heading saves a little on its own, so greedy takes headings and never discovers the pair.
  const synergy = fromFeatures((p) => {
    const hasSkip = !!p.nodes["fix-skip-link"];
    const hasMain = p.landmarks.some((l) => p.nodes[l].landmark === "main");
    return 100 - (hasSkip && hasMain ? 60 : 0) - 5 * (p.headings.length - 1);
  });

  for (const k of [2, 3]) {
    it(`reports a positive gap at k = ${k}`, () => {
      const p = planFixes(miniShop, miniShopTasks, synergy, { k });
      expect(p.chosen.every((c) => c.kind === "promote-heading")).toBe(true);
      expect(p.plannedObjective).toBe(100 - 5 * k);
      expect(p.method).toBe("greedy+exhaustive");
      // The best plan is skip link + landmark (+ one heading when k = 3).
      expect(p.exhaustiveObjective).toBe(100 - 60 - (k === 3 ? 5 : 0));
      expect(p.optimalityGap).toBe(p.plannedObjective - (p.exhaustiveObjective as number));
      expect(p.optimalityGap).toBeGreaterThan(0);
    });
  }

  it("is certified optimal (gap 0) when k = 1 on the same instance", () => {
    const p = planFixes(miniShop, miniShopTasks, synergy, { k: 1 });
    expect(p.optimalityGap).toBe(0);
  });
});

describe("planFixes properties", () => {
  const taskSubsetArb: fc.Arbitrary<Task[]> = fc.subarray(miniShopTasks, { minLength: 1 });

  it("invariants hold for any k, exhaustiveMaxK and task subset", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 4 }), taskSubsetArb, (k, exMax, tasks) => {
        const c = counting(toyEvaluate);
        const p = planFixes(miniShop, tasks, c.evaluate, { k, exhaustiveMaxK: exMax });
        expect(p.evaluations).toBe(c.calls());
        expect(p.chosen.length).toBeLessThanOrEqual(k);
        expect(p.gains).toHaveLength(p.chosen.length);
        expect(p.plannedObjective).toBeLessThanOrEqual(p.baselineObjective + 1e-9);
        expect(new Set(p.chosen.map((x) => x.id)).size).toBe(p.chosen.length);
        for (const g of p.gains) expect(g.secondsSaved).toBeGreaterThan(0.01);
        expect(p.baselineObjective - p.plannedObjective).toBeCloseTo(
          p.gains.reduce((s, g) => s + g.secondsSaved, 0),
          6,
        );
        if (k <= exMax) {
          expect(p.method).toBe("greedy+exhaustive");
          expect(p.optimalityGap).toBeGreaterThanOrEqual(0);
          expect(p.exhaustiveObjective).toBeLessThanOrEqual(p.plannedObjective + 1e-9);
        } else {
          expect(p.method).toBe("greedy");
          expect(p.optimalityGap).toBeUndefined();
        }
        if (k === 0) expect(p.chosen).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("the plan's objective matches an independent evaluation of the chosen fixes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (k) => {
        const p = planFixes(miniShop, miniShopTasks, toyEvaluate, { k, exhaustiveMaxK: 0 });
        expect(p.plannedObjective).toBeCloseTo(defaultObjective(toyEvaluate(applyFixes(miniShop, p.chosen), miniShopTasks)), 9);
      }),
      { numRuns: 20 },
    );
  });
});
