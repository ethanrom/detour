import { describe, expect, it } from "vitest";
import { buildPage } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import type { Task } from "@/lib/contracts";
import { evaluate } from "./index";
import { expectTaskResultShape, longPage } from "./testkit";

const [buyM, returns] = evaluate(miniShop, miniShopTasks);
const NUM = String.raw`\d+\.\d`;

describe("explanations on mini-shop", () => {
  it("buy-m: screen reader, slow alternative, keyboard block, mouse", () => {
    expect(buyM.explanation).toHaveLength(4);
    expect(buyM.explanation[0]).toMatch(new RegExp(`^A screen-reader user hears \\d+ announcements before reaching “Add to cart” \\(${NUM} s\\)\\.$`));
    expect(buyM.explanation[1]).toMatch(new RegExp(`^Reading straight down with the arrow key instead takes ${NUM} s: 36 announcements, 24 of them in the navigation menu, which has no skip link\\.$`));
    expect(buyM.explanation[2]).toBe("A keyboard user cannot choose size M. The size picker option “M” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.");
    expect(buyM.explanation[3]).toMatch(new RegExp(`^The mouse user needs ${NUM} s\\.$`));
  });

  it("returns: scrolling for the keyboard, nav attribution for the slow strategy", () => {
    expect(returns.explanation[0]).toMatch(new RegExp(`^A screen-reader user hears \\d+ announcements before reaching “Return unworn items within 60 days for…” \\(${NUM} s\\)\\.$`));
    expect(returns.explanation.some((s) => /24 of them in the navigation menu, which has no skip link/.test(s))).toBe(true);
    expect(returns.explanation).toContainEqual(expect.stringMatching(new RegExp(`^A keyboard user scrolls 2 screens to reach “Return unworn items within 60 days for…” \\(${NUM} s\\)\\.$`)));
  });

  it("is deterministic: same text across runs, seeds and sample counts", () => {
    const again = evaluate(miniShop, miniShopTasks, { seed: 123, samples: 0 });
    expect(again[0].explanation).toEqual(buyM.explanation);
    expect(again[1].explanation).toEqual(returns.explanation);
    expect(evaluate(miniShop, miniShopTasks)[0].explanation).toEqual(buyM.explanation);
  });

  it("is 2 to 4 sentences with the exact result shape", () => {
    expectTaskResultShape(buyM);
    expectTaskResultShape(returns);
  });

  it("an unnamed control is explained for the screen-reader user", () => {
    const t: Task = { id: "cart", siteId: "mini-shop", label: "Open the cart", grounding: "fixture", steps: [{ target: "cart-icon", action: "activate", note: "Open the cart" }] };
    const r = evaluate(miniShop, [t])[0];
    expect(r.explanation[0]).toBe("A screen-reader user cannot open the cart. “button” has no name, so a screen-reader user cannot tell it is the cart.");
    expect(r.personas.screenreader.blocked).toBeDefined();
    expect(r.personas.keyboard.blocked).toBeUndefined();
    expect(r.personas.mouse.blocked).toBeUndefined();
  });
});

describe("attribution to blocks", () => {
  const buy3: Task = { id: "b3", siteId: "s", label: "Buy item 3", grounding: "fixture", steps: [{ target: "buy-3", action: "activate" }] };

  it("without a skip link the keyboard user's Tabs are attributed to the navigation", () => {
    const r = evaluate(longPage({ navLinks: 24 }).page, [buy3])[0];
    expect(r.explanation).toContainEqual(expect.stringMatching(/^A keyboard user presses Tab 28 times before reaching “Buy item 3” \(\d+\.\d s\); 24 of them are in the navigation menu, which has no skip link\.$/));
  });

  it("with a skip link the keyboard user skips the navigation and the explanation says so", () => {
    const r = evaluate(longPage({ navLinks: 24, skipLink: true }).page, [buy3])[0];
    expect(r.explanation).toContainEqual(expect.stringMatching(/^A keyboard user presses Tab 4 times and uses a skip link before reaching “Buy item 3” \(\d+\.\d s\)\.$/));
  });

  it("says when a skip link exists but does not bypass the block, and stays quiet when it does", () => {
    const build = (href: string) =>
      buildPage({
        id: "root",
        role: "document",
        stop: false,
        children: [
          { id: "skip", role: "link", name: "Skip", tag: "a", href, rect: { x: 0, y: 0, w: 10, h: 10 } },
          {
            id: "nav",
            role: "navigation",
            landmark: "navigation",
            tag: "nav",
            stop: false,
            hints: { repetitiveBlock: true },
            children: Array.from({ length: 12 }, (_, i) => ({ id: "n" + i, role: "link", name: "Link " + i, tag: "a", rect: { x: 0, y: 20 + i * 30, w: 80, h: 20 } })),
          },
          { id: "main", role: "generic", tag: "main", stop: false, children: [{ id: "go", role: "button", name: "Go", tag: "button", rect: { x: 0, y: 500, w: 60, h: 30 } }] },
        ],
      });
    const task: Task = { id: "go", siteId: "s", label: "Go", grounding: "fixture", steps: [{ target: "go", action: "activate" }] };
    const nonBypassing = evaluate(build("nav"), [task])[0];
    expect(nonBypassing.explanation[0]).toMatch(/; 12 of them are in the navigation menu, which no skip link bypasses.$/);
    const bypassing = evaluate(build("main"), [task])[0];
    expect(bypassing.explanation[0]).toMatch(/; 12 of them are in the navigation menu.$/);
    expectTaskResultShape(nonBypassing);
    expectTaskResultShape(bypassing);
  });

  it("a page without repetitive blocks gets no attribution clause", () => {
    const r = evaluate(longPage({ navLinks: 2, navLandmark: false }).page, [buy3])[0];
    expect(r.explanation.join(" ")).not.toMatch(/of them/);
  });
});
