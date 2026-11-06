// Model verification of a heading rename. The LLM proposes wording; this decides whether the new
// wording is shown, by re-running the information-scent search on the renamed page.

import type { NodeId, PageModel, Task } from "@/lib/contracts";
import { compareRename, lexicalScorer } from "@/lib/scent";
import { collapse } from "./text";

/** A rename is accepted only when it saves more than this many seconds across the tasks. */
export const MIN_SAVED_SECONDS = 0.5;

export interface TaskDelta {
  taskId: string;
  before: number;
  after: number;
  savedSeconds: number;
}

export interface RenameVerification {
  /** Expected search seconds over the tasks (headings strategy, lexical scent) before the rename. */
  before: number;
  after: number;
  savedSeconds: number;
  perTask: TaskDelta[];
}

/**
 * How much faster a screen-reader user finds each task's targets by heading search when the heading
 * `headingId` reads `newText`. Positive `savedSeconds` means faster. Tasks whose targets are not on the
 * page are skipped. Throws RangeError when `headingId` is not a real heading (promote it first).
 */
export function verifyRename(page: PageModel, tasks: Task[], headingId: NodeId, newText: string): RenameVerification {
  if (page.nodes[headingId]?.role !== "heading") throw new RangeError(`verifyRename: ${headingId} is not a heading`);
  const text = collapse(newText);
  const perTask: TaskDelta[] = [];
  for (const task of tasks) {
    try {
      const c = compareRename(page, task, headingId, text, lexicalScorer);
      perTask.push({ taskId: task.id, before: c.before, after: c.after, savedSeconds: c.before - c.after });
    } catch {
      // A step's target is not a reading stop on this page: this task cannot be evaluated here.
    }
  }
  const before = perTask.reduce((a, t) => a + t.before, 0);
  const after = perTask.reduce((a, t) => a + t.after, 0);
  return { before, after, savedSeconds: before - after, perTask };
}

export const isAccepted = (v: Pick<RenameVerification, "savedSeconds">): boolean => v.savedSeconds > MIN_SAVED_SECONDS;
