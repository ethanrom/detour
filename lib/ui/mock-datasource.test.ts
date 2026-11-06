import { describe, expect, it } from "vitest";
import type { PersonaResult, TaskResult } from "@/lib/contracts";
import { createMockDataSource, loadFixture } from "./mock-datasource";
import { buildLane } from "./timeline";
import { fixImpacts, describeImpact, compareTask } from "./compare";

const ds = createMockDataSource({ latencyMs: 0 });

function checkPersona(pr: PersonaResult) {
  const rep = pr.strategies.find((s) => s.strategy === pr.representative);
  expect(rep, `representative ${pr.representative} exists`).toBeTruthy();
  // Weights are a distribution over the unblocked strategies.
  const unblocked = pr.strategies.filter((s) => !s.blocked);
  if (!pr.blocked) {
    const sum = Object.values(pr.weights).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeGreaterThan(0.97);
    expect(sum).toBeLessThan(1.03);
    const mix = unblocked.reduce((a, s) => a + (pr.weights[s.strategy] ?? 0) * s.seconds, 0);
    expect(Math.abs(mix - pr.seconds)).toBeLessThan(0.3);
    expect(pr.interval[0]).toBeLessThanOrEqual(pr.seconds);
    expect(pr.interval[1]).toBeGreaterThanOrEqual(pr.seconds);
    // Representative = highest-weight unblocked strategy.
    const top = Math.max(...unblocked.map((s) => pr.weights[s.strategy] ?? 0));
    expect(pr.weights[pr.representative]).toBe(top);
  }
  // Event times: contiguous, ordered, step seconds add up.
  let cursor = 0;
  for (const step of rep!.steps) {
    let sum = 0;
    for (const e of step.events) {
      expect(e.t).toBeGreaterThanOrEqual(cursor - 0.02);
      expect(e.dt).toBeGreaterThanOrEqual(0);
      cursor = e.t + e.dt;
      sum += e.dt;
      if (e.utterance) {
        expect(e.utterance.text.length).toBeGreaterThan(0);
        expect(e.utterance.seconds).toBeGreaterThanOrEqual(0);
      }
    }
    expect(Math.abs(sum - step.seconds)).toBeLessThan(0.05);
  }
}

function checkResults(results: TaskResult[]) {
  for (const r of results) {
    expect(r.explanation.length).toBeGreaterThan(0);
    for (const p of ["mouse", "keyboard", "screenreader"] as const) {
      expect(r.personas[p].persona).toBe(p);
      checkPersona(r.personas[p]);
    }
  }
}

describe("sample data", () => {
  it("lists the three sites with their tasks", async () => {
    const sites = await ds.listSites();
    expect(sites.map((s) => s.id)).toEqual(["northwind", "riverside", "alpine"]);
    expect(sites.map((s) => s.kind)).toEqual(["demo", "demo", "control"]);
    expect(sites[0].tasks.map((t) => t.id)).toEqual(["buy-m", "returns", "open-cart"]);
    for (const s of sites) expect(s.path).toMatch(/^\/sites\/[a-z]+\/index\.html$/);
  });

  it("is internally consistent for every site, before and after every plan size", async () => {
    for (const site of await ds.listSites()) {
      const fx = await loadFixture(site.id);
      expect(fx.baseline.map((r) => r.taskId)).toEqual(site.tasks.map((t) => t.id));
      checkResults(fx.baseline);
      for (const sc of Object.values(fx.byK)) {
        expect(sc.results.map((r) => r.taskId)).toEqual(site.tasks.map((t) => t.id));
        checkResults(sc.results);
      }
    }
  });

  it("matches the Northwind story: mouse ~4.3 s, keyboard blocked, screen reader ~52 s", async () => {
    const [nw] = await ds.listSites();
    const { results } = await ds.analyze(nw, null);
    const buy = results.find((r) => r.taskId === "buy-m")!;
    expect(buy.personas.mouse.seconds).toBeCloseTo(4.3, 0);
    expect(buy.personas.mouse.interval).toEqual([3.4, 5.6]);
    expect(buy.personas.keyboard.blocked?.reason).toBe(
      "The size option “M” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.",
    );
    expect(buy.personas.screenreader.seconds).toBeGreaterThan(48);
    expect(buy.personas.screenreader.seconds).toBeLessThan(56);
    expect(buy.personas.screenreader.interval).toEqual([38, 71]);
    const cart = results.find((r) => r.taskId === "open-cart")!;
    expect(cart.personas.screenreader.blocked?.reason).toBe("“button” has no name, so a screen-reader user cannot tell it is the cart.");
  });

  it("has dozens of screen-reader events with real utterances, and Tab traces for the keyboard", async () => {
    const [nw] = await ds.listSites();
    const { results } = await ds.analyze(nw, null);
    const buy = results.find((r) => r.taskId === "buy-m")!;
    const sr = buildLane(buy.personas.screenreader);
    expect(sr.events.length).toBeGreaterThan(40);
    const spoken = sr.events.map((e) => e.utterance?.text).filter(Boolean);
    expect(spoken).toContain("navigation landmark, list with 10 items, link, Men");
    expect(spoken).toContain("clickable, M");
    expect(spoken).toContain("button, Add to cart");
    expect(spoken.some((t) => t === "list with 6 items, link, Jackets" || t === "link, Jackets")).toBe(true);
    const kb = buildLane(buy.personas.keyboard);
    expect(kb.events.filter((e) => e.command === "tab").length).toBeGreaterThan(30);
    expect(kb.blocked).toBeTruthy();
  });

  it("plans three fixes that unblock the keyboard and cut screen-reader time", async () => {
    const [nw] = await ds.listSites();
    const analysis = await ds.analyze(nw, null);
    const out = await ds.plan(nw, analysis, 3);
    expect(out.plan.chosen).toHaveLength(3);
    expect(out.plan.chosen.map((f) => f.kind)).toEqual(["real-button", "add-label", "skip-link"]);
    expect(out.plan.method).toBe("greedy+exhaustive");
    expect(out.plan.optimalityGap).toBe(0);
    expect(out.plan.plannedObjective).toBeLessThan(out.plan.baselineObjective);
    const buyAfter = out.results.find((r) => r.taskId === "buy-m")!;
    expect(buyAfter.personas.keyboard.blocked).toBeUndefined();
    expect(buyAfter.personas.keyboard.seconds).toBeLessThan(8);
    expect(buyAfter.personas.screenreader.seconds).toBeLessThan(15);
    const [d] = compareTask(analysis.results.find((r) => r.taskId === "buy-m")!, buyAfter).filter((x) => x.persona === "keyboard");
    expect(d.change).toBe("unblocked");
  });

  it("derives per-fix impact from the cumulative gains", async () => {
    const [nw] = await ds.listSites();
    const analysis = await ds.analyze(nw, null);
    const { plan } = await ds.plan(nw, analysis, 3);
    const impacts = fixImpacts(plan, analysis.results);
    expect(impacts).toHaveLength(3);
    expect(impacts[0].unblocked).toContainEqual({ taskId: "buy-m", persona: "keyboard" });
    expect(impacts[1].unblocked).toContainEqual({ taskId: "open-cart", persona: "screenreader" });
    expect(impacts[2].secondsByPersona.screenreader).toBeGreaterThan(30);
    expect(describeImpact(impacts[0]).unblocks).toEqual(["unblocks keyboard"]);
  });

  it("clamps k to the fixes that exist, and plans nothing for the control page", async () => {
    const sites = await ds.listSites();
    const alpine = sites.find((s) => s.id === "alpine")!;
    const analysis = await ds.analyze(alpine, null);
    const out = await ds.plan(alpine, analysis, 5);
    expect(out.plan.chosen).toEqual([]);
    expect(out.results).toBe(analysis.results);
    const riverside = sites.find((s) => s.id === "riverside")!;
    const a2 = await ds.analyze(riverside, null);
    expect((await ds.plan(riverside, a2, 5)).plan.chosen.length).toBe(3);
  });
});
