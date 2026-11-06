import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { wordCount } from "@/lib/a11y/announce";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import type { PageModel, Task, TaskStep, TraceEvent } from "@/lib/contracts";
import { evaluate, evaluateWithParams, nominalParams } from "./index";
import { longPage } from "./testkit";

function task(steps: TaskStep[], id = "t"): Task {
  return { id, siteId: "s", label: "task", steps, grounding: "fixture" };
}

function keyboard(page: PageModel, steps: TaskStep[]) {
  return evaluate(page, [task(steps)], { samples: 0 })[0].personas.keyboard;
}

function events(page: PageModel, steps: TaskStep[]): TraceEvent[][] {
  return keyboard(page, steps).strategies[0].steps.map((s) => s.events);
}

const link = (id: string, extra: Partial<Spec> = {}): Spec => ({ id, role: "link", name: `Link ${id}`, tag: "a", rect: { x: 0, y: 0, w: 80, h: 20 }, ...extra });

const row = buildPage({
  id: "root",
  role: "document",
  stop: false,
  children: [link("a"), link("b"), link("c"), link("d"), { id: "para", role: "paragraph", name: "Some body text to read", tag: "p", rect: { x: 0, y: 3000, w: 400, h: 40 } }, { id: "field", role: "textbox", name: "Search", tag: "input", rect: { x: 0, y: 100, w: 200, h: 30 } }],
});

describe("keyboard model", () => {
  const p = nominalParams();
  const kf = p.K * p.keyboardMotorFactor;

  it("starts before the first stop: reaching the n-th stop takes n Tabs, then Enter", () => {
    const [s0] = events(row, [{ target: "c", action: "activate" }]);
    expect(s0.map((e) => e.command)).toEqual(["think", "tab", "tab", "tab", "activate"]);
    expect(s0.map((e) => e.nodeId)).toEqual([null, "a", "b", "c", "c"]);
    expect(s0.map((e) => e.label)).toEqual(["Think", "Tab → link, Link a", "Tab → link, Link b", "Tab → link, Link c", "Enter → link, Link c"]);
    expect(s0[1].dt).toBeCloseTo(kf, 12);
    expect(s0[4].dt).toBeCloseTo(kf, 12);
  });

  it("each step starts on the previous target and Shift+Tab walks backwards", () => {
    const [, s1] = events(row, [
      { target: "c", action: "activate" },
      { target: "a", action: "activate" },
    ]);
    expect(s1.map((e) => e.command)).toEqual(["think", "shiftTab", "shiftTab", "activate"]);
    expect(s1[1].label).toBe("Shift+Tab → link, Link b");
    const [, same] = events(row, [
      { target: "c", action: "activate" },
      { target: "c", action: "activate" },
    ]);
    expect(same.map((e) => e.command)).toEqual(["think", "activate"]);
  });

  it("a select uses Space; typing into a focused field needs no activation key", () => {
    const [sel] = events(row, [{ target: "a", action: "select" }]);
    expect(sel[sel.length - 1].label).toBe("Space → link, Link a");
    const [typed] = events(row, [{ target: "field", action: "type", text: "boots" }]);
    expect(typed.map((e) => e.command)).toEqual(["think", "tab", "tab", "tab", "tab", "tab", "type"]);
    expect(typed[typed.length - 1].dt).toBeCloseTo(5 * p.charSeconds, 12);
  });

  it("scales every keystroke with keyboardMotorFactor (but not thinking or typing)", () => {
    const steps: TaskStep[] = [{ target: "c", action: "activate" }];
    const slow = evaluateWithParams(row, [task(steps)], { ...p, keyboardMotorFactor: 3 })[0].personas.keyboard.strategies[0].steps[0].events;
    expect(slow[1].dt).toBeCloseTo(3 * p.K, 12);
    expect(slow[0].dt).toBeCloseTo(p.M, 12);
  });

  it("follows page.focusOrder: a positive tabindex is reached first", () => {
    const page = buildPage({ id: "root", role: "document", stop: false, children: [link("a"), link("b"), link("urgent", { tabIndex: 5 })] });
    expect(page.focusOrder).toEqual(["urgent", "a", "b"]);
    const [s0] = events(page, [{ target: "urgent", action: "activate" }]);
    expect(s0.filter((e) => e.command === "tab")).toHaveLength(1);
    const [s1] = events(page, [{ target: "b", action: "activate" }]);
    expect(s1.filter((e) => e.command === "tab")).toHaveLength(3);
  });

  describe("blocked", () => {
    it("a clickable div cannot be operated", () => {
      const page = buildPage({
        id: "root",
        role: "document",
        stop: false,
        children: [{ id: "x", role: "generic", name: "Buy now", tag: "span", focusable: false, actionable: true, hints: { fakeButton: true }, rect: { x: 0, y: 0, w: 50, h: 20 } }],
      });
      const r = keyboard(page, [{ target: "x", action: "activate" }]);
      expect(r.blocked?.reason).toBe("The “Buy now” control can't be reached with the keyboard: it is a clickable <span> that cannot receive focus.");
    });

    it("explains tabindex=-1 and disabled controls", () => {
      const page = buildPage({
        id: "root",
        role: "document",
        stop: false,
        children: [link("neg", { tabIndex: -1, name: "Hidden link" }), { id: "dis", role: "button", name: "Pay", tag: "button", states: ["disabled"], rect: { x: 0, y: 0, w: 50, h: 20 } }],
      });
      expect(keyboard(page, [{ target: "neg", action: "activate" }]).blocked?.reason).toBe('The “Hidden link” link can\'t be reached with the keyboard: it has tabindex="-1", so Tab skips it.');
      expect(keyboard(page, [{ target: "dis", action: "activate" }]).blocked?.reason).toBe("The “Pay” button can't be reached with the keyboard: it is disabled.");
    });

    it("reports the failing step and keeps the earlier steps' trace", () => {
      const miniLike = buildPage({
        id: "root",
        role: "document",
        stop: false,
        children: [link("a"), { id: "x", role: "generic", name: "M", tag: "div", focusable: false, actionable: true, hints: { fakeButton: true } }],
      });
      const r = keyboard(miniLike, [
        { target: "a", action: "activate" },
        { target: "x", action: "select" },
      ]);
      expect(r.blocked?.stepIndex).toBe(1);
      expect(r.strategies[0].steps).toHaveLength(1);
      expect(r.seconds).toBe(0);
    });

    it("reading is never blocked: it scrolls, then reads", () => {
      const [s] = events(row, [{ target: "para", action: "read" }]);
      expect(s.map((e) => e.command)).toEqual(["think", "scroll", "scroll", "scroll", "scroll", "think"]);
      expect(s[1].label).toBe("Page Down → scroll one screen");
      expect(s[1].dt).toBeCloseTo(kf + p.secondsPerViewport, 12);
      expect(s[s.length - 1].dt).toBeCloseTo((wordCount("Some body text to read") * 60) / p.readingWpm, 12);
      const unfocusable = keyboard(row, [{ target: "para", action: "read" }]);
      expect(unfocusable.blocked).toBeUndefined();
    });
  });

  describe("skip links", () => {
    const without = longPage({ navLinks: 24 });
    const withSkip = longPage({ navLinks: 24, skipLink: true });

    it("the page model has the skip link we expect", () => {
      expect(withSkip.page.skipLinks).toEqual([{ from: "skip", to: "title-0" }]);
      expect(withSkip.page.focusOrder[0]).toBe("skip");
      expect(without.page.skipLinks).toEqual([]);
    });

    it("helps when the target is after the navigation", () => {
      const steps: TaskStep[] = [{ target: "buy-3", action: "activate" }];
      const a = keyboard(without.page, steps);
      const b = keyboard(withSkip.page, steps);
      expect(b.seconds).toBeLessThan(a.seconds);
      const ev = b.strategies[0].steps[0].events;
      expect(ev.map((e) => e.command)).toEqual(["think", "tab", "activate", "tab", "tab", "tab", "activate"]);
      expect(ev[1].label).toBe("Tab → link, Skip to main content");
      expect(ev[2].label).toBe("Enter → skip link “Skip to main content” → button, Buy item 0");
      expect(ev[2].nodeId).toBe("buy-0");
      expect(a.strategies[0].steps[0].events.filter((e) => e.command === "tab")).toHaveLength(24 + 4);
    });

    it("is never worse than one extra Tab, for any target on the page", () => {
      const targets = [...Array.from({ length: 24 }, (_, i) => `nav-${i}`), ...Array.from({ length: 6 }, (_, i) => `buy-${i}`)];
      for (const target of targets) {
        const steps: TaskStep[] = [{ target, action: "activate" }];
        const a = keyboard(without.page, steps).seconds;
        const b = keyboard(withSkip.page, steps).seconds;
        expect(b).toBeLessThanOrEqual(a + kf + 1e-9);
      }
    });

    it("property: a skip link inserted first on a random page costs at most one Tab", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 12 }), fc.nat(), (navLinks, sections, pick) => {
          const base = longPage({ navLinks, sections });
          const skip = longPage({ navLinks, sections, skipLink: true });
          const target = pick % 2 === 0 ? `buy-${pick % sections}` : `nav-${pick % navLinks}`;
          const steps: TaskStep[] = [{ target, action: "activate" }];
          const a = keyboard(base.page, steps).seconds;
          const b = keyboard(skip.page, steps).seconds;
          expect(b).toBeLessThanOrEqual(a + kf + 1e-9);
          if (target.startsWith("buy-") && navLinks >= 4) expect(b).toBeLessThan(a); // pays off once the nav has more than a few links
        }),
        { numRuns: 60 },
      );
    });
  });
});
