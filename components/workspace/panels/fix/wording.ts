import type { FixOutcome, WordingEdit } from "@/lib/livefix/types";

/** The edit's title: the run's own when it has one, else a plain description. Used by the row, the button names and the drawer. */
export function wordingTitle(w: WordingEdit, outcome?: FixOutcome): string {
  if (outcome?.title) return outcome.title;
  return w.kind === "heading" ? `Rename the heading “${w.original}” to “${w.text}”` : `Label the control “${w.text}”`;
}

/** Why the edit is worth making, in the words the old fix card used. */
export function wordingWhy(w: WordingEdit): string {
  return w.kind === "heading"
    ? `The scent model checked that “${w.text}” helps a screen-reader user find this section faster than “${w.original}”.`
    : `This control has no accessible name. “${w.text}” is the name proposed for it and checked against the page.`;
}

/** "1 heading rename, 15 labels". */
export function wordingKinds(edits: readonly WordingEdit[]): string {
  const headings = edits.filter((e) => e.kind === "heading").length;
  const labels = edits.length - headings;
  const parts: string[] = [];
  if (headings > 0) parts.push(`${headings} heading rename${headings === 1 ? "" : "s"}`);
  if (labels > 0) parts.push(`${labels} label${labels === 1 ? "" : "s"}`);
  return parts.join(", ");
}
