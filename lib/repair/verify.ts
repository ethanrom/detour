// Model verification of a heading rename. The LLM proposes wording; this decides whether the new
// wording is shown, by re-running the information-scent search on the renamed page.

import type { NodeId, PageModel, Task } from "@/lib/contracts";
import { buildTree, announceNode } from "@/lib/fixes/graph";
import { lexicalScorer, searchTask } from "@/lib/scent";
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

/** A copy of the page with the node's accessible name replaced and its announcement rebuilt. */
export function renameNode(page: PageModel, nodeId: NodeId, newText: string): PageModel {
  const draft = structuredClone(page);
  const node = draft.nodes[nodeId];
  if (!node) throw new RangeError(`renameNode: unknown node ${nodeId}`);
  node.name = collapse(newText);
  node.announcement = announceNode(draft, buildTree(draft), nodeId);
  return draft;
}

/** Search seconds for one task, or null when a step's target is not a reading stop on this page. */
function searchSeconds(page: PageModel, task: Task): number | null {
  try {
    return searchTask(page, task, lexicalScorer).seconds;
  } catch {
    return null;
  }
}

/**
 * How much faster a screen-reader user finds each task's targets by heading search when the heading
 * `headingId` reads `newText`. Positive `savedSeconds` means faster. Tasks the page cannot run are skipped.
 */
export function verifyRename(page: PageModel, tasks: Task[], headingId: NodeId, newText: string): RenameVerification {
  const renamed = renameNode(page, headingId, newText);
  const perTask: TaskDelta[] = [];
  for (const task of tasks) {
    const before = searchSeconds(page, task);
    const after = searchSeconds(renamed, task);
    if (before === null || after === null) continue;
    perTask.push({ taskId: task.id, before, after, savedSeconds: before - after });
  }
  const before = perTask.reduce((a, t) => a + t.before, 0);
  const after = perTask.reduce((a, t) => a + t.after, 0);
  return { before, after, savedSeconds: before - after, perTask };
}

export const isAccepted = (v: Pick<RenameVerification, "savedSeconds">): boolean => v.savedSeconds > MIN_SAVED_SECONDS;
