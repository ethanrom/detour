// Which steps of the loop can be opened, which are done, and the one primary action of the current step. Pure, so the
// rules of the step rail (spec §3) are unit tested; useWorkbench maps `kind` to the real actions.

import type { PlanStatus, StepId } from "./contract";

/** One tab of the step rail. */
export interface StepInfo {
  id: StepId;
  label: string;
  /** Can be opened. Not-ready tabs are aria-disabled. */
  ready: boolean;
  /** Its work is finished: a check shows before the label. */
  done: boolean;
}

export type FixRunStatus = "running" | "done" | "error";

/** What the rail needs to know. */
export interface StepFacts {
  /** The step the user is on. */
  step: StepId;
  /** The task being shown has a result. */
  hasResult: boolean;
  plan: PlanStatus;
  /** Fixes in the plan. */
  fixes: number;
  /** The data source can fix this page (live page, not sample data). */
  canFix: boolean;
  /** The fix run, if one has started. */
  run: FixRunStatus | null;
}

export type PrimaryKind = "plan-fixes" | "plan" | "fix" | "retry" | "recheck" | "busy";

/** The one primary action of the current step. `secondary` is a quiet repeat of something already done. */
export interface PrimaryAction {
  label: string;
  kind: PrimaryKind;
  disabled?: boolean;
  secondary?: boolean;
}

export function stepStates(f: StepFacts): StepInfo[] {
  const planReady = f.plan === "ready";
  return [
    { id: "race", label: "Race", ready: true, done: f.hasResult },
    { id: "plan", label: "Plan", ready: f.hasResult, done: planReady },
    { id: "fix", label: "Fix", ready: planReady, done: f.run === "done" },
    { id: "recheck", label: "Re-check", ready: f.run === "done", done: false },
  ];
}

/** The step that shows: the chosen one, or the Race when that one cannot be opened (any more). */
export function currentStep(f: StepFacts): StepId {
  return stepStates(f).find((s) => s.id === f.step)?.ready ? f.step : "race";
}

/** Never both "Fix this page" and "Fix again": the Fix panel owns "Fix again", so the rail offers "Try again" after a failure. */
export function primaryAction(f: StepFacts): PrimaryAction | null {
  const canFixNow = f.canFix && f.fixes > 0;
  switch (currentStep(f)) {
    case "race":
      if (!f.hasResult) return null;
      return f.plan === "loading" ? { label: "Planning…", kind: "busy", disabled: true } : { label: "Plan fixes", kind: "plan-fixes" };
    case "plan":
      if (f.plan === "loading") return { label: "Planning…", kind: "busy", disabled: true };
      if (f.plan !== "ready") return { label: "Plan fixes", kind: "plan" };
      if (canFixNow && f.run === null) return { label: "Fix this page", kind: "fix" };
      return { label: "Plan again", kind: "plan", secondary: true, disabled: f.run === "running" };
    case "fix":
      if (f.run === "running") return { label: "Fixing…", kind: "busy", disabled: true };
      if (f.run === "done") return { label: "See the re-check", kind: "recheck" };
      if (f.run === "error") return { label: "Try again", kind: "retry" };
      return canFixNow ? { label: "Fix this page", kind: "fix" } : null;
    case "recheck":
      return null;
  }
}
