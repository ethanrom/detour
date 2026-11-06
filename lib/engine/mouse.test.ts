import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { wordCount } from "@/lib/a11y/announce";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import type { Rect, Task, TaskStep, TraceEvent } from "@/lib/contracts";
import { evaluate, nominalParams } from "./index";

const VIEW = { w: 1280, h: 800 };

function pageWith(items: Array<{ id: string; rect: Rect | null; role?: string; name?: string }>, docHeight = 5000) {
  const kids: Spec[] = items.map((i) => ({ id: i.id, role: i.role ?? "button", name: i.name ?? i.id, tag: "button", rect: i.rect }));
  // A spacer so the document is tall enough to scroll.
  kids.push({ id: "spacer", role: "generic", tag: "div", name: "", rect: { x: 0, y: docHeight - 10, w: 10, h: 10 } });
  return buildPage({ id: "root", role: "document", stop: false, children: kids }, { viewport: VIEW });
}

function task(steps: TaskStep[]): Task {
  return { id: "t", siteId: "s", label: "task", steps, grounding: "fixture" };
}

function mouseEvents(page: ReturnType<typeof pageWith>, steps: TaskStep[]): TraceEvent[][] {
  const r = evaluate(page, [task(steps)], { samples: 0 })[0].personas.mouse;
  return r.strategies[0].steps.map((s) => s.events);
}

/** A w x h button whose centre is `d` px to the right of the viewport centre, at the same height. */
const at = (d: number, w: number, h: number): Rect => ({ x: VIEW.w / 2 + d - w / 2, y: VIEW.h / 2 - h / 2, w, h });

describe("mouse model", () => {
  const p = nominalParams();
  const fitts = (d: number, w: number) => p.fittsA + p.fittsB * Math.log2(d / w + 1);

  it("pointing time follows Fitts's law with W = min(w, h)", () => {
    const page = pageWith([{ id: "a", rect: at(300, 120, 30) }]);
    const [ev] = mouseEvents(page, [{ target: "a", action: "activate" }]);
    expect(ev.map((e) => e.command)).toEqual(["think", "point", "click"]);
    expect(ev[1].dt).toBeCloseTo(fitts(300, 30), 12);
    expect(ev[2].dt).toBeCloseTo(2 * p.B, 12);
    expect(ev[0].dt).toBeCloseTo(p.M, 12);
  });

  it("farther or smaller targets never point faster", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 600 }), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 8, max: 200 }), fc.integer({ min: 0, max: 100 }), (d, extraD, w, shrink) => {
        const w2 = Math.max(4, w - shrink);
        const near = mouseEvents(pageWith([{ id: "a", rect: at(d, w, w) }]), [{ target: "a", action: "activate" }])[0][1].dt;
        const far = mouseEvents(pageWith([{ id: "a", rect: at(d + extraD, w, w) }]), [{ target: "a", action: "activate" }])[0][1].dt;
        const small = mouseEvents(pageWith([{ id: "a", rect: at(d, w2, w2) }]), [{ target: "a", action: "activate" }])[0][1].dt;
        expect(far).toBeGreaterThanOrEqual(near - 1e-12);
        expect(small).toBeGreaterThanOrEqual(near - 1e-12);
      }),
      { numRuns: 100 },
    );
  });

  it("the pointer starts at the viewport centre and each step starts where the last ended", () => {
    const page = pageWith([
      { id: "a", rect: { x: 100, y: 100, w: 40, h: 40 } },
      { id: "b", rect: { x: 400, y: 100, w: 40, h: 40 } },
    ]);
    const [s0, s1] = mouseEvents(page, [
      { target: "a", action: "activate" },
      { target: "b", action: "activate" },
    ]);
    expect(s0[1].dt).toBeCloseTo(fitts(Math.hypot(120 - 640, 120 - 400), 40), 12);
    expect(s1[1].dt).toBeCloseTo(fitts(300, 40), 12); // a(120,120) -> b(420,120)
  });

  it("scrolls ceil(|dy| / viewport) screens when the target is off-screen, then points from the same screen position", () => {
    // Centre y = 2400; viewport centre 400 -> dy = 2000 -> ceil(2000 / 800) = 3 screens.
    const page = pageWith([
      { id: "far", rect: { x: 600, y: 2380, w: 80, h: 40 } },
      { id: "near-after", rect: { x: 600, y: 2480, w: 80, h: 40 } },
    ]);
    const [s0, s1] = mouseEvents(page, [
      { target: "far", action: "activate" },
      { target: "near-after", action: "activate" },
    ]);
    expect(s0.filter((e) => e.command === "scroll")).toHaveLength(3);
    expect(s0.filter((e) => e.command === "scroll").every((e) => e.dt === p.secondsPerViewport && e.label === "Scroll down one screen")).toBe(true);
    // After scrolling, the target is at the viewport centre height: pointing distance is horizontal only.
    expect(s0.find((e) => e.command === "point")!.dt).toBeCloseTo(fitts(0, 40), 12);
    // The next target is 100 px below the last one: still on screen, so no scroll.
    expect(s1.some((e) => e.command === "scroll")).toBe(false);
    expect(s1.find((e) => e.command === "point")!.dt).toBeCloseTo(fitts(100, 40), 12);
  });

  it("scrolls back up when the next target is above the viewport", () => {
    const page = pageWith([
      { id: "far", rect: { x: 600, y: 2380, w: 80, h: 40 } },
      { id: "top", rect: { x: 600, y: 20, w: 80, h: 40 } },
    ]);
    const [, s1] = mouseEvents(page, [
      { target: "far", action: "activate" },
      { target: "top", action: "activate" },
    ]);
    const scrolls = s1.filter((e) => e.command === "scroll");
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((e) => e.label === "Scroll up one screen")).toBe(true);
  });

  it("uses the KLM pointing operator P when the page has no layout", () => {
    const page = pageWith([{ id: "x", rect: null }]);
    const [ev] = mouseEvents(page, [{ target: "x", action: "activate" }]);
    expect(ev.find((e) => e.command === "point")!.dt).toBeCloseTo(p.P, 12);
    expect(ev.some((e) => e.command === "scroll")).toBe(false);
  });

  it("type = point, click, home to keyboard, characters, home back", () => {
    const page = pageWith([{ id: "f", role: "textbox", name: "Search", rect: at(0, 200, 30) }]);
    const [ev] = mouseEvents(page, [{ target: "f", action: "type", text: "rain jacket" }]);
    expect(ev.map((e) => e.command)).toEqual(["think", "point", "click", "type"]);
    expect(ev[3].dt).toBeCloseTo(2 * p.H + 11 * p.charSeconds, 12);
    expect(ev[3].label).toBe("Type “rain jacket”");
  });

  it("read = point at the content and read its words, with no click", () => {
    const page = pageWith([{ id: "r", role: "paragraph", name: "Return unworn items within sixty days.", rect: at(100, 400, 40) }]);
    const [ev] = mouseEvents(page, [{ target: "r", action: "read" }]);
    expect(ev.map((e) => e.command)).toEqual(["think", "point", "think"]);
    expect(ev[2].dt).toBeCloseTo((wordCount("Return unworn items within sixty days.") * 60) / p.readingWpm, 12);
    expect(ev[2].label).toBe("Read → Return unworn items within sixty days.");
  });

  it("labels are deterministic", () => {
    const page = pageWith([{ id: "a", name: "Add to cart", rect: at(50, 100, 40) }]);
    const [ev] = mouseEvents(page, [{ target: "a", action: "activate" }]);
    expect(ev.map((e) => e.label)).toEqual(["Think", "Point → Add to cart", "Click → Add to cart"]);
    expect(ev.map((e) => e.nodeId)).toEqual([null, "a", "a"]);
  });

  it("reports a missing target as blocked for every persona instead of throwing", () => {
    const page = pageWith([{ id: "a", rect: at(0, 40, 40) }]);
    const r = evaluate(page, [task([{ target: "ghost", action: "activate" }])], { samples: 0 })[0];
    for (const persona of Object.values(r.personas)) {
      expect(persona.blocked?.reason).toBe("The target “ghost” is not on the page.");
      expect(persona.seconds).toBe(0);
    }
  });
});
