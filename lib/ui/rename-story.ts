// The Wording panel's per-task numbers. /api/repair verifies a rename over all tasks together; the panel
// also wants "this task: realistic search 159 s -> 40 s (best case 16 s)". This recomputes the same
// verification on the client, task by task, with the scent model: same promoted page, same order (a rename is
// judged with the renames accepted before it already applied), plus the best case from the same chain.

import type { NodeId, PageModel, SearchEstimate, Task } from "@/lib/contracts";
import { applyFixes, generateCandidates } from "@/lib/fixes";
import { compareRename, lexicalScorer, withHeadingText } from "@/lib/scent";
import type { RepairReport } from "@/lib/repair/types";
import { normalizeTasks } from "./pipeline";

export interface RenameTaskLine {
  taskId: string;
  /** Realistic heading-search seconds with the original wording. */
  before: number;
  /** ... with the proposed wording. */
  after: number;
  /** Seconds for a listener who already knows where to go (shortest path). */
  best: number;
}

export interface RenameStory {
  nodeId: NodeId;
  lines: RenameTaskLine[];
}

/** A rename counts as changing a task only when it moves the realistic time by more than this. */
export const STORY_MIN_SECONDS = 0.5;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** One entry per accepted heading rename, in report order. Empty when nothing was accepted. */
export function buildRenameStory(page: PageModel, tasks: Task[], report: RepairReport): RenameStory[] {
  const accepted = report.headings.filter((h) => h.accepted);
  if (accepted.length === 0) return [];
  const t = normalizeTasks(page, tasks);
  let current = page;
  if (report.promoted) {
    const promote = generateCandidates(page, t).filter((f) => f.kind === "promote-heading");
    if (promote.length) current = applyFixes(page, promote);
  }
  const out: RenameStory[] = [];
  for (const h of accepted) {
    if (current.nodes[h.nodeId]?.role !== "heading") continue;
    const text = collapse(h.proposed);
    const lines: RenameTaskLine[] = [];
    for (const task of t) {
      try {
        const c = compareRename(current, task, h.nodeId, text, lexicalScorer);
        lines.push({ taskId: task.id, before: c.before, after: c.after, best: c.afterResult.steps.reduce((a, s) => a + s.shortestSeconds, 0) });
      } catch {
        // A step's target is not a reading stop on this page: that task cannot be evaluated here.
      }
    }
    out.push({ nodeId: h.nodeId, lines });
    current = withHeadingText(current, h.nodeId, text);
  }
  return out;
}

export function renameChanges(line: RenameTaskLine | undefined): boolean {
  return !!line && line.before - line.after > STORY_MIN_SECONDS;
}

/**
 * Should the separate "realistic search" panel stay hidden for this task? It is hidden while suggestions
 * are still loading (so it cannot flash and then contradict them), when an accepted rename already tells
 * this task's story, or when the heading it would call "the answer" is not one a rename targets.
 */
export function hideSearchInsight(opts: { loading: boolean; story: RenameStory[] | null; taskId: string; search: SearchEstimate }): boolean {
  if (opts.loading) return true;
  const story = opts.story ?? [];
  if (story.length === 0) return false;
  if (story.some((s) => renameChanges(s.lines.find((l) => l.taskId === opts.taskId)))) return true;
  const answer = opts.search.perHeading.find((h) => h.containsTarget)?.nodeId;
  return !answer || !story.some((s) => s.nodeId === answer);
}
