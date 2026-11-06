import { describe, expect, it } from "vitest";
import { wordCount } from "@/lib/a11y/announce";
import type { PersonaId, StrategyId, StrategyResult, TaskResult } from "@/lib/contracts";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { evaluate, nominalParams } from "./index";
import { expectTaskResultShape } from "./testkit";

const results = evaluate(miniShop, miniShopTasks);
const buy = results.find((r) => r.taskId === "buy-m")!;
const returns = results.find((r) => r.taskId === "returns")!;

function strategy(r: TaskResult, persona: PersonaId, id: StrategyId): StrategyResult {
  return r.personas[persona].strategies.find((s) => s.strategy === id)!;
}

describe("evaluate on mini-shop", () => {
  it("returns one TaskResult per task with the exact contract shape", () => {
    expect(results.map((r) => r.taskId)).toEqual(["buy-m", "returns"]);
    for (const r of results) expectTaskResultShape(r);
  });

  describe("buy-m", () => {
    it("blocks the keyboard on size M with a reason that names the size picker", () => {
      const kb = buy.personas.keyboard;
      expect(kb.blocked).toBeDefined();
      expect(kb.blocked!.stepIndex).toBe(0);
      expect(kb.blocked!.reason).toBe("The size picker option “M” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.");
      expect(kb.seconds).toBe(0);
      expect(kb.interval).toEqual([0, 0]);
      expect(kb.strategies[0].blocked).toEqual(kb.blocked);
    });

    it("does not block the mouse or the screen reader (fake buttons are clickable in browse mode)", () => {
      expect(buy.personas.mouse.blocked).toBeUndefined();
      expect(buy.personas.screenreader.blocked).toBeUndefined();
      expect(buy.personas.screenreader.seconds).toBeGreaterThan(0);
    });

    it("the linear screen-reader strategy passes all 24 navigation links", () => {
      const linear = strategy(buy, "screenreader", "linear");
      const events = linear.steps.flatMap((s) => s.events);
      const navHeard = events.filter((e) => e.nodeId && /^(nav|sub)-\d+$/.test(e.nodeId));
      expect(navHeard).toHaveLength(24);
      expect(navHeard.every((e) => e.utterance?.truncated === true)).toBe(true);
      expect(new Set(navHeard.map((e) => e.nodeId)).size).toBe(24);
    });

    it("linear seconds match an independent hand calculation", () => {
      const p = nominalParams();
      const ro = miniShop.readingOrder;
      const speech = (j: number, full: boolean) => (wordCount(miniShop.nodes[ro[j]].announcement) * 60) / p.speechWpm * (full ? 1 : p.listenFraction);
      const walk = (from: number, to: number) => {
        let s = 0;
        for (let j = from + 1; j <= to; j++) s += p.K + speech(j, j === to);
        return s;
      };
      const tM = ro.indexOf("size-m");
      const tCart = ro.indexOf("add-to-cart");
      const expected = (wordCount(miniShop.title) * 60) / p.speechWpm + p.M + walk(-1, tM) + p.K + p.M + walk(tM, tCart) + p.K;
      expect(strategy(buy, "screenreader", "linear").seconds).toBeCloseTo(expected, 9);
    });

    it("headings navigation beats linear here: a heading sits between the nav and the target", () => {
      expect(strategy(buy, "screenreader", "headings").seconds).toBeLessThan(strategy(buy, "screenreader", "linear").seconds);
    });

    it("mouse seconds match an independent Fitts calculation", () => {
      const p = nominalParams();
      const fitts = (d: number, w: number) => p.fittsA + p.fittsB * Math.log2(d / w + 1);
      // pointer starts at the viewport centre (640, 400); size M centre (896, 544); Add to cart centre (910, 626)
      const expected = 2 * p.M + fitts(Math.hypot(896 - 640, 544 - 400), 48) + fitts(Math.hypot(910 - 896, 626 - 544), 52) + 4 * p.B;
      expect(buy.personas.mouse.seconds).toBeCloseTo(expected, 9);
    });

    it("the mouse user is faster than the screen-reader user", () => {
      expect(buy.personas.mouse.seconds).toBeLessThan(buy.personas.screenreader.seconds);
    });
  });

  describe("returns", () => {
    it("nobody is blocked and the mouse is fastest or tied with the keyboard", () => {
      for (const persona of ["mouse", "keyboard", "screenreader"] as const) expect(returns.personas[persona].blocked).toBeUndefined();
      expect(returns.personas.mouse.seconds).toBeLessThan(returns.personas.screenreader.seconds);
      expect(returns.personas.keyboard.seconds).toBeLessThan(returns.personas.screenreader.seconds);
    });

    it("the tab-only screen-reader strategy is blocked (a paragraph is not focusable) and drops out of the mixture", () => {
      const tab = strategy(returns, "screenreader", "tab");
      expect(tab.blocked?.reason).toBe("Pressing Tab never lands on “Return unworn items within 60 days for a full refund.”: it is not a keyboard focus stop.");
      const w = returns.personas.screenreader.weights;
      expect(w.tab).toBe(0);
      const sum = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBeCloseTo(1, 9);
      expect(returns.personas.screenreader.representative).toBe("headings");
    });

    it("the keyboard user scrolls two screens and reads", () => {
      const p = nominalParams();
      const kb = returns.personas.keyboard;
      const events = kb.strategies[0].steps[0].events;
      expect(events.filter((e) => e.command === "scroll")).toHaveLength(2);
      const words = wordCount("Return unworn items within 60 days for a full refund.");
      expect(kb.seconds).toBeCloseTo(p.M + 2 * (p.K * p.keyboardMotorFactor + p.secondsPerViewport) + (words * 60) / p.readingWpm, 9);
    });
  });

  describe("intervals and determinism", () => {
    it("every interval is ordered and contains its point estimate", () => {
      for (const r of results) {
        for (const p of Object.values(r.personas)) {
          expect(p.interval[0]).toBeLessThanOrEqual(p.interval[1]);
          expect(p.interval[0]).toBeLessThanOrEqual(p.seconds + 1e-12);
          expect(p.interval[1]).toBeGreaterThanOrEqual(p.seconds - 1e-12);
        }
      }
    });

    it("unblocked personas get a real (non-degenerate) interval", () => {
      expect(buy.personas.mouse.interval[1]).toBeGreaterThan(buy.personas.mouse.interval[0]);
      expect(buy.personas.screenreader.interval[1]).toBeGreaterThan(buy.personas.screenreader.interval[0]);
    });

    it("samples: 0 collapses the interval onto the point estimate", () => {
      for (const r of evaluate(miniShop, miniShopTasks, { samples: 0 })) {
        for (const p of Object.values(r.personas)) expect(p.interval).toEqual([p.seconds, p.seconds]);
      }
    });

    it("point estimates do not depend on the number of samples or the seed", () => {
      const a = evaluate(miniShop, miniShopTasks, { samples: 0 });
      const b = evaluate(miniShop, miniShopTasks, { samples: 50, seed: 99 });
      expect(a.map((r) => r.personas.screenreader.seconds)).toEqual(b.map((r) => r.personas.screenreader.seconds));
    });

    it("the same seed gives byte-identical output; another seed moves the interval only", () => {
      const a = evaluate(miniShop, miniShopTasks, { seed: 7 });
      const b = evaluate(miniShop, miniShopTasks, { seed: 7 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = evaluate(miniShop, miniShopTasks, { seed: 8 });
      expect(c[0].personas.mouse.interval).not.toEqual(a[0].personas.mouse.interval);
      expect(c[0].personas.mouse.seconds).toBe(a[0].personas.mouse.seconds);
    });

    it("a task's result does not depend on which other tasks are evaluated with it", () => {
      const alone = evaluate(miniShop, [miniShopTasks[1]])[0];
      expect(JSON.stringify(alone)).toBe(JSON.stringify(returns));
    });

    it("the default seed is 1 and the default sample count is 400", () => {
      expect(JSON.stringify(evaluate(miniShop, miniShopTasks, { seed: 1, samples: 400 }))).toBe(JSON.stringify(results));
    });

    it("the personas option skips the others (stubs keep the contract shape)", () => {
      const only = evaluate(miniShop, miniShopTasks, { samples: 0, personas: ["keyboard", "screenreader"] });
      expect(only[0].personas.mouse.strategies).toEqual([]);
      expect(only[0].personas.mouse.seconds).toBe(0);
      expect(only[0].personas.screenreader.seconds).toBe(buy.personas.screenreader.seconds);
    });
  });
});
