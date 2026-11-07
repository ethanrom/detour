// The contract between the Analyze workspace shell (state, step rail, tasks, page) and its four step panels plus
// the change drawer. Frozen for the parallel builders: change only via the lead. Spec: internal/ui-v2-spec.md §3.
//
// Panels are presentational. The shell owns all state and every primary action (they live in the step rail),
// so a panel never renders "Plan fixes", "Fix this page" or "See the re-check". The one exception is the Fix
// panel's secondary "Fix again" (onFixAgain).

import type { RefObject } from "react";
import type { FixSpec, PageModel, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import type { ExportMeta } from "@/lib/livefix/export";
import type { FixOutcome, WordingEdit } from "@/lib/livefix/types";
import type { RepairReport } from "@/lib/repair/types";
import type { PlanOutcome } from "@/lib/ui/datasource";
import type { FixRunState } from "@/lib/ui/fix-run";
import type { RenameStory } from "@/lib/ui/rename-story";
import type { Lane } from "@/lib/ui/timeline";

export type StepId = "race" | "plan" | "fix" | "recheck";
export type PlanStatus = "idle" | "loading" | "ready" | "error";
export type RepairStatus = "loading" | "ready" | "unavailable";

/** Heading and label suggestions from /api/repair, verified by the scent model. */
export interface RepairView {
  status: RepairStatus;
  report?: RepairReport | null;
  /** Per-task numbers for each accepted rename (lib/ui/rename-story). */
  story: RenameStory[] | null;
}

interface PanelBase {
  /** The panel's h2 (tabIndex -1): the shell moves focus here when the step changes. */
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export interface RacePanelProps extends PanelBase {
  /** The task being raced; null before any run. */
  task: Task | null;
  /** Its result; null before a run or while reading the page. */
  result: TaskResult | null;
  /** Built with lib/ui/timeline buildLane in PERSONA_ORDER; null when there is no result. */
  lanes: Lane[] | null;
  /** The page is being read or the task is being evaluated. */
  loading: boolean;
  /** Changes on every run: restart the race clock. */
  runKey: number;
  /** The page is a typed public address (site.kind === "url"). */
  isUrl: boolean;
  /** False when the Wording panel already tells the heading story for this task (lib/ui/rename-story). */
  hideInsight: (taskId: string, search: SearchEstimate) => boolean;
}

export interface PlanPanelProps extends PanelBase {
  status: PlanStatus;
  outcome?: PlanOutcome;
  error?: string;
  /** Results before any fix (for predicted gains, lib/ui/compare fixImpacts). */
  baseline: TaskResult[];
  /** Number of fixes (1 to 5). Changing it resets the plan; the shell then offers "Plan fixes" again. */
  k: number;
  onK: (k: number) => void;
  repair: RepairView | null;
  page: PageModel | null;
  /** The task shown in the race: the headline numbers of any rename are about it. */
  task: Task | null;
}

export interface FixPanelProps extends PanelBase {
  /** The data source can fix this page (live page, not sample data). When false, show one quiet sentence. */
  available: boolean;
  outcome?: PlanOutcome;
  /** The current run (null before the first one). Use lib/ui/fix-run helpers: summarize, STAGE_WORD, SOURCE_NOTE,
   *  personaChips, previousChecks, elapsedText, layoutSentence, wordingSentence. */
  run: FixRunState | null;
  /** The page as read before any fix (readable selectors). */
  page: PageModel | null;
  tasks: Task[];
  /** For Download patch (lib/livefix/export patchText) and Copy report (reportMarkdown). */
  meta: ExportMeta;
  /** Secondary "Fix again" in the panel header, shown only after a run has finished. */
  onFixAgain: () => void;
  /** Open the change drawer for one plan fix or one wording edit (by fix id). */
  onView: (fixId: string) => void;
}

export interface RecheckPanelProps extends PanelBase {
  tasks: Task[];
  before: TaskResult[];
  /** Re-checked results on the fixed page (the run's report); null before a run has finished. */
  after: TaskResult[] | null;
  /** The plan's predicted results. */
  predicted: TaskResult[] | null;
  taskId: string;
  onTask: (taskId: string) => void;
  /** Changes when a run finishes: restart the after race. */
  runKey: number;
  hideInsight: (taskId: string, search: SearchEstimate) => boolean;
}

export interface ChangeDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The plan fix being shown (absent for a wording edit). */
  fix?: FixSpec;
  /** The wording edit being shown (absent for a plan fix). */
  wording?: WordingEdit;
  /** Its outcome: edits, originals, applied, checks, reason. */
  outcome?: FixOutcome;
  page: PageModel | null;
}
