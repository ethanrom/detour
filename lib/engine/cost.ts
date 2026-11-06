// Every event's duration is a function of the parameter set. Instead of a number we keep the
// event's *recipe*: how many of each KLM operator it contains. Totals of these recipes let Monte
// Carlo re-cost a whole path under a new parameter draw with one dot product.

import type { Params } from "./params";

export interface CostVec {
  /** Keystrokes at K (screen-reader persona and generic keys). */
  K: number;
  /** Keystrokes at K x keyboardMotorFactor (keyboard-only persona). */
  Kf: number;
  /** Mouse button presses/releases. */
  B: number;
  /** Mental preparations. */
  M: number;
  /** Homings between keyboard and mouse. */
  H: number;
  /** Pointing operators without layout. */
  P: number;
  /** Fitts intercept count. */
  fitA: number;
  /** Fitts index of difficulty (bits). */
  fitBits: number;
  /** Typed characters. */
  chars: number;
  /** Viewports scrolled. */
  scrollVp: number;
  /** Words read silently. */
  readWords: number;
  /** Words of speech heard in full. */
  spkFull: number;
  /** Words of speech heard only up to the listen fraction. */
  spkPart: number;
}

/** A recipe that may omit zero fields. */
export type CostInput = Partial<CostVec>;

export function zeroCost(): CostVec {
  return { K: 0, Kf: 0, B: 0, M: 0, H: 0, P: 0, fitA: 0, fitBits: 0, chars: 0, scrollVp: 0, readWords: 0, spkFull: 0, spkPart: 0 };
}

export function addCost(acc: CostVec, c: CostInput): CostVec {
  acc.K += c.K ?? 0;
  acc.Kf += c.Kf ?? 0;
  acc.B += c.B ?? 0;
  acc.M += c.M ?? 0;
  acc.H += c.H ?? 0;
  acc.P += c.P ?? 0;
  acc.fitA += c.fitA ?? 0;
  acc.fitBits += c.fitBits ?? 0;
  acc.chars += c.chars ?? 0;
  acc.scrollVp += c.scrollVp ?? 0;
  acc.readWords += c.readWords ?? 0;
  acc.spkFull += c.spkFull ?? 0;
  acc.spkPart += c.spkPart ?? 0;
  return acc;
}

/** Seconds of speech in a recipe. */
export function speechSeconds(c: CostInput, p: Params): number {
  return (((c.spkFull ?? 0) + (c.spkPart ?? 0) * p.listenFraction) * 60) / p.speechWpm;
}

/** Seconds a recipe takes under a parameter set. */
export function costOf(c: CostInput, p: Params): number {
  return (
    (c.K ?? 0) * p.K +
    (c.Kf ?? 0) * p.K * p.keyboardMotorFactor +
    (c.B ?? 0) * p.B +
    (c.M ?? 0) * p.M +
    (c.H ?? 0) * p.H +
    (c.P ?? 0) * p.P +
    (c.fitA ?? 0) * p.fittsA +
    (c.fitBits ?? 0) * p.fittsB +
    (c.chars ?? 0) * p.charSeconds +
    (c.scrollVp ?? 0) * p.secondsPerViewport +
    ((c.readWords ?? 0) * 60) / p.readingWpm +
    speechSeconds(c, p)
  );
}
