// Pure helpers for the "realistic search" panel: when to show it, which headings to list and the one
// deterministic sentence. Kept out of the component so they are unit tested.

import type { PersonaResult, SearchEstimate } from "@/lib/contracts";

/** The panel only appears when searching by headings costs clearly more than knowing where to go. */
export const SEARCH_MIN_RATIO = 1.3;

export function searchInsight(sr: PersonaResult | undefined): SearchEstimate | undefined {
  const s = sr?.search;
  if (!s || !(s.shortestSeconds > 0)) return undefined;
  return s.seconds > s.shortestSeconds * SEARCH_MIN_RATIO ? s : undefined;
}

/** "97%", but never a misleading "100%" or "0%" for a probability that is not exactly 1 or 0. */
export function fmtProb(p: number): string {
  const x = Math.min(1, Math.max(0, p));
  if (x >= 0.995 && x < 1) return "more than 99%";
  if (x > 0 && x < 0.005) return "less than 1%";
  return `${Math.round(x * 100)}%`;
}

export interface InsightRow {
  nodeId: string;
  label: string;
  scent: number;
  pEnter: number;
  containsTarget: boolean;
}

/** At most `max` headings in document order: the one holding the answer, then the strongest scents. */
export function insightRows(search: SearchEstimate, max = 8): { rows: InsightRow[]; hidden: number } {
  const all = search.perHeading;
  if (all.length <= max) return { rows: all, hidden: 0 };
  const keep = new Set<string>();
  for (const h of all) if (h.containsTarget) keep.add(h.nodeId);
  const byScent = [...all].sort((a, b) => b.pEnter - a.pEnter || b.scent - a.scent);
  for (const h of byScent) {
    if (keep.size >= max) break;
    keep.add(h.nodeId);
  }
  const rows = all.filter((h) => keep.has(h.nodeId));
  return { rows, hidden: all.length - rows.length };
}

/** "The answer sits under “More information”, which 97% of listeners skip on the first pass." */
export function insightSentence(search: SearchEstimate): string | null {
  const target = search.perHeading.find((h) => h.containsTarget);
  if (!target) return null;
  const label = target.label.replace(/\s+/g, " ").trim();
  const open = Math.min(1, Math.max(0, target.pEnter));
  if (open <= 0.5) return `The answer sits under “${label}”, which ${fmtProb(1 - open)} of listeners skip on the first pass.`;
  return `The answer sits under “${label}”, which ${fmtProb(open)} of listeners open on the first pass.`;
}
