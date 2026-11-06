// Information-foraging model of screen-reader heading navigation. See ./model.ts for the maths.
//
//   const labels = headingLabels(page);                       // what the scorer sees
//   const scores = lexicalScorer(stepGoalText(task, i), labels);   // or await an LLM-backed scorer
//   const r = searchHeadings(page, task, i, scores, opts);    // r.seconds = expected search time

import type { PageModel, Task } from "@/lib/contracts";
import {
  analyze,
  prepareStep,
  type ScentOptions,
  type ScentResult,
  type StepSetup,
} from "./model";
import { clamp01, type ScentScorer, type SyncScentScorer } from "./scorer";

export { lexicalScorer, tokenize, stem, overlapScore, matchWeight } from "./lexical";
export {
  clamp01,
  combineScores,
  hybridScorer,
  validateScores,
  type LlmScentFn,
  type ScentScorer,
  type SyncScentScorer,
} from "./scorer";
export {
  DEFAULT_FORAGING,
  enterProbability,
  giveUpStops,
  headingLabels,
  prepareStep,
  resolveScentOptions,
  stepGoalText,
  type HeadingBreakdown,
  type ResolvedScentOptions,
  type ScentOptions,
  type ScentResult,
  type StepMode,
  type StepSetup,
} from "./model";
export { fundamentalMatrix, invert, solve } from "./solver";
export { simulateSearch, type SimulationResult } from "./simulate";

function normaliseScores(raw: number[], n: number): number[] {
  if (!Array.isArray(raw) || raw.length !== n) {
    throw new RangeError(`searchHeadings: expected ${n} scent scores (one per heading, see headingLabels), got ${Array.isArray(raw) ? raw.length : typeof raw}`);
  }
  return raw.map(clamp01);
}

function run(setup: StepSetup, scores: number[]): ScentResult {
  // Only "search" steps use the scores; local and linear steps never consult them.
  return analyze(setup, setup.mode === "search" ? normaliseScores(scores, setup.headings.length) : setup.headings.map(() => 0));
}

/**
 * Expected time (and the foraging breakdown) for one task step on the headings strategy.
 *
 * `scorer` is either a vector of scent scores aligned with `headingLabels(page)`, or a synchronous scorer
 * (e.g. `lexicalScorer`). The scorer is only consulted when the step actually needs a heading search; for
 * an async/LLM scorer, resolve it first and pass the vector, or use `searchHeadingsAsync`.
 *
 * Start state: step 0 starts at the top of the page (after the title); step i > 0 starts at the previous
 * step's target. Models the search only, not the activation.
 */
export function searchHeadings(
  page: PageModel,
  task: Task,
  stepIndex: number,
  scorer: number[] | SyncScentScorer,
  opts: ScentOptions = {},
): ScentResult {
  const setup = prepareStep(page, task, stepIndex, opts);
  let scores: number[];
  if (typeof scorer === "function") {
    if (setup.mode !== "search") scores = setup.headings.map(() => 0);
    else {
      const out: unknown = scorer(setup.taskText, setup.headings.map((h) => h.label));
      if (out instanceof Promise) throw new TypeError("searchHeadings: scorer returned a Promise; resolve it first or use searchHeadingsAsync");
      scores = out as number[];
    }
  } else {
    scores = scorer;
  }
  return run(setup, scores);
}

/** Same as `searchHeadings`, but accepts an async scorer (for example the Bedrock-backed one). */
export async function searchHeadingsAsync(
  page: PageModel,
  task: Task,
  stepIndex: number,
  scorer: number[] | ScentScorer,
  opts: ScentOptions = {},
): Promise<ScentResult> {
  const setup = prepareStep(page, task, stepIndex, opts);
  let scores: number[];
  if (typeof scorer === "function") {
    scores = setup.mode !== "search" ? setup.headings.map(() => 0) : await scorer(setup.taskText, setup.headings.map((h) => h.label));
  } else {
    scores = scorer;
  }
  return run(setup, scores);
}

/** Sum of `searchHeadings` over every step of a task (steps >= 1 start at the previous target). */
export function searchTask(
  page: PageModel,
  task: Task,
  scorer: SyncScentScorer,
  opts: ScentOptions = {},
): { seconds: number; steps: ScentResult[] } {
  const steps = task.steps.map((_, i) => searchHeadings(page, task, i, scorer, opts));
  return { seconds: steps.reduce((a, s) => a + s.seconds, 0), steps };
}
