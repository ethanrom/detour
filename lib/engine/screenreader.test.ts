import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { wordCount } from "@/lib/a11y/announce";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import type { PageModel, StrategyId, StrategyResult, Task, TaskStep, TraceEvent } from "@/lib/contracts";
import { evaluate, evaluateWithParams, findQuery, nominalParams, speechSeconds, type Params } from "./index";
import { longPage, totalSpeechSeconds } from "./testkit";

function task(steps: TaskStep[], id = "t"): Task {
  return { id, siteId: "s", label: "task", steps, grounding: "fixture" };
}

function sr(page: PageModel, steps: TaskStep[], p?: Params) {
  const t = task(steps);
  return (p ? evaluateWithParams(page, [t], p) : evaluate(page, [t], { samples: 0 }))[0].personas.screenreader;
}

function strat(page: PageModel, id: StrategyId, steps: TaskStep[], p?: Params): StrategyResult {
  return sr(page, steps, p).strategies.find((s) => s.strategy === id)!;
}

const flat = (s: StrategyResult): TraceEvent[] => s.steps.flatMap((st) => st.events);

/** N paragraphs of five words each (so every announcement has the same length); optional heading in place of one of them. */
function paragraphs(n: number, headingAt?: number): PageModel {
  const kids: Spec[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(
      i === headingAt
        ? { id: `p${i}`, role: "heading", level: 2, name: "alpha beta", tag: "h2", rect: { x: 0, y: i * 30, w: 200, h: 20 } }
        : { id: `p${i}`, role: "paragraph", name: "one two three four five", tag: "p", rect: { x: 0, y: i * 30, w: 200, h: 20 } },
    );
  }
  return buildPage({ id: "root", role: "document", stop: false, children: kids }, { title: "Words" });
}

describe("screen-reader model", () => {
  const p = nominalParams();

  it("charges the page title once at the start, then one M per step", () => {
    const s = strat(miniShop, "linear", miniShopTasks[0].steps);
    const ev = flat(s);
    const titles = ev.filter((e) => e.label.startsWith("Hear page title"));
    expect(titles).toHaveLength(1);
    expect(ev[0]).toMatchObject({ command: "think", nodeId: null, label: "Hear page title: “Trail Jacket | Northwind Outfitters”" });
    expect(ev[0].dt).toBeCloseTo((wordCount(miniShop.title) * 60) / p.speechWpm, 12);
    expect(ev.filter((e) => e.label === "Think")).toHaveLength(2);
    // The title is not a user command.
    expect(s.steps[0].commands).toEqual([
      { command: "think", count: 2 }, // Think + the verification think
      { command: "next", count: expect.any(Number) },
      { command: "activate", count: 1 },
      { command: "prev", count: 1 },
    ]);
  });

  it("starts before the first stop and labels each move with the key and what is heard", () => {
    const ev = flat(strat(miniShop, "linear", miniShopTasks[0].steps));
    expect(ev.slice(0, 6).map((e) => e.label)).toEqual([
      "Hear page title: “Trail Jacket | Northwind Outfitters”",
      "Think",
      "Down → link, Northwind Outfitters home",
      "Down → edit, Search, blank",
      "Down → button",
      "Down → navigation landmark, list with 24 items, link, Men",
    ]);
    expect(ev[2].utterance).toMatchObject({ nodeId: "logo", text: "link, Northwind Outfitters home", truncated: true });
    const arrival = ev.find((e) => e.nodeId === "size-m" && e.command === "next")!;
    expect(arrival.utterance!.truncated).toBe(false);
    expect(arrival.label).toBe("Down → clickable, M");
    expect(ev.find((e) => e.label === "Enter → activate “M”")).toBeDefined();
  });

  it("speaks non-target stops at listenFraction and the target in full", () => {
    const page = paragraphs(6);
    const ev = flat(strat(page, "linear", [{ target: "p3", action: "read" }]));
    const perWord = 60 / p.speechWpm;
    const stops = ev.filter((e) => e.utterance && e.nodeId);
    expect(stops).toHaveLength(4);
    expect(stops[0].dt).toBeCloseTo(p.K + 5 * perWord * p.listenFraction, 12);
    expect(stops[0].utterance!.seconds).toBeCloseTo(5 * perWord * p.listenFraction, 12);
    expect(stops[3].dt).toBeCloseTo(p.K + 5 * perWord, 12);
    expect(stops[3].utterance!.truncated).toBe(false);
    expect(stops[3].utterance!.seconds).toBeCloseTo(5 * perWord, 12);
  });

  describe("blocked", () => {
    it("an unlabeled control cannot be told apart, so every strategy is blocked", () => {
      const r = sr(miniShop, [{ target: "cart-icon", action: "activate", note: "Open the cart" }]);
      expect(r.blocked?.reason).toBe("“button” has no name, so a screen-reader user cannot tell it is the cart.");
      expect(r.blocked?.stepIndex).toBe(0);
      expect(r.seconds).toBe(0);
      expect(r.interval).toEqual([0, 0]);
      expect(r.strategies.every((s) => s.blocked?.reason === r.blocked?.reason)).toBe(true);
    });

    it("without a visual label the reason does not guess", () => {
      const page = buildPage({ id: "root", role: "document", stop: false, children: [{ id: "x", role: "button", name: "", tag: "button", hints: { unlabeled: true } }] });
      expect(sr(page, [{ target: "x", action: "activate" }]).blocked?.reason).toBe("“button” has no name, so a screen-reader user cannot tell what it does.");
    });

    it("a labelled-looking but empty-named control is blocked even without the unlabeled hint, but reading it is not", () => {
      const page = buildPage({ id: "root", role: "document", stop: false, children: [{ id: "x", role: "link", name: "  ", tag: "a" }, { id: "y", role: "paragraph", name: "", tag: "p" }] });
      expect(sr(page, [{ target: "x", action: "activate" }]).blocked).toBeDefined();
      expect(sr(page, [{ target: "y", action: "read" }]).blocked).toBeUndefined();
    });

    it("the tab strategy is blocked for targets that are not focus stops, the others are not", () => {
      const page = paragraphs(5);
      const r = sr(page, [{ target: "p3", action: "read" }]);
      const tab = r.strategies.find((s) => s.strategy === "tab")!;
      expect(tab.blocked?.reason).toBe("Pressing Tab never lands on “one two three four five”: it is not a keyboard focus stop.");
      expect(r.strategies.filter((s) => !s.blocked).map((s) => s.strategy)).toEqual(["headings", "find", "linear", "landmarks"]);
      expect(r.blocked).toBeUndefined();
    });

    it("when every strategy is blocked the persona is blocked with the first strategy's reason", () => {
      const r = sr(miniShop, [{ target: "cart-icon", action: "activate" }]);
      expect(r.blocked).toEqual(r.strategies[0].blocked);
      expect(r.representative).toBe("headings");
    });

    it("a target outside the reading order is blocked with a reason", () => {
      const page = buildPage({ id: "root", role: "document", stop: false, children: [{ id: "g", role: "generic", tag: "div", stop: false, children: [] }, { id: "a", role: "paragraph", name: "Hello", tag: "p" }] });
      const r = sr(page, [{ target: "g", action: "read" }]);
      expect(r.blocked?.reason).toMatch(/not part of the page a screen reader reads/);
    });
  });

  describe("strategies", () => {
    it("headings jumps with H, then walks; linear only walks; both end on the same target", () => {
      const page = paragraphs(20, 12);
      const steps: TaskStep[] = [{ target: "p15", action: "read" }];
      const h = flat(strat(page, "headings", steps));
      const l = flat(strat(page, "linear", steps));
      expect(h.filter((e) => e.command === "nextHeading")).toHaveLength(1);
      expect(h.find((e) => e.command === "nextHeading")!.label).toBe("H → heading, level 2, alpha beta");
      expect(h.filter((e) => e.command === "next")).toHaveLength(3);
      expect(l.every((e) => e.command === "think" || e.command === "next")).toBe(true);
      expect(h[h.length - 1].nodeId).toBe("p15");
      expect(l[l.length - 1].nodeId).toBe("p15");
    });

    it("headings are never worse than linear, and the gain grows as a heading gets closer to the target", () => {
      const T = 30;
      const gain = (h: number | undefined) => {
        const page = paragraphs(T + 1, h);
        const steps: TaskStep[] = [{ target: `p${T}`, action: "read" }];
        return strat(page, "linear", steps).seconds - strat(page, "headings", steps).seconds;
      };
      expect(gain(undefined)).toBeCloseTo(0, 12); // no headings (and nothing focusable): identical
      const gains = [0, 5, 10, 20, 28].map(gain);
      expect(gains[0]).toBeCloseTo(0, 9);
      for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1]);
    });

    it("headings are never worse than linear on random pages", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 40 }), fc.option(fc.nat(), { nil: undefined }), fc.nat(), (n, h, tpick) => {
          const page = paragraphs(n, h === undefined ? undefined : h % n);
          const steps: TaskStep[] = [{ target: `p${tpick % n}`, action: "read" }];
          expect(strat(page, "headings", steps).seconds).toBeLessThanOrEqual(strat(page, "linear", steps).seconds + 1e-9);
          expect(strat(page, "landmarks", steps).seconds).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 80 },
      );
    });

    it("landmarks jump to the first stop inside the next landmark", () => {
      const ev = flat(strat(miniShop, "landmarks", [{ target: "nav-5", action: "activate" }]));
      const cmds = ev.filter((e) => e.nodeId).map((e) => e.command);
      expect(cmds[0]).toBe("nextLandmark");
      expect(ev.find((e) => e.command === "nextLandmark")).toMatchObject({ nodeId: "nav-0", label: "D → navigation landmark, list with 24 items, link, Men" });
      expect(cmds.filter((c) => c === "next")).toHaveLength(5);
    });

    it("find types the first word of the target's name (max 8 chars) and jumps to the first match", () => {
      expect(findQuery("Add to cart")).toBe("Add");
      expect(findQuery("  Sustainability report")).toBe("Sustaina");
      expect(findQuery("")).toBe("");
      const ev = flat(strat(miniShop, "find", [{ target: "add-to-cart", action: "activate" }]));
      const find = ev.find((e) => e.command === "find")!;
      expect(find.label).toBe("Find “add” → button, Add to cart");
      expect(find.nodeId).toBe("add-to-cart");
      const query = 3;
      const words = wordCount("button, Add to cart");
      expect(find.dt).toBeCloseTo((2 + query) * p.K + (words * 60) / p.speechWpm, 12);
      expect(find.utterance!.truncated).toBe(false);
    });

    it("find-next costs one key per further match", () => {
      // Ten paragraphs; the target is the third whose announcement contains "zebra".
      const kids: Spec[] = [];
      for (let i = 0; i < 40; i++) {
        const hit = i === 5 || i === 12 || i === 20;
        kids.push({ id: `p${i}`, role: "paragraph", name: hit ? (i === 20 ? "zebra crossing ahead of you" : "a zebra is here") : "one two three four five", tag: "p" });
      }
      const page = buildPage({ id: "root", role: "document", stop: false, children: kids });
      const s = strat(page, "find", [{ target: "p20", action: "read" }]);
      const moves = flat(s).filter((e) => e.nodeId);
      expect(moves.map((e) => e.command)).toEqual(["find", "find", "find"]);
      expect(moves.map((e) => e.label)).toEqual(["Find “zebra” → a zebra is here", "Find next → a zebra is here", "Find next → zebra crossing ahead of you"]);
      expect(moves[0].dt).toBeCloseTo((2 + 5) * p.K + (4 * 60 * p.listenFraction) / p.speechWpm, 12);
      expect(moves[1].dt).toBeCloseTo(p.K + (4 * 60 * p.listenFraction) / p.speechWpm, 12);
      expect(moves[2].dt).toBeCloseTo(p.K + (5 * 60) / p.speechWpm, 12);
      expect(s.steps[0].commands.find((c) => c.command === "find")!.count).toBe(3);
    });

    it("tab walks the focus order and is blocked only when the target is not a focus stop", () => {
      const ev = flat(strat(miniShop, "tab", [{ target: "nav-2", action: "activate" }]));
      const stops = ev.filter((e) => e.nodeId && e.command === "tab");
      expect(stops.map((e) => e.nodeId)).toEqual(["logo", "search", "cart-icon", "nav-0", "nav-1", "nav-2"]);
      expect(stops[1].label).toBe("Tab → edit, Search, blank");
    });

    it("a step whose target is behind the cursor is reached with Up / Shift+Tab, not blocked", () => {
      const steps: TaskStep[] = [
        { target: "buy-3", action: "activate" },
        { target: "nav-2", action: "activate" },
      ];
      const page = longPage({ navLinks: 10, sections: 5 }).page;
      const r = sr(page, steps);
      for (const s of r.strategies) {
        expect(s.blocked, s.strategy).toBeUndefined();
        expect(flat(s).filter((e) => e.nodeId).slice(-2)[0].nodeId, s.strategy).not.toBeNull();
      }
      const linear = r.strategies.find((s) => s.strategy === "linear")!;
      expect(linear.steps[1].events.filter((e) => e.command === "prev").length).toBeGreaterThan(0);
      const tab = r.strategies.find((s) => s.strategy === "tab")!;
      expect(tab.steps[1].events.filter((e) => e.command === "shiftTab").length).toBeGreaterThan(0);
    });

    it("typing activates the field, then types", () => {
      const ev = flat(strat(miniShop, "headings", [{ target: "search", action: "type", text: "rain" }]));
      expect(ev.slice(-2).map((e) => e.command)).toEqual(["activate", "type"]);
      expect(ev[ev.length - 1].dt).toBeCloseTo(4 * p.charSeconds, 12);
    });
  });

  describe("mixture", () => {
    it("is the weighted mean of unblocked strategies with renormalised weights", () => {
      const r = sr(miniShop, miniShopTasks[0].steps);
      const w = r.weights;
      expect(Object.values(w).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1, 12);
      let mean = 0;
      for (const s of r.strategies) mean += (w[s.strategy] ?? 0) * (s.blocked ? 0 : s.seconds);
      expect(r.seconds).toBeCloseTo(mean, 9);
      expect(r.representative).toBe("headings");
    });
  });

  describe("speech rate", () => {
    const wpms = [150, 200, 300, 450, 600];
    it("speech seconds scale exactly as 1/wpm on a fixed path", () => {
      const base = strat(miniShop, "linear", miniShopTasks[0].steps);
      const reference = totalSpeechSeconds(base);
      for (const wpm of wpms) {
        const s = strat(miniShop, "linear", miniShopTasks[0].steps, { ...p, speechWpm: wpm }); // linear's path does not depend on the rate
        expect(totalSpeechSeconds(s) * wpm).toBeCloseTo(reference * p.speechWpm, 9);
      }
    });

    it("seconds are monotone non-increasing in wpm for every strategy and for the mixture", () => {
      for (const t of miniShopTasks) {
        let prev: StrategyResult[] | null = null;
        let prevMix = Infinity;
        for (const wpm of wpms) {
          const r = evaluateWithParams(miniShop, [t], { ...p, speechWpm: wpm })[0].personas.screenreader;
          if (prev) r.strategies.forEach((s, i) => !s.blocked && expect(s.seconds).toBeLessThanOrEqual(prev![i].seconds + 1e-9));
          expect(r.seconds).toBeLessThanOrEqual(prevMix + 1e-9);
          prev = r.strategies;
          prevMix = r.seconds;
        }
      }
    });

    it("monotone in wpm on random pages", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 30 }), fc.option(fc.nat(), { nil: undefined }), fc.nat(), fc.double({ min: 100, max: 500, noNaN: true }), fc.double({ min: 1.01, max: 3, noNaN: true }), (n, h, tpick, wpm, factor) => {
          const page = paragraphs(n, h === undefined ? undefined : h % n);
          const steps: TaskStep[] = [{ target: `p${tpick % n}`, action: "read" }];
          const slow = sr(page, steps, { ...p, speechWpm: wpm });
          const fast = sr(page, steps, { ...p, speechWpm: wpm * factor });
          expect(fast.seconds).toBeLessThanOrEqual(slow.seconds + 1e-9);
          slow.strategies.forEach((s, i) => !s.blocked && expect(fast.strategies[i].seconds).toBeLessThanOrEqual(s.seconds + 1e-9));
        }),
        { numRuns: 80 },
      );
    });

    it("speechSeconds of a recipe is (full + part x listenFraction) x 60 / wpm", () => {
      expect(speechSeconds({ spkFull: 10, spkPart: 20 }, { ...p, speechWpm: 300, listenFraction: 0.5 })).toBeCloseTo(((10 + 10) * 60) / 300, 12);
    });
  });
});
