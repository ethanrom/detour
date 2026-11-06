import type { NodeId, PageModel } from "./page";
import type { Evaluate, PersonaId, TaskResult } from "./result";
import type { Task } from "./task";

export type FixKind =
  | "skip-link" // add "Skip to main content" as the first focusable, targeting main content
  | "promote-heading" // expose a visually styled heading as role=heading with a level
  | "add-landmark" // wrap a region in nav/main/footer/etc.
  | "add-label" // give an unlabeled control an accessible name
  | "real-button" // turn a fake (div) control into a focusable <button>/<input>
  | "remove-positive-tabindex"; // drop tabindex>0 so focus order follows DOM order

export interface HtmlPatch {
  /** Selector of the element the patch applies to. */
  selector: string;
  /** Minimal HTML before (outer HTML, trimmed/abbreviated with "…" for long content). */
  before: string;
  /** Minimal HTML after. */
  after: string;
}

export interface FixSpec {
  /** Deterministic id, e.g. "promote-heading:reviews-title". */
  id: string;
  kind: FixKind;
  /** "Make “Customer reviews” a level-2 heading". */
  title: string;
  /** One deterministic sentence on why it helps. */
  rationale: string;
  targets: NodeId[];
  params: Record<string, string | number | boolean>;
  patch: HtmlPatch;
  /** WCAG 2.2 success criteria, e.g. ["2.4.1 Bypass Blocks"]. */
  wcag: string[];
}

export interface FixGain {
  fixId: string;
  /** Marginal objective reduction when this fix was added (seconds). */
  secondsSaved: number;
  /** Persona seconds per task after adding this fix (cumulative). */
  after: Record<string, Partial<Record<PersonaId, number>>>;
}

/** Seconds to minimise for a set of results. Default: sum over tasks of keyboard + screenreader
 *  mixture seconds, with BLOCKED_PENALTY_SECONDS for blocked personas. */
export type Objective = (results: TaskResult[]) => number;

export interface PlanOptions {
  /** Max fixes to choose (default 3). */
  k?: number;
  objective?: Objective;
  /** Run exhaustive search to certify the greedy plan when k <= this (default 3). */
  exhaustiveMaxK?: number;
}

export interface FixPlan {
  candidates: FixSpec[];
  /** Chosen fixes in pick order. */
  chosen: FixSpec[];
  gains: FixGain[];
  baselineObjective: number;
  plannedObjective: number;
  k: number;
  method: "greedy" | "greedy+exhaustive";
  /** Best objective found by exhaustive search over all subsets of size <= k (when run). */
  exhaustiveObjective?: number;
  /** plannedObjective - exhaustiveObjective (0 means greedy was optimal). */
  optimalityGap?: number;
  /** Number of evaluate() calls made. */
  evaluations: number;
}

export type ApplyFix = (page: PageModel, fix: FixSpec) => PageModel;
export type PlanFixes = (page: PageModel, tasks: Task[], evaluate: Evaluate, opts?: PlanOptions) => FixPlan;
