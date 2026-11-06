import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { LITERATURE } from "@/lib/params/literature";
import { civicPage, civicTask, promoteHeadings, sectionedPage } from "./demo-pages";
import {
  enterProbability,
  giveUpStops,
  headingLabels,
  lexicalScorer,
  prepareStep,
  resolveScentOptions,
  searchHeadings,
  searchHeadingsAsync,
  searchTask,
  simulateSearch,
  stepGoalText,
} from "./index";
import { deterministicSeconds, referenceExpectedSeconds, scenarioArb, type Scenario } from "./testkit";

const modeOf = (s: Scenario) => prepareStep(s.page, s.task, s.stepIndex, s.opts).mode;
const sectionOfTarget = (s: Scenario) => prepareStep(s.page, s.task, s.stepIndex, s.opts).targetSection;
const run = (s: Scenario, scores = s.scores, extra = {}) => searchHeadings(s.page, s.task, s.stepIndex, scores, { ...s.opts, ...extra });

const searchScenario = scenarioArb.filter((s) => modeOf(s) === "search");

describe("model primitives", () => {
  it("enter probability is a logistic in (scent - theta)", () => {
    expect(enterProbability(0.35, 10, 0.35)).toBeCloseTo(0.5, 12);
    expect(enterProbability(1, 10, 0.35)).toBeCloseTo(1 / (1 + Math.exp(-6.5)), 12);
    expect(enterProbability(0, 10, 0.35)).toBeCloseTo(1 / (1 + Math.exp(3.5)), 12);
    expect(enterProbability(0, 1e6, 0.35)).toBe(0); // no overflow
    expect(enterProbability(1, 1e6, 0.35)).toBe(1);
  });

  it("giveUpStops = min(len, ceil(beta * len) + 1), robust to float error", () => {
    expect(giveUpStops(0, 0.4)).toBe(0);
    expect(giveUpStops(1, 0.4)).toBe(1);
    expect(giveUpStops(5, 0.4)).toBe(3); // 0.4 * 5 = 2.0000000000000004 in floating point
    expect(giveUpStops(10, 0.4)).toBe(5);
    expect(giveUpStops(10, 1)).toBe(10);
    expect(giveUpStops(10, 0)).toBe(1);
  });

  it("nominal options come from LITERATURE", () => {
    const r = resolveScentOptions();
    expect(r.K).toBe(LITERATURE.klm.K.value);
    expect(r.M).toBe(LITERATURE.klm.M.value);
    expect(r.wpm).toBe(LITERATURE.speech.wpm.value);
    expect(r.listenFraction).toBe(LITERATURE.speech.listenFraction.value);
    expect([r.alpha, r.theta, r.beta, r.pMin2]).toEqual([10, 0.35, 0.4, 0.5]);
    expect(() => resolveScentOptions({ wpm: 0 })).toThrow(RangeError);
    expect(() => resolveScentOptions({ beta: 2 })).toThrow(RangeError);
  });
});

describe("closed form on a one-heading page", () => {
  // Preamble: 2 stops; heading; section of 3 stops, the 3rd is the target.
  const page = sectionedPage({ preamble: [4, 4], sections: [{ heading: "Alpha beta", stops: [6, 6, 6] }] });
  const task = { id: "t", siteId: "s", label: "x", grounding: "fixture" as const, steps: [{ target: "s-0-2", action: "read" as const }] };
  const o = { K: 0.3, wpm: 240, listenFraction: 0.5, M: 1.5, alpha: 10, theta: 0.35, beta: 0.4, pMin2: 0.5 };
  const sp = (id: string) => (page.nodes[id].announcement.split(/[\s,]+/).filter(Boolean).length / 240) * 60;

  it("equals a + p A + (1-p) [a + p2 A + (1-p2) (K + L)]", () => {
    const scent = 0.2;
    const p = enterProbability(scent, 10, 0.35);
    const p2 = Math.max(p, 0.5);
    const a = 0.3 + 0.5 * sp("h-0");
    const A = 0.3 + 0.5 * sp("s-0-0") + 0.3 + 0.5 * sp("s-0-1") + 0.3 + sp("s-0-2");
    const L = ["pre-0", "pre-1", "h-0", "s-0-0", "s-0-1"].reduce((acc, id) => acc + 0.3 + 0.5 * sp(id), 0) + 0.3 + sp("s-0-2");
    const expected = a + p * A + (1 - p) * (a + p2 * A + (1 - p2) * (0.3 + L));
    const r = searchHeadings(page, task, 0, [scent], o);
    expect(r.seconds).toBeCloseTo(expected, 10);
    expect(r.pFoundFirstPass).toBeCloseTo(p, 12);
    expect(r.pFoundHeadings).toBeCloseTo(p + (1 - p) * p2, 12);
    expect(r.expectedHeadingsHeard).toBeCloseTo(1 + (1 - p), 12);
    expect(r.expectedWrongSections).toBe(0);
    expect(r.perHeading[0].expectedVisits).toBeCloseTo(2 - p, 12);
  });
});

describe("agreement of three independent computations", () => {
  it("matrix solution equals a backward-recursion reference to 1e-9 on random pages", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const r = run(s);
        const ref = referenceExpectedSeconds(s);
        expect(Math.abs(r.seconds - ref)).toBeLessThanOrEqual(1e-9 * Math.max(1, ref));
      }),
      { numRuns: 300, seed: 20261018 },
    );
  });

  it("seeded Monte Carlo (20,000 users) agrees with the analytic expectation within 2% on random pages", () => {
    let worst = 0;
    let i = 0;
    fc.assert(
      fc.property(searchScenario, (s) => {
        const r = run(s);
        const mc = simulateSearch(s.page, s.task, s.stepIndex, s.scores, s.opts, { users: 20000, seed: 4242 + i++ });
        const err = Math.abs(mc.meanSeconds - r.seconds) / r.seconds;
        worst = Math.max(worst, err);
        expect(err).toBeLessThan(0.02);
        // Event probabilities and counts agree too.
        expect(Math.abs(mc.pFoundFirstPass - r.pFoundFirstPass)).toBeLessThan(0.02);
        expect(Math.abs(mc.pFoundHeadings - r.pFoundHeadings)).toBeLessThan(0.02);
        expect(Math.abs(mc.meanHeadingsHeard - r.expectedHeadingsHeard)).toBeLessThan(0.03 * Math.max(1, r.expectedHeadingsHeard));
        expect(Math.abs(mc.meanWrongSections - r.expectedWrongSections)).toBeLessThan(0.03 * Math.max(1, r.expectedWrongSections));
      }),
      { numRuns: 100, seed: 20261018 },
    );
    if (process.env.SCENT_VERBOSE) console.log(`worst Monte Carlo vs analytic error over ${i} random pages: ${(worst * 100).toFixed(3)}%`);
    expect(worst).toBeLessThan(0.02);
  });

  it("Monte Carlo agrees on mini-shop (as built, and with its fake headings promoted)", () => {
    const promoted = promoteHeadings(miniShop, ["size-label", "reviews-title", "returns-title"]);
    for (const page of [miniShop, promoted]) {
      for (const task of miniShopTasks) {
        for (let step = 0; step < task.steps.length; step++) {
          const scores = lexicalScorer(stepGoalText(task, step), headingLabels(page));
          const r = searchHeadings(page, task, step, scores);
          const mc = simulateSearch(page, task, step, scores, {}, { users: 20000, seed: 11 + step });
          const err = Math.abs(mc.meanSeconds - r.seconds) / r.seconds;
          expect(err, `${page.headings.length} headings, ${task.id}[${step}] (${r.mode})`).toBeLessThan(0.02);
        }
      }
    }
  });

  it("a 300-heading page (600 states) uses the fast first-row path and still matches the reference", () => {
    const sections = Array.from({ length: 300 }, (_, k) => ({ heading: `Heading ${k}`, stops: [5, 7, 5, 7, 5, 7] }));
    const page = sectionedPage({ preamble: [3, 3], sections });
    const task = { id: "t", siteId: "s", label: "x", grounding: "fixture" as const, steps: [{ target: "s-250-3", action: "read" as const }] };
    const scores = sections.map((_, k) => ((k * 37) % 100) / 100);
    const s: Scenario = { page, task, stepIndex: 0, scores, opts: {}, headings: 300 };
    const t0 = performance.now();
    const r = run(s);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(Math.abs(r.seconds - referenceExpectedSeconds(s))).toBeLessThanOrEqual(1e-9 * r.seconds);
  });

  it("Monte Carlo agrees on the civic page, clear and vague", () => {
    for (const heading of ["Income limits", "More information"]) {
      const page = civicPage(heading);
      const scores = lexicalScorer(stepGoalText(civicTask, 0), headingLabels(page));
      const r = searchHeadings(page, civicTask, 0, scores);
      const mc = simulateSearch(page, civicTask, 0, scores, {}, { users: 20000, seed: 5 });
      expect(Math.abs(mc.meanSeconds - r.seconds) / r.seconds).toBeLessThan(0.02);
    }
  });
});

describe("reduces to the shortest path when the user knows where to go", () => {
  it("scent 1 on the target's section, 0 elsewhere, alpha large: expected time = H-then-arrows cost within 1%", () => {
    fc.assert(
      fc.property(
        searchScenario.filter((s) => sectionOfTarget(s) >= 0),
        (s) => {
          const ks = sectionOfTarget(s);
          const scores = s.scores.map((_, k) => (k === ks ? 1 : 0));
          const extra = { alpha: 200, theta: 0.35 };
          const r = run(s, scores, extra);
          const det = deterministicSeconds(s, resolveScentOptions({ ...s.opts, ...extra }));
          expect(Math.abs(r.seconds - det) / det).toBeLessThan(0.01);
          expect(r.shortestSeconds).toBeCloseTo(det, 9);
          expect(r.pFoundFirstPass).toBeGreaterThan(0.999);
          expect(r.expectedWrongSections).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 200, seed: 20261018 },
    );
  });
});

describe("monotonicity", () => {
  it("lowering the target section's scent never decreases the expected time", () => {
    fc.assert(
      fc.property(
        searchScenario.filter((s) => sectionOfTarget(s) >= 0),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, factor) => {
          const ks = sectionOfTarget(s);
          const lowered = s.scores.map((x, k) => (k === ks ? x * factor : x));
          expect(run(s, lowered).seconds).toBeGreaterThanOrEqual(run(s).seconds - 1e-9);
        },
      ),
      { numRuns: 300, seed: 20261018 },
    );
  });

  it("raising a wrong section's scent never decreases the expected time", () => {
    fc.assert(
      fc.property(
        searchScenario.filter((s) => s.headings >= 2),
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, pick, g) => {
          const ks = sectionOfTarget(s);
          const wrong = [...s.scores.keys()].filter((k) => k !== ks);
          const w = wrong[pick % wrong.length];
          const raised = s.scores.map((x, k) => (k === w ? x + (1 - x) * g : x));
          expect(run(s, raised).seconds).toBeGreaterThanOrEqual(run(s).seconds - 1e-9);
        },
      ),
      { numRuns: 300, seed: 20261018 },
    );
  });

  it("the shortest path is a lower bound on the foraging time", () => {
    fc.assert(
      fc.property(searchScenario, (s) => {
        const r = run(s);
        expect(r.seconds).toBeGreaterThanOrEqual(r.shortestSeconds - 1e-9);
        expect(r.foragingOverheadSeconds).toBeGreaterThanOrEqual(-1e-9);
      }),
      { numRuns: 300, seed: 20261018 },
    );
  });
});

describe("structural invariants", () => {
  it("probabilities, visit counts and time components are consistent", () => {
    fc.assert(
      fc.property(searchScenario, (s) => {
        const r = run(s);
        expect(r.pFoundFirstPass).toBeGreaterThanOrEqual(-1e-12);
        expect(r.pFoundFirstPass).toBeLessThanOrEqual(r.pFoundHeadings + 1e-12);
        expect(r.pFoundHeadings + r.pFallbackLinear).toBeCloseTo(1, 10);
        expect(r.pFallbackLinear).toBeGreaterThanOrEqual(-1e-12);
        const c = r.components;
        expect(c.headings + c.wrongSections + c.arrowsToTarget + c.linearFallback + c.local).toBeCloseTo(r.seconds, 8);
        expect(r.perHeading.reduce((a, h) => a + h.expectedVisits, 0)).toBeCloseTo(r.expectedHeadingsHeard, 10);
        for (const h of r.perHeading) {
          expect(h.expectedVisits).toBeGreaterThanOrEqual(0);
          expect(h.expectedVisits).toBeLessThanOrEqual(2 + 1e-12); // two passes at most
          expect(h.pEnter).toBeGreaterThanOrEqual(0);
          expect(h.pEnter).toBeLessThanOrEqual(1);
        }
        // Only the target's section can end the search early; first-pass visits of heading k happen once.
        expect(r.perHeading.filter((h) => h.containsTarget).length).toBeLessThanOrEqual(1);
        expect(r.expectedHeadingsHeard).toBeGreaterThanOrEqual(1 - 1e-12);
      }),
      { numRuns: 200, seed: 20261018 },
    );
  });

  it("is deterministic: same inputs, identical output", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        expect(run(s)).toEqual(run(s));
      }),
      { numRuns: 50, seed: 20261018 },
    );
    const page = civicPage();
    const a = searchHeadings(page, civicTask, 0, lexicalScorer);
    const b = searchHeadings(page, civicTask, 0, lexicalScorer);
    expect(a).toEqual(b);
  });
});

describe("edge cases", () => {
  const mk = (page: ReturnType<typeof sectionedPage>, targets: string[]) => ({
    id: "t",
    siteId: "s",
    label: "x",
    grounding: "fixture" as const,
    steps: targets.map((target) => ({ target, action: "read" as const })),
  });
  const o = { K: 0.3, wpm: 240, listenFraction: 0.5, M: 1.5 };

  it("a page without headings is plain linear reading from the top", () => {
    const page = sectionedPage({ preamble: [3, 3, 3, 3], sections: [] });
    const r = searchHeadings(page, mk(page, ["pre-3"]), 0, [], o);
    expect(r.mode).toBe("linear");
    expect(r.seconds).toBeCloseTo(r.linearSeconds, 12);
    expect(r.pFallbackLinear).toBe(1);
  });

  it("a target before the first heading can only be found by the linear fallback", () => {
    const page = sectionedPage({ preamble: [3, 3, 3], sections: [{ heading: "A", stops: [3, 3] }, { heading: "B", stops: [3] }] });
    const r = searchHeadings(page, mk(page, ["pre-1"]), 0, [1, 1], o);
    expect(r.mode).toBe("search");
    expect(r.targetHeading).toBeNull();
    expect(r.pFoundHeadings).toBe(0);
    expect(r.pFallbackLinear).toBe(1);
    expect(r.seconds).toBeGreaterThan(r.linearSeconds);
    expect(r.seconds).toBeCloseTo(referenceExpectedSeconds({ page, task: mk(page, ["pre-1"]), stepIndex: 0, scores: [1, 1], opts: o, headings: 2 }), 9);
  });

  it("when the target is a heading, entering only finishes listening to it", () => {
    const page = sectionedPage({ sections: [{ heading: "Intro", stops: [3] }, { heading: "Returns and refunds policy", stops: [3] }] });
    const r = searchHeadings(page, mk(page, ["h-1"]), 0, [0, 1], { ...o, alpha: 200 });
    const sp = (id: string) => (page.nodes[id].announcement.split(/[\s,]+/).filter(Boolean).length / 240) * 60;
    // H, H, then hear the rest of the target heading.
    expect(r.seconds).toBeCloseTo(0.3 + 0.5 * sp("h-0") + 0.3 + sp("h-1"), 6);
    expect(r.shortestSeconds).toBeCloseTo(r.seconds, 6);
  });

  it("steps after the first start at the previous target; a target in the same section is a local arrow walk", () => {
    const page = sectionedPage({ sections: [{ heading: "A", stops: [3, 3, 3] }, { heading: "B", stops: [3, 3] }] });
    const sp = (id: string) => (page.nodes[id].announcement.split(/[\s,]+/).filter(Boolean).length / 240) * 60;
    const fwd = searchHeadings(page, mk(page, ["s-0-0", "s-0-2"]), 1, [0, 0], o);
    expect(fwd.mode).toBe("local");
    expect(fwd.seconds).toBeCloseTo(0.3 + 0.5 * sp("s-0-1") + 0.3 + sp("s-0-2"), 9);
    const back = searchHeadings(page, mk(page, ["s-0-2", "s-0-0"]), 1, [0, 0], o);
    expect(back.mode).toBe("local");
    expect(back.seconds).toBeCloseTo(0.3 + 0.5 * sp("s-0-1") + 0.3 + sp("s-0-0"), 9);
    const same = searchHeadings(page, mk(page, ["s-0-1", "s-0-1"]), 1, [0, 0], o);
    expect(same.seconds).toBe(0);
    // A target in another section is a real search that starts after the previous target.
    const away = searchHeadings(page, mk(page, ["s-0-0", "s-1-1"]), 1, [0, 1], { ...o, alpha: 200 });
    expect(away.mode).toBe("search");
    // H from inside section A lands on B first, which is the target's section.
    expect(away.perHeading[1].expectedVisits).toBeGreaterThan(0.999);
    expect(away.perHeading[0].expectedVisits).toBeLessThan(0.001);
  });

  it("wraps past the end: a target above the cursor's section is found after wrapping to the top", () => {
    const page = sectionedPage({ sections: [{ heading: "A", stops: [3, 3] }, { heading: "B", stops: [3, 3] }, { heading: "C", stops: [3] }] });
    const task = mk(page, ["s-2-0", "s-0-1"]);
    const s: Scenario = { page, task, stepIndex: 1, scores: [1, 0, 0], opts: { ...o, alpha: 200 }, headings: 3 };
    const r = run(s);
    expect(r.mode).toBe("search");
    // No heading follows the cursor, so H wraps to heading A and the target is found immediately.
    expect(r.seconds).toBeCloseTo(deterministicSeconds(s, resolveScentOptions(s.opts)), 6);
    expect(r.perHeading.map((h) => h.expectedVisits >= 0.999)).toEqual([true, false, false]);
  });

  it("validates arguments", () => {
    const page = sectionedPage({ sections: [{ heading: "A", stops: [3] }, { heading: "B", stops: [3] }] });
    const task = mk(page, ["s-1-0"]);
    expect(() => searchHeadings(page, task, 3, [0, 0])).toThrow(RangeError);
    expect(() => searchHeadings(page, task, 0, [0])).toThrow(/expected 2 scent scores/);
    expect(() => searchHeadings(page, { ...task, steps: [{ target: "nope", action: "read" }] }, 0, [0, 0])).toThrow(/not a reading stop/);
    // Out-of-range scores are clipped, not trusted.
    expect(searchHeadings(page, task, 0, [-5, 7], o).perHeading.map((h) => h.scent)).toEqual([0, 1]);
  });

  it("sync API rejects a Promise-returning scorer; async API accepts it and agrees", async () => {
    const page = civicPage();
    const asyncScorer = async (t: string, l: string[]) => lexicalScorer(t, l);
    expect(() => searchHeadings(page, civicTask, 0, asyncScorer as never)).toThrow(/Promise/);
    const viaAsync = await searchHeadingsAsync(page, civicTask, 0, asyncScorer);
    const viaSync = searchHeadings(page, civicTask, 0, lexicalScorer);
    expect(viaAsync).toEqual(viaSync);
    expect(await searchHeadingsAsync(page, civicTask, 0, viaSync.perHeading.map((h) => h.scent))).toEqual(viaSync);
  });

  it("searchTask sums the steps (mini-shop: the second step is local)", () => {
    const t = searchTask(miniShop, miniShopTasks[0], lexicalScorer);
    expect(t.steps.map((s) => s.mode)).toEqual(["search", "local"]);
    expect(t.seconds).toBeCloseTo(t.steps[0].seconds + t.steps[1].seconds, 12);
  });
});
