import { describe, expect, it } from "vitest";
import type { PersonaResult, SearchEstimate } from "@/lib/contracts";
import { fmtProb, insightRows, insightSentence, searchInsight } from "./search-insight";

const heading = (i: number, pEnter: number, containsTarget = false) => ({
  nodeId: `h${i}`,
  label: `Heading ${i}`,
  scent: pEnter,
  pEnter,
  expectedVisits: 1,
  containsTarget,
});

const search = (over: Partial<SearchEstimate> = {}): SearchEstimate => ({
  seconds: 40,
  shortestSeconds: 10,
  pFoundFirstPass: 0.03,
  expectedWrongSections: 2.5,
  perHeading: [heading(1, 0.4), { ...heading(2, 0.03, true), label: "More information" }, heading(3, 0.2)],
  ...over,
});

const sr = (s?: SearchEstimate) => ({ search: s }) as unknown as PersonaResult;

describe("search insight", () => {
  it("shows only when searching costs more than 1.3x the best case", () => {
    expect(searchInsight(sr(search()))).toBeDefined();
    expect(searchInsight(sr(search({ seconds: 12.9 })))).toBeUndefined();
    expect(searchInsight(sr(search({ seconds: 13.1 })))).toBeDefined();
    expect(searchInsight(sr(undefined))).toBeUndefined();
  });

  it("writes the sentence from the numbers", () => {
    expect(insightSentence(search())).toBe("The answer sits under “More information”, which 97% of listeners skip on the first pass.");
    const easy = search({ perHeading: [{ ...heading(1, 0.8, true), label: "Returns" }] });
    expect(insightSentence(easy)).toBe("The answer sits under “Returns”, which 80% of listeners open on the first pass.");
    expect(insightSentence(search({ perHeading: [heading(1, 0.5)] }))).toBeNull();
  });

  it("never rounds a near-certain probability to 100%", () => {
    expect(fmtProb(0.999)).toBe("more than 99%");
    expect(fmtProb(0.001)).toBe("less than 1%");
    expect(fmtProb(1)).toBe("100%");
    expect(fmtProb(0)).toBe("0%");
  });

  it("keeps the target heading when trimming a long list", () => {
    const many = Array.from({ length: 20 }, (_, i) => heading(i, i / 40, i === 3));
    const { rows, hidden } = insightRows(search({ perHeading: many }), 6);
    expect(rows).toHaveLength(6);
    expect(hidden).toBe(14);
    expect(rows.some((r) => r.containsTarget)).toBe(true);
    expect(rows.map((r) => r.nodeId)).toEqual([...rows].sort((a, b) => Number(a.nodeId.slice(1)) - Number(b.nodeId.slice(1))).map((r) => r.nodeId));
  });
});
