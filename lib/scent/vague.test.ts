// The story the UI tells: a shortest-path model cannot see a vague heading; a foraging user pays for it.

import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { civicPage, civicTask, promoteHeadings, renameHeading } from "./demo-pages";
import { headingLabels, lexicalScorer, searchHeadings, simulateSearch, stepGoalText } from "./index";

const civic = (heading: string) => searchHeadings(civicPage(heading), civicTask, 0, lexicalScorer);

describe("civic page: the answer sits under a vague heading", () => {
  const clear = civic("Income limits");
  const eligibility = civic("Eligibility");
  const detailsOnly = civic("Program details");
  const vague = civic("More information");

  it("scores the clear heading as the best match and the vague one as no match at all", () => {
    const scent = (r: typeof clear) => r.perHeading.find((h) => h.containsTarget)!.scent;
    expect(scent(clear)).toBeGreaterThan(0.9);
    expect(scent(eligibility)).toBeCloseTo(0.8, 12); // synonym
    expect(scent(vague)).toBeLessThan(0.05);
  });

  it("a shortest-path model charges the same for both headings", () => {
    expect(vague.shortestSeconds).toBeCloseTo(clear.shortestSeconds, 9);
  });

  it("the foraging user takes much longer with the vague heading", () => {
    expect(vague.seconds).toBeGreaterThan(2.5 * clear.seconds);
    expect(vague.seconds - clear.seconds).toBeGreaterThan(25);
    expect(vague.pFoundFirstPass).toBeLessThan(0.05);
    expect(clear.pFoundFirstPass).toBeGreaterThan(0.95);
    expect(vague.expectedHeadingsHeard).toBeGreaterThan(2 * clear.expectedHeadingsHeard);
  });

  it("a vague heading is worse than having no headings: reading linearly beats searching", () => {
    expect(vague.seconds).toBeGreaterThan(vague.linearSeconds);
    expect(clear.seconds).toBeLessThan(clear.linearSeconds);
    expect(vague.pFallbackLinear).toBeGreaterThan(0.3);
  });

  it("time rises smoothly as the heading gets vaguer: income limits ~ eligibility < program details < more information", () => {
    expect(Math.abs(eligibility.seconds - clear.seconds) / clear.seconds).toBeLessThan(0.05);
    expect(detailsOnly.seconds).toBeGreaterThan(1.5 * eligibility.seconds);
    expect(vague.seconds).toBeGreaterThan(detailsOnly.seconds);
  });

  it("holds under Monte Carlo too, and across the plausible speech range", () => {
    const page = civicPage("More information");
    const scores = lexicalScorer(stepGoalText(civicTask, 0), headingLabels(page));
    const mc = simulateSearch(page, civicTask, 0, scores, {}, { users: 20000, seed: 3 });
    expect(Math.abs(mc.meanSeconds - vague.seconds) / vague.seconds).toBeLessThan(0.02);
    for (const wpm of [180, 300, 450]) {
      const c = searchHeadings(civicPage("Income limits"), civicTask, 0, lexicalScorer, { wpm });
      const v = searchHeadings(civicPage("More information"), civicTask, 0, lexicalScorer, { wpm });
      expect(v.seconds).toBeGreaterThan(2 * c.seconds);
    }
  });

  it("the cost is explained: wrong sections and the linear fallback dominate", () => {
    const c = vague.components;
    expect(c.wrongSections + c.linearFallback).toBeGreaterThan(0.6 * vague.seconds);
    expect(c.arrowsToTarget).toBeLessThan(0.1 * vague.seconds);
  });
});

describe("mini-shop: promoting the fake headings", () => {
  const promoted = promoteHeadings(miniShop, ["size-label", "reviews-title", "returns-title"]);
  const returns = miniShopTasks[1];

  it("the as-built page has one heading, the promoted page four", () => {
    expect(miniShop.headings).toHaveLength(1);
    expect(promoted.headings).toEqual(["product-title", "size-label", "reviews-title", "returns-title"]);
    expect(promoted.nodes["returns-title"].announcement).toBe("heading, level 2, Free returns");
  });

  it("finding the return policy gets much faster for a user who forages", () => {
    const before = searchHeadings(miniShop, returns, 0, lexicalScorer);
    const after = searchHeadings(promoted, returns, 0, lexicalScorer);
    expect(before.pFoundFirstPass).toBeLessThan(0.1); // "Trail Jacket" says nothing about returns
    expect(after.pFoundFirstPass).toBeGreaterThan(0.7); // "Free returns" does
    expect(after.seconds).toBeLessThan(0.5 * before.seconds);
    expect(after.shortestSeconds).toBeLessThan(before.shortestSeconds);
  });

  it("but a promoted heading that does not describe its section stops helping", () => {
    const renamed = renameHeading(promoted, "returns-title", "More information");
    const good = searchHeadings(promoted, returns, 0, lexicalScorer);
    const bad = searchHeadings(renamed, returns, 0, lexicalScorer);
    expect(bad.seconds).toBeGreaterThan(1.5 * good.seconds);
    expect(bad.shortestSeconds).toBeCloseTo(good.shortestSeconds, 1);
  });
});
