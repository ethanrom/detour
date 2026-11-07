// The words of the Plan panel, as pure functions of the plan and the repair report (unit tested).
// Every number comes from the planner's objective, fixImpacts or the scent model; nothing here is written by a model.

import { BLOCKED_PENALTY_SECONDS, type FixKind, type FixPlan, type PageModel, type PersonaId, type TaskResult } from "@/lib/contracts";
import type { RepairReport } from "@/lib/repair/types";
import { describeImpact, type FixImpact } from "@/lib/ui/compare";
import { fmtSeconds, fmtSigned } from "@/lib/ui/format";
import { renameChanges, type RenameStory } from "@/lib/ui/rename-story";
import type { ChipTone } from "../../ui";

/** "3 fixes win back 587 s for keyboard and screen-reader users." The seconds are the planner's objective, rounded. */
export function planSentence(plan: Pick<FixPlan, "chosen" | "baselineObjective" | "plannedObjective">): string {
  const n = plan.chosen.length;
  const saved = Math.max(0, Math.round(plan.baselineObjective - plan.plannedObjective));
  return `${n} fix${n === 1 ? "" : "es"} ${n === 1 ? "wins" : "win"} back ${saved} s for keyboard and screen-reader users.`;
}

/** The objective charges 300 s for a person who cannot finish; say so when the baseline had one, so "win back" is not misread. */
export function penaltyNote(baseline: readonly TaskResult[]): string | null {
  const blocked = baseline.some((r) => r.personas.keyboard.blocked || r.personas.screenreader.blocked);
  return blocked ? `A task someone can’t finish counts as ${BLOCKED_PENALTY_SECONDS} s.` : null;
}

const KIND_LABEL: Record<FixKind, string> = {
  "skip-link": "Skip link",
  "promote-heading": "Heading",
  "add-landmark": "Landmark",
  "add-label": "Accessible name",
  "real-button": "Real button",
  "remove-positive-tabindex": "Focus order",
};

/** "Real button · WCAG 2.1.1, 4.1.2" (the criterion numbers only; the names are in the change drawer). */
export function fixMeta(fix: { kind: FixKind; wcag: readonly string[] }): string {
  const nums = fix.wcag.map((w) => w.split(" ")[0]).filter(Boolean);
  return nums.length > 0 ? `${KIND_LABEL[fix.kind]} · WCAG ${nums.join(", ")}` : KIND_LABEL[fix.kind];
}

export interface ImpactChip {
  tone: ChipTone;
  text: string;
  /** Spoken after the text, and shown on hover. */
  detail?: string;
}

const PERSONA_WORDS: Record<PersonaId, string> = { mouse: "mouse", keyboard: "keyboard", screenreader: "screen reader" };

/** What the plan predicts for one fix: who it unblocks, then the seconds it saves, or "under 1 s". */
export function impactChips(impact: FixImpact | undefined): ImpactChip[] {
  if (!impact) return [];
  const chips: ImpactChip[] = [];
  const seen = new Set<PersonaId>();
  for (const u of impact.unblocked) {
    if (seen.has(u.persona)) continue;
    seen.add(u.persona);
    chips.push({ tone: u.persona, text: `Unblocks ${PERSONA_WORDS[u.persona]}` });
  }
  if (impact.seconds >= 0.5) {
    const { savings } = describeImpact(impact);
    chips.push({ tone: "neutral", text: fmtSigned(-impact.seconds), detail: savings.length > 0 ? savings.join(", ") : "predicted, across tasks" });
  } else if (chips.length === 0) {
    chips.push({ tone: "neutral", text: "under 1 s", detail: "predicted, across tasks" });
  }
  return chips;
}

// ---------------------------------------------------------------------------------------------------------
// Verified wording

export interface WordingItem {
  key: string;
  from: string;
  to: string;
}

function nodeLabel(page: PageModel | null, id: string): string {
  const n = page?.nodes[id];
  if (!n) return "Unnamed control";
  const hint = n.hints.visualLabel?.trim();
  const what = n.role === "generic" ? n.tag : n.role;
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${hint ? ` that looks like “${hint}”` : ""}`;
}

/** Accepted heading renames first, then the proposed labels. A label has no old text: its control is described instead. */
export function wordingItems(report: RepairReport | null | undefined, page: PageModel | null): WordingItem[] {
  if (!report) return [];
  const headings = report.headings.filter((h) => h.accepted).map((h) => ({ key: `h:${h.nodeId}`, from: `“${h.original}”`, to: `“${h.proposed}”` }));
  const labels = report.labels.map((l) => ({ key: `l:${l.nodeId}`, from: nodeLabel(page, l.nodeId), to: `“${l.proposed}”` }));
  return [...headings, ...labels];
}

/** "1 heading rename, 15 labels". Empty when there is nothing to apply. */
export function wordingCounts(report: RepairReport | null | undefined): string {
  if (!report) return "";
  const h = report.headings.filter((x) => x.accepted).length;
  const l = report.labels.length;
  const parts = [h > 0 && `${h} heading rename${h === 1 ? "" : "s"}`, l > 0 && `${l} label${l === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(", ");
}

/**
 * "Screen-reader search 160 s → 42 s": the realistic heading search for the task in the race, before the first
 * accepted rename and after the last one. Null when no rename moves it by more than half a second.
 */
export function searchStoryLine(story: readonly RenameStory[] | null | undefined, taskId: string | undefined): string | null {
  if (!story || !taskId) return null;
  const lines = story.flatMap((s) => s.lines.filter((l) => l.taskId === taskId));
  if (lines.length === 0) return null;
  const before = lines[0].before;
  const after = lines[lines.length - 1].after;
  if (!renameChanges({ taskId, before, after, best: 0 })) return null;
  return `Screen-reader search ${fmtSeconds(before)} → ${fmtSeconds(after)}`;
}
