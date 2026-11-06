import { describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { evaluate } from "./index";
import { longPage } from "./testkit";

describe("performance", () => {
  // ~1,000 nodes: 250 nav links, 150 sections x (title, paragraph, button), 300 footer links, wrappers.
  // The targets sit near the end of the page, which is the worst case for every navigation graph.
  const lp = longPage({ navLinks: 250, sections: 150, footerLinks: 300, headings: true });
  const nodeCount = Object.keys(lp.page.nodes).length;
  const tasks = [
    lp.task([{ target: lp.buy(140), action: "activate" }, { target: lp.buy(145), action: "activate" }], "late-buy"),
    lp.task([{ target: lp.para(130), action: "read" }], "late-read"),
    lp.task([{ target: "foot-250", action: "activate" }], "footer-link"),
  ];

  /** Best-of-N wall time after warm-up: robust to scheduler noise when other test files run in parallel. */
  function timeBest(makePage: () => PageModel): number {
    for (let i = 0; i < 4; i++) evaluate(makePage(), tasks, { samples: 0 }); // warm up the JIT, as a long optimiser loop would
    let best = Infinity;
    for (let i = 0; i < 15; i++) {
      const page = makePage();
      const t0 = performance.now();
      evaluate(page, tasks, { samples: 0 });
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  }

  it("fixture is about 1,000 nodes", () => {
    expect(nodeCount).toBeGreaterThanOrEqual(900);
    expect(nodeCount).toBeLessThanOrEqual(1200);
  });

  it("evaluate(samples: 0) on a ~1,000-node page with 3 tasks takes < 15 ms (index cached)", () => {
    expect(timeBest(() => lp.page)).toBeLessThan(15);
  });

  it("also takes < 15 ms when the page object is new each call (fix optimiser pattern: index rebuilt)", () => {
    // A shallow copy has a new identity but the same content, so the per-page index is rebuilt.
    expect(timeBest(() => ({ ...lp.page }))).toBeLessThan(15);
  });

  it("the default 400-sample Monte Carlo adds little on top", () => {
    const one = [tasks[0]];
    let best = Infinity;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      evaluate(lp.page, one);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(60);
  });
});
