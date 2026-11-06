// Information scent scorers. Scent s in [0,1] says how strongly a heading's text suggests that the
// task's target is in that heading's section (Pirolli & Card 1999, "Information foraging").
//
// Two scorers feed the same interface:
//   - lexicalScorer (./lexical): deterministic token overlap with a small synonym map. Always available.
//   - an LLM scorer (LlmScentFn), wired by the integrator over Bedrock: one fast-model call that scores
//     every heading at once with forced tool use. Its output is validated and blended with the lexical
//     score; if the call fails or returns garbage we fall back to lexical alone.

import { lexicalScorer } from "./lexical";

/** Scores each label's scent for the task. Must return one number per label, each in [0,1]. */
export type ScentScorer = (taskText: string, labels: string[]) => Promise<number[]> | number[];

/** A scorer that never returns a Promise (lexical, fixed vectors). Usable on the synchronous path. */
export type SyncScentScorer = (taskText: string, labels: string[]) => number[];

/** The LLM scorer the integrator provides. Batch-scores all heading labels in one call.
 *  Contract: resolve to exactly `labels.length` numbers in [0,1]; reject (or resolve to garbage, which
 *  `validateScores` rejects) on failure. Never produces seconds: it only grounds scent. */
export type LlmScentFn = (taskText: string, labels: string[]) => Promise<number[]>;

export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Returns the scores if they are a well-formed vector of length n (finite numbers in [0,1],
 *  tolerating tiny float excursions), else null. Use before trusting any LLM output. */
export function validateScores(raw: unknown, n: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) return null;
    out.push(clamp01(v));
  }
  return out;
}

/** Blend: w * llm + (1 - w) * lexical, clipped to [0,1]. With no usable LLM vector, returns the
 *  lexical scores unchanged. Default w = 0.7 (the LLM is better at paraphrase, lexical anchors it). */
export function combineScores(lexical: number[], llm: number[] | null | undefined, w = 0.7): number[] {
  if (!llm || llm.length !== lexical.length) return lexical.map(clamp01);
  const wl = clamp01(w);
  return lexical.map((lx, i) => clamp01(wl * llm[i] + (1 - wl) * lx));
}

/** Lexical + LLM scorer with graceful fallback. Any LLM error or malformed output yields lexical only. */
export function hybridScorer(llm: LlmScentFn, w = 0.7): ScentScorer {
  return async (taskText, labels) => {
    const lex = lexicalScorer(taskText, labels);
    try {
      const raw = await llm(taskText, labels);
      return combineScores(lex, validateScores(raw, labels.length), w);
    } catch {
      return lex;
    }
  };
}
