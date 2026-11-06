// Mapping the modelled screen-reader speech onto the browser's speechSynthesis.
// Pure helpers (no window access) so they can be unit tested; components/transcript does the speaking.

import type { Utterance } from "@/lib/contracts";
import { wordCount } from "@/lib/a11y/announce";
import { LITERATURE } from "@/lib/params/literature";

/** Web Speech API range for SpeechSynthesisUtterance.rate. */
export const SPEECH_RATE_MIN = 0.1;
export const SPEECH_RATE_MAX = 10;

/** A default synthetic voice reads about 180 words per minute at rate 1. */
export const NATIVE_WPM = 180;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** SpeechSynthesisUtterance.rate that reproduces `wpm` words per minute (about wpm / 180). */
export function speechRateFromWpm(wpm: number): number {
  if (!Number.isFinite(wpm) || wpm <= 0) return 1;
  return clamp(wpm / NATIVE_WPM, SPEECH_RATE_MIN, SPEECH_RATE_MAX);
}

export interface SpokenParts {
  /** What the user hears before moving on. */
  heard: string;
  /** What is cut off (empty when the whole utterance is heard). */
  cut: string;
  /** Fraction of the announcement that is heard, 0..1. */
  fraction: number;
}

/**
 * Split an utterance into the part the modelled user listens to and the part they skip.
 * The cut is proportional: the model says the user listened for `seconds` out of the time the full
 * announcement would take at `wpm`, so we keep that share of the words (at least one).
 */
export function splitUtterance(u: Pick<Utterance, "text" | "seconds" | "truncated">, wpm: number = LITERATURE.speech.wpm.value): SpokenParts {
  const text = u.text.trim();
  if (!u.truncated || !text) return { heard: text, cut: "", fraction: 1 };
  const tokens = text.split(/\s+/);
  const words = Math.max(1, wordCount(text));
  const fullSeconds = words / (wpm / 60);
  const fraction = clamp(fullSeconds > 0 ? u.seconds / fullSeconds : 1, 0, 1);
  if (fraction >= 0.999) return { heard: text, cut: "", fraction: 1 };
  const keep = clamp(Math.round(tokens.length * fraction), 1, tokens.length);
  if (keep >= tokens.length) return { heard: text, cut: "", fraction: 1 };
  return {
    heard: tokens.slice(0, keep).join(" "),
    cut: tokens.slice(keep).join(" "),
    fraction,
  };
}

/** The string handed to speechSynthesis for one utterance: only what the user would actually hear. */
export function textToSpeak(u: Pick<Utterance, "text" | "seconds" | "truncated">, wpm?: number): string {
  return splitUtterance(u, wpm).heard;
}
