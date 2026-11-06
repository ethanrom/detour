import { describe, expect, it } from "vitest";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import type { PageModel, Task } from "@/lib/contracts";
import { evaluate, VERIFY_LABEL } from "./index";
import { longPage } from "./testkit";

const fake = (id: string, name: string, tag = "div"): Spec => ({ id, role: "generic", name, tag, hints: { fakeButton: true }, rect: { x: 0, y: 0, w: 40, h: 40 } });
const text = (id: string, name: string): Spec => ({ id, role: "generic", name, tag: "div", rect: { x: 0, y: 0, w: 100, h: 20 } });
const page = (...kids: Spec[]): PageModel => buildPage({ id: "root", role: "document", stop: false, children: kids });
const task = (steps: Task["steps"]): Task => ({ id: "t", siteId: "s", label: "t", grounding: "fixture", steps });
const keyboardReason = (p: PageModel, note: string, target: string) => evaluate(p, [task([{ target, action: "select", note }])], { samples: 0 })[0].personas.keyboard.blocked?.reason;

describe("group noun in the keyboard-blocked reason", () => {
  // Northwind layout: a colour picker, then "Size: Select a size" + a "Size guide" fake link, then the size options.
  const northwind = page(
    text("lbl-colour", "Colour: Forest"),
    { id: "swatches", role: "generic", tag: "div", stop: false, children: ["a", "b", "c", "d", "e"].map((c) => fake(`sw-${c}`, "")) },
    { id: "optlabel", role: "generic", tag: "div", stop: false, children: [text("lbl-size", "Size: Select a size"), fake("guide", "Size guide")] },
    { id: "sizes", role: "generic", tag: "div", stop: false, children: ["XS", "S", "M", "L"].map((s) => fake(`size-${s.toLowerCase()}`, s)) },
  );

  it("is the label right before the group, not an earlier group's label", () => {
    expect(keyboardReason(northwind, "Choose size M", "size-m")).toBe("The size picker option “M” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.");
  });

  it("is dropped when the step note does not mention it", () => {
    const noSizeLabel = page(text("lbl-colour", "Colour: Forest"), { id: "sizes", role: "generic", tag: "div", stop: false, children: ["XS", "S", "M"].map((s) => fake(`size-${s.toLowerCase()}`, s)) });
    expect(keyboardReason(noSizeLabel, "Choose size M", "size-m")).toBe("The option “M” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.");
  });

  it("is dropped when the preceding text is prose", () => {
    const langs = page(text("banner", "An official website of Riverside County government"), fake("how", "Here's how you know"), { id: "langs", role: "generic", tag: "div", stop: false, children: [fake("en", "English", "span"), fake("es", "Español", "span")] });
    expect(keyboardReason(langs, "Choose Español", "es")).toBe("The option “Español” can't be reached with the keyboard: it is a clickable <span> that cannot receive focus.");
  });
});

describe("explanation attribution and skip-link tail", () => {
  const links = (n: number): Spec[] => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, role: "link", name: `Link ${i}`, tag: "a", rect: { x: 0, y: i * 30, w: 80, h: 20 } }));
  const goTask = task([{ target: "go", action: "activate" }]);
  const go: Spec = { id: "go", role: "button", name: "Go", tag: "button", rect: { x: 0, y: 900, w: 60, h: 30 } };

  it("does not blame a region landmark", () => {
    const p = page({ id: "reg", role: "region", landmark: "region", name: "Summit Jacket", tag: "section", stop: false, children: links(12) }, go);
    expect(evaluate(p, [goTask])[0].explanation[0]).not.toMatch(/region/);
  });

  it("still blames a navigation landmark", () => {
    const p = page({ id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, children: links(12) }, go);
    expect(evaluate(p, [goTask])[0].explanation[0]).toMatch(/12 of them are in the navigation menu, which has no skip link\.$/);
  });

  it("never says no skip link bypasses the block when a skip link lands after it", () => {
    const p = page(
      { id: "skip", role: "link", name: "Skip", tag: "a", href: "main", rect: { x: 0, y: 0, w: 10, h: 10 } },
      { id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, children: links(12) },
      { id: "main", role: "generic", tag: "main", stop: false, children: [go] },
    );
    expect(evaluate(p, [goTask])[0].explanation[0]).not.toMatch(/skip link/);
  });

  it("never attaches the tail to a keyboard path that used a skip link", () => {
    // The skip link sits after the nav and jumps over three buttons to the real content.
    const p = page(
      { id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, children: links(10) },
      { id: "skip", role: "link", name: "Skip", tag: "a", href: "content", rect: { x: 0, y: 0, w: 10, h: 10 } },
      ...["b1", "b2", "b3"].map((id): Spec => ({ id, role: "button", name: id, tag: "button", rect: { x: 0, y: 500, w: 40, h: 20 } })),
      { id: "content", role: "generic", tag: "main", stop: false, children: [go] },
    );
    const sentence = evaluate(p, [goTask])[0].explanation.find((s) => s.startsWith("A keyboard user"));
    expect(sentence).toMatch(/^A keyboard user presses Tab 11 times and uses a skip link before reaching “Go” \(\d+\.\d s\); 10 of them are in the navigation menu\.$/);
  });

  it("explains fake controls to the screen-reader user", () => {
    expect(evaluate(miniShop, [miniShopTasks[0]])[0].explanation).toContain("“M” is a clickable <div>: the screen reader announces no role or selected state, so the user has to re-check it.");
  });
});

describe("verification of fake controls (screen reader)", () => {
  const buy = evaluate(miniShop, [miniShopTasks[0]], { samples: 0 })[0].personas.screenreader;
  const events = (strategy: string, step: number) => buy.strategies.find((s) => s.strategy === strategy)!.steps[step].events;

  it("follows a fake select with a think, a re-read and an Up/Down round trip", () => {
    expect(events("linear", 0).filter((e) => e.label === VERIFY_LABEL).map((e) => e.command)).toEqual(["think", "think", "prev", "next"]);
  });

  it("is not charged after a real button", () => {
    expect(events("linear", 1).filter((e) => e.label === VERIFY_LABEL)).toHaveLength(0);
  });

  it("is not charged to the keyboard or mouse persona", () => {
    const r = evaluate(longPage().page, [task([{ target: "buy-0", action: "activate" }])], { samples: 0 })[0];
    expect(JSON.stringify(r.personas.keyboard.strategies)).not.toContain(VERIFY_LABEL);
  });
});
