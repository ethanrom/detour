import { describe, expect, it } from "vitest";
import { fmtNum, fmtOptimality, fmtPercentLess, fmtRange, fmtResultLine, fmtResultSpoken, fmtSeconds, fmtSigned, percentLess } from "./format";

describe("fmtNum / fmtSeconds", () => {
  it("uses one decimal below 10 s and whole seconds above", () => {
    expect(fmtNum(4.26)).toBe("4.3");
    expect(fmtNum(6)).toBe("6");
    expect(fmtNum(9.96)).toBe("10");
    expect(fmtNum(51.6)).toBe("52");
    expect(fmtSeconds(52.2)).toBe("52 s");
    expect(fmtSeconds(0.04)).toBe("0 s");
  });
  it("never prints NaN", () => {
    expect(fmtNum(Number.NaN)).toBe("–");
  });
});

describe("fmtResultLine", () => {
  it('formats "52 s, 90% interval 38–71 s"', () => {
    expect(fmtResultLine(52, [38, 71])).toBe("52 s, 90% interval 38–71 s");
  });
  it("keeps decimals for fast tasks", () => {
    expect(fmtResultLine(4.3, [3.4, 5.6])).toBe("4.3 s, 90% interval 3.4–5.6 s");
  });
  it("has a spoken form", () => {
    expect(fmtResultSpoken(52, [38, 71])).toBe("52 seconds, 90 percent interval 38 to 71 seconds");
    expect(fmtResultSpoken(1, [1, 2])).toBe("1 second, 90 percent interval 1 to 2 seconds");
  });
  it("uses an en dash in ranges", () => {
    expect(fmtRange([38, 71])).toContain("–");
  });
});

describe("percentages and deltas", () => {
  it('reports "83% less" for 52 -> 9', () => {
    expect(percentLess(52, 9)).toBe(83);
    expect(fmtPercentLess(52, 9)).toBe("83% less");
  });
  it("handles increases, no change and zero baselines", () => {
    expect(fmtPercentLess(10, 12)).toBe("20% more");
    expect(fmtPercentLess(10, 10)).toBe("no change");
    expect(percentLess(0, 5)).toBe(0);
  });
  it("signs deltas with a true minus", () => {
    expect(fmtSigned(-15.3)).toBe("−15 s");
    expect(fmtSigned(2.5)).toBe("+2.5 s");
    expect(fmtSigned(0)).toBe("0 s");
  });
});

describe("fmtOptimality", () => {
  it("certifies a zero gap and names the pool it covered", () => {
    expect(fmtOptimality(0, 11, 18, 3)).toBe("Certified optimal among all sets of up to 3 fixes of the 11 most promising candidates (gap 0.0 s)");
    expect(fmtOptimality(0, 10, 10, 1)).toBe("Certified optimal among all sets of up to 1 fix of all 10 candidates (gap 0.0 s)");
  });
  it("reports a non-zero gap honestly and stays silent when the check did not run", () => {
    expect(fmtOptimality(1.234, 11, 18, 3)).toContain("1.2 s");
    expect(fmtOptimality(undefined)).toBeNull();
  });
});
