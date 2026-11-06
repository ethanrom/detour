import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LITERATURE, type Range } from "@/lib/params/literature";
import { deriveSeed, lognormal, lognormalSigma, mulberry32, nominalParams, sampleParams, sampleRange, standardNormal, triangular, uniform } from "./index";
import { quantile } from "./montecarlo";

describe("mulberry32", () => {
  it("is deterministic per seed and uniform on [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("defaults to seed 1 and differs across seeds", () => {
    expect(mulberry32()()).toBe(mulberry32(1)());
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("deriveSeed is stable and separates labels", () => {
    expect(deriveSeed(1, "buy-m", "mouse")).toBe(deriveSeed(1, "buy-m", "mouse"));
    expect(deriveSeed(1, "buy-m", "mouse")).not.toBe(deriveSeed(1, "buy-m", "keyboard"));
    expect(deriveSeed(1, "ab", "c")).not.toBe(deriveSeed(1, "a", "bc"));
    expect(deriveSeed(1, "x")).not.toBe(deriveSeed(2, "x"));
  });
});

describe("nominalParams", () => {
  it("is every Range.value of the literature", () => {
    const p = nominalParams();
    expect(p).toEqual({
      K: LITERATURE.klm.K.value,
      B: LITERATURE.klm.B.value,
      M: LITERATURE.klm.M.value,
      H: LITERATURE.klm.H.value,
      P: LITERATURE.klm.P.value,
      readingWpm: LITERATURE.reading.wpm.value,
      fittsA: LITERATURE.fitts.mouse.a.value,
      fittsB: LITERATURE.fitts.mouse.b.value,
      speechWpm: LITERATURE.speech.wpm.value,
      listenFraction: LITERATURE.speech.listenFraction.value,
      charSeconds: LITERATURE.typing.charSeconds.value,
      secondsPerViewport: LITERATURE.scroll.secondsPerViewport.value,
      keyboardMotorFactor: LITERATURE.keyboardMotorFactor.value,
    });
  });
});

describe("distributions", () => {
  it("triangular stays within bounds and has the right mean", () => {
    fc.assert(
      fc.property(fc.integer(), fc.double({ min: 0, max: 10, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (seed, low, a, b) => {
        const mode = low + a;
        const high = mode + b;
        const rng = mulberry32(seed);
        for (let i = 0; i < 50; i++) {
          const x = triangular(rng, low, mode, high);
          expect(x).toBeGreaterThanOrEqual(low);
          expect(x).toBeLessThanOrEqual(high);
        }
      }),
    );
    const rng = mulberry32(3);
    const xs = Array.from({ length: 20000 }, () => triangular(rng, 1, 2, 6));
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo((1 + 2 + 6) / 3, 1);
  });

  it("triangular with low === high returns the mode", () => {
    expect(triangular(mulberry32(1), 2, 2, 2)).toBe(2);
  });

  it("uniform stays within bounds", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const x = uniform(rng, 0.1, 0.25);
      expect(x).toBeGreaterThanOrEqual(0.1);
      expect(x).toBeLessThan(0.25);
    }
  });

  it("standard normal has mean ~0 and sd ~1", () => {
    const rng = mulberry32(11);
    const xs = Array.from({ length: 20000 }, () => standardNormal(rng));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(sd).toBeGreaterThan(0.97);
    expect(sd).toBeLessThan(1.03);
  });

  it("lognormal sigma is max(ln(v/low), ln(high/v)) / 1.645", () => {
    expect(lognormalSigma(300, 180, 450)).toBeCloseTo(Math.max(Math.log(300 / 180), Math.log(450 / 300)) / 1.645, 12);
    expect(lognormalSigma(0, 1, 2)).toBe(0);
    expect(lognormalSigma(2, 2, 2)).toBe(0);
  });

  it("lognormal has median = value and ~p05/p95 at low/high for a symmetric-in-log range", () => {
    const r: Range = { value: 300, low: 150, high: 600, dist: "lognormal", unit: "x", source: "test" };
    const rng = mulberry32(21);
    const sorted = Float64Array.from({ length: 40000 }, () => sampleRange(r, rng)).sort();
    expect(quantile(sorted, 0.5) / 300).toBeGreaterThan(0.97);
    expect(quantile(sorted, 0.5) / 300).toBeLessThan(1.03);
    expect(quantile(sorted, 0.05) / 150).toBeGreaterThan(0.95);
    expect(quantile(sorted, 0.05) / 150).toBeLessThan(1.05);
    expect(quantile(sorted, 0.95) / 600).toBeGreaterThan(0.95);
    expect(quantile(sorted, 0.95) / 600).toBeLessThan(1.05);
    expect(lognormal(mulberry32(1), 10, 0)).toBe(10);
  });

  it("sampleParams respects every literature range for bounded distributions", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 300; i++) {
      const p = sampleParams(rng);
      expect(p.K).toBeGreaterThanOrEqual(LITERATURE.klm.K.low);
      expect(p.K).toBeLessThanOrEqual(LITERATURE.klm.K.high);
      expect(p.fittsB).toBeGreaterThanOrEqual(LITERATURE.fitts.mouse.b.low);
      expect(p.fittsB).toBeLessThanOrEqual(LITERATURE.fitts.mouse.b.high);
      expect(p.listenFraction).toBeGreaterThanOrEqual(LITERATURE.speech.listenFraction.low);
      expect(p.listenFraction).toBeLessThanOrEqual(LITERATURE.speech.listenFraction.high);
      expect(p.keyboardMotorFactor).toBeGreaterThanOrEqual(LITERATURE.keyboardMotorFactor.low);
      expect(p.keyboardMotorFactor).toBeLessThanOrEqual(LITERATURE.keyboardMotorFactor.high);
      expect(p.speechWpm).toBeGreaterThan(0);
    }
  });

  it("sampleParams is reproducible per seed", () => {
    expect(sampleParams(mulberry32(4))).toEqual(sampleParams(mulberry32(4)));
    expect(sampleParams(mulberry32(4))).not.toEqual(sampleParams(mulberry32(5)));
  });
});
