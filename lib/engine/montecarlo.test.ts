import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import type { PersonaId } from "@/lib/contracts";
import { LITERATURE } from "@/lib/params/literature";
import { deriveSeed, evaluate, getIndex, mulberry32, nominalParams, planPersona, quantile, sampleSeconds, sampleSecondsReoptimised, zeroCost, type Planned } from "./index";
import { longPage } from "./testkit";

const mean = (xs: ArrayLike<number>) => Array.from(xs).reduce((a, b) => a + b, 0) / xs.length;

describe("quantile", () => {
  it("interpolates linearly (type 7)", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(quantile(xs, 0)).toBe(10);
    expect(quantile(xs, 0.5)).toBe(30);
    expect(quantile(xs, 1)).toBe(50);
    expect(quantile(xs, 0.125)).toBeCloseTo(15, 12);
    expect(quantile([], 0.5)).toBe(0);
  });

  it("is monotone in q and bounded by the extremes", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 50 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (xs, a, b) => {
        const sorted = [...xs].sort((x, y) => x - y);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(quantile(sorted, lo)).toBeLessThanOrEqual(quantile(sorted, hi) + 1e-12);
        expect(quantile(sorted, lo)).toBeGreaterThanOrEqual(sorted[0]);
        expect(quantile(sorted, hi)).toBeLessThanOrEqual(sorted[sorted.length - 1]);
      }),
    );
  });
});

describe("Monte Carlo", () => {
  const p = nominalParams();
  const idx = getIndex(miniShop);

  it("interval is [p05, p95] of the draws (widened to contain the point estimate)", () => {
    const r = evaluate(miniShop, [miniShopTasks[1]], { seed: 5 })[0].personas.screenreader;
    const plans = planPersona(miniShop, idx, miniShopTasks[1], "screenreader", p);
    const draws = sampleSeconds("screenreader", plans, 400, mulberry32(deriveSeed(5, "returns", "screenreader")));
    expect(draws).toHaveLength(400);
    expect(r.interval[0]).toBeCloseTo(Math.min(quantile(draws, 0.05), r.seconds), 12);
    expect(r.interval[1]).toBeCloseTo(Math.max(quantile(draws, 0.95), r.seconds), 12);
  });

  it("is reproducible per seed and sorted ascending", () => {
    const plans = planPersona(miniShop, idx, miniShopTasks[0], "screenreader", p);
    const a = sampleSeconds("screenreader", plans, 200, mulberry32(3));
    const b = sampleSeconds("screenreader", plans, 200, mulberry32(3));
    expect(Array.from(a)).toEqual(Array.from(b));
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
  });

  it("returns no draws when every strategy is blocked or no samples are requested", () => {
    const blocked = planPersona(miniShop, idx, miniShopTasks[0], "keyboard", p);
    expect(sampleSeconds("keyboard", blocked, 100, mulberry32(1))).toHaveLength(0);
    const ok = planPersona(miniShop, idx, miniShopTasks[0], "mouse", p);
    expect(sampleSeconds("mouse", ok, 0, mulberry32(1))).toHaveLength(0);
  });

  it("draws the strategy according to the (renormalised) weights", () => {
    // Two fake strategies with very different, parameter-free costs; their prior weights are renormalised over just these two.
    const { headings, linear } = LITERATURE.screenReaderStrategies;
    const expectedShare = linear / (headings + linear);
    const result = (strategy: "headings" | "linear") => ({ strategy, seconds: 0, steps: [] });
    const cheap: Planned = { result: result("headings"), total: { ...zeroCost(), M: 1 } };
    const dear: Planned = { result: result("linear"), total: { ...zeroCost(), M: 1000 } };
    const draws = sampleSeconds("screenreader", [cheap, dear], 4000, mulberry32(21));
    const share = Array.from(draws).filter((x) => x > 300).length / draws.length;
    expect(share).toBeGreaterThan(expectedShare - 0.025);
    expect(share).toBeLessThan(expectedShare + 0.025);
  });

  it("a blocked strategy is never drawn", () => {
    const cheap: Planned = { result: { strategy: "headings", seconds: 0, steps: [] }, total: { ...zeroCost(), M: 1 } };
    const blocked: Planned = { result: { strategy: "linear", seconds: 0, steps: [], blocked: { stepIndex: 0, reason: "x" } }, total: { ...zeroCost(), M: 1000 } };
    const draws = sampleSeconds("screenreader", [cheap, blocked], 500, mulberry32(2));
    expect(Math.max(...draws)).toBeLessThan(10);
  });

  it("every interval contains its point estimate, on random pages, tasks and seeds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 8 }), fc.nat(), fc.integer({ min: 1, max: 1e6 }), (navLinks, sections, pick, seed) => {
        const lp = longPage({ navLinks, sections, footerLinks: 3, headings: pick % 2 === 0 });
        const targets = [lp.buy(pick % sections), lp.para(pick % sections), `nav-${pick % navLinks}`, "foot-1"];
        const tasks = targets.map((target, i) => lp.task([{ target, action: i === 1 ? "read" : "activate" }], `t${i}`));
        for (const r of evaluate(lp.page, tasks, { samples: 120, seed })) {
          for (const persona of Object.values(r.personas)) {
            expect(persona.interval[0]).toBeLessThanOrEqual(persona.interval[1]);
            expect(persona.interval[0]).toBeLessThanOrEqual(persona.seconds + 1e-9);
            expect(persona.seconds).toBeLessThanOrEqual(persona.interval[1] + 1e-9);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  describe("re-costing nominal-optimal paths vs re-optimising per sample", () => {
    for (const task of miniShopTasks) {
      for (const persona of ["mouse", "keyboard", "screenreader"] as PersonaId[]) {
        it(`${task.id} / ${persona}: p50 within 10%, and re-optimising never costs more`, () => {
          const plans = planPersona(miniShop, idx, task, persona, p);
          if (plans.every((pl) => pl.result.blocked)) return; // keyboard on buy-m: nothing to sample
          const fixed = sampleSeconds(persona, plans, 400, mulberry32(11));
          const reopt = sampleSecondsReoptimised(miniShop, idx, task, persona, plans, 400, mulberry32(11));
          const rel = Math.abs(quantile(reopt, 0.5) - quantile(fixed, 0.5)) / quantile(fixed, 0.5);
          expect(rel).toBeLessThan(0.1);
          // Same draws: each re-optimised sample is the minimum over paths, so it can only be cheaper on average.
          expect(mean(reopt)).toBeLessThanOrEqual(mean(fixed) + 1e-9);
        });
      }
    }
  });
});
