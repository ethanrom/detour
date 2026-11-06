// Parameter set used by every cost model, plus nominal values and Monte Carlo sampling.
// All numbers come from LITERATURE (lib/params/literature.ts); nothing is hard-coded here.

import { LITERATURE, type Range } from "@/lib/params/literature";

/** One concrete draw of every human-performance parameter. */
export interface Params {
  /** KLM keystroke (s). */
  K: number;
  /** KLM mouse button press or release (s). */
  B: number;
  /** KLM mental preparation (s). */
  M: number;
  /** KLM homing between keyboard and mouse (s). */
  H: number;
  /** KLM pointing without layout (s). */
  P: number;
  /** Sighted silent reading speed (words/min). */
  readingWpm: number;
  /** Fitts intercept (s). */
  fittsA: number;
  /** Fitts slope (s/bit). */
  fittsB: number;
  /** Screen-reader speech rate (words/min). */
  speechWpm: number;
  /** Fraction of a non-target announcement that is heard before moving on. */
  listenFraction: number;
  /** Seconds per typed character. */
  charSeconds: number;
  /** Seconds per viewport scrolled. */
  secondsPerViewport: number;
  /** Multiplier on K for the keyboard-only persona. */
  keyboardMotorFactor: number;
}

export type ParamKey = keyof Params;

/** Pseudo-random generator returning floats in [0, 1). */
export type Rng = () => number;

/** The parameter -> Range mapping. Read lazily so edits to LITERATURE are always honoured. */
function ranges(): Array<[ParamKey, Range]> {
  return [
    ["K", LITERATURE.klm.K],
    ["B", LITERATURE.klm.B],
    ["M", LITERATURE.klm.M],
    ["H", LITERATURE.klm.H],
    ["P", LITERATURE.klm.P],
    ["readingWpm", LITERATURE.reading.wpm],
    ["fittsA", LITERATURE.fitts.mouse.a],
    ["fittsB", LITERATURE.fitts.mouse.b],
    ["speechWpm", LITERATURE.speech.wpm],
    ["listenFraction", LITERATURE.speech.listenFraction],
    ["charSeconds", LITERATURE.typing.charSeconds],
    ["secondsPerViewport", LITERATURE.scroll.secondsPerViewport],
    ["keyboardMotorFactor", LITERATURE.keyboardMotorFactor],
  ];
}

/** Point-estimate parameters: every Range.value. */
export function nominalParams(): Params {
  const p = {} as Params;
  for (const [k, r] of ranges()) p[k] = r.value;
  return p;
}

/** mulberry32: tiny seeded PRNG, uniform on [0, 1). */
export function mulberry32(seed = 1): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a over the seed and some labels; gives independent, order-free sub-streams. */
export function deriveSeed(seed: number, ...labels: string[]): number {
  let h = 2166136261 ^ (seed >>> 0);
  for (const label of labels) {
    for (let i = 0; i < label.length; i++) {
      h ^= label.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0xff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function uniform(rng: Rng, low: number, high: number): number {
  return low + (high - low) * rng();
}

/** Triangular(low, mode, high) by inverse CDF. */
export function triangular(rng: Rng, low: number, mode: number, high: number): number {
  if (!(high > low)) return mode;
  const m = Math.min(Math.max(mode, low), high);
  const u = rng();
  const span = high - low;
  const f = (m - low) / span;
  const x = u < f ? low + Math.sqrt(u * span * (m - low)) : high - Math.sqrt((1 - u) * span * (high - m));
  return Math.min(Math.max(x, low), high); // guard against rounding at the edges
}

/** Standard normal by Box-Muller (always consumes exactly two uniforms, for reproducibility). */
export function standardNormal(rng: Rng): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normal sigma for a Range whose low/high are ~p05/p95: max(ln(v/low), ln(high/v)) / 1.645. */
export function lognormalSigma(value: number, low: number, high: number): number {
  if (!(value > 0) || !(low > 0) || !(high > 0)) return 0;
  const s = Math.max(Math.log(value / low), Math.log(high / value)) / 1.645;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** Log-normal with the given median and sigma (of the underlying normal). */
export function lognormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(sigma * standardNormal(rng));
}

/** Draw one value from a Range according to its declared distribution. */
export function sampleRange(r: Range, rng: Rng): number {
  switch (r.dist) {
    case "uniform":
      return uniform(rng, r.low, r.high);
    case "triangular":
      return triangular(rng, r.low, r.value, r.high);
    case "lognormal":
      return lognormal(rng, r.value, lognormalSigma(r.value, r.low, r.high));
  }
}

/** One Monte Carlo draw of every parameter (fixed draw order, so a seed is reproducible). */
export function sampleParams(rng: Rng): Params {
  const p = {} as Params;
  for (const [k, r] of ranges()) p[k] = sampleRange(r, rng);
  return p;
}
