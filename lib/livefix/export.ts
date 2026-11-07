// Plain-text exports of a live-fix run: a readable patch to hand to a developer and a markdown report.
// Deterministic; every number is the model's, "re-checked on the fixed page" (never "measured").

import type { PersonaId } from "@/lib/contracts";
import { ID_ATTR, type FixOutcome, type LiveFixReport, type TaskCheck } from "./types";

export interface ExportMeta {
  url: string;
  title: string;
  /** Fix id -> WCAG success criteria, for the patch headers (the report itself does not carry them). */
  wcag?: Record<string, string[]>;
  /** Task id -> the task as a user would say it, for the report tables. */
  taskLabels?: Record<string, string>;
}

const PERSONAS: Array<{ id: PersonaId; name: string }> = [
  { id: "mouse", name: "Mouse" },
  { id: "keyboard", name: "Keyboard" },
  { id: "screenreader", name: "Screen reader" },
];

/** Page-local noise the reader should not see: layout pins, fix bookkeeping, and the ids Detour generated. */
function tidy(html: string): string {
  return html
    .replace(/ data-detour-pin="[^"]*"/g, "")
    .replace(/ data-detour-fix="[^"]*"/g, "")
    .replace(new RegExp(` ${ID_ATTR}="n\\d+(?:t\\d+)?(?:-\\d+)?"`, "g"), "");
}

const kept = (f: FixOutcome) => (f.stage === "proven" || f.stage === "partial") && !!f.applied && Object.keys(f.applied).length > 0;

/** A patch a developer can read: per fix, the markup before and after for each place it touched. */
export function patchText(report: LiveFixReport, meta: ExportMeta): string {
  const out: string[] = [`Detour patch for ${meta.title || meta.url}`, meta.url, ""];
  const fixes = report.fixes.filter(kept);
  if (fixes.length === 0) out.push("No fix was applied.");
  for (const f of fixes) {
    const wcag = meta.wcag?.[f.fixId] ?? [];
    out.push(`# ${f.title}${wcag.length ? ` (${wcag.join(", ")})` : ""}`);
    if (f.stage === "partial") out.push(`# Partly working: ${f.reason ?? "some checks still fall short."}`);
    for (const [selector, after] of Object.entries(f.applied ?? {})) {
      out.push("", `@@ ${selector}`, "--- before", tidy(f.originals?.[selector] ?? ""), "+++ after", tidy(after));
    }
    if (f.edits?.css) out.push("", "/* css */", f.edits.css);
    if (f.edits?.note) out.push("", `Note: ${f.edits.note}`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const cell = (s: number | null | undefined): string => (s === undefined ? "n/a" : s === null ? "can't finish" : `${s.toFixed(1)} s`);
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function taskTable(c: TaskCheck, label: string): string[] {
  const lines = [`### ${esc(label)}`, "", "| Person | Before | Predicted | Re-checked on the fixed page |", "| --- | --- | --- | --- |"];
  for (const { id, name } of PERSONAS) lines.push(`| ${name} | ${cell(c.before[id])} | ${cell(c.predicted[id])} | ${cell(c.measured[id])} |`);
  return lines;
}

/** A markdown report: what was fixed, the seconds per task and person, and whether the layout held. */
export function reportMarkdown(report: LiveFixReport, meta: ExportMeta): string {
  const out: string[] = [`# Detour re-check: ${esc(meta.title || meta.url)}`, "", meta.url, ""];
  out.push(`**${report.proven} of ${report.total} fixes proven** on the fixed page. A fix is proven when every person the plan expected to finish a task still finishes it, within 0.5 s of the prediction.`, "");

  out.push("## Fixes", "", "| Fix | Result | Tries | Note |", "| --- | --- | --- | --- |");
  for (const f of report.fixes) {
    const note = f.stage === "proven" ? (f.edits?.note ?? "") : (f.reason ?? f.edits?.note ?? "");
    out.push(`| ${esc(f.title)} | ${f.stage} | ${f.attempts} | ${esc(note)} |`);
  }

  out.push("", "## Seconds per task", "", "Before: the page as it was. Predicted: the plan's estimate. Re-checked: the same model run on the really fixed page.", "");
  for (const c of report.checks) out.push(...taskTable(c, meta.taskLabels?.[c.taskId] ?? c.taskId), "");

  out.push("## Layout", "");
  const l = report.layout;
  if (!l || l.checked === 0) out.push("The layout check did not run (no layout was available).");
  else if (l.moved.length === 0) out.push(`No element moved: ${l.checked} compared outside the edited parts. Page height ${Math.round(l.docHeightBefore)} px before, ${Math.round(l.docHeightAfter)} px after.`);
  else {
    out.push(`${l.moved.length} of ${l.checked} elements moved by more than 1 px. Page height ${Math.round(l.docHeightBefore)} px before, ${Math.round(l.docHeightAfter)} px after.`, "");
    for (const m of l.moved.slice(0, 10)) out.push(`- \`${m.selector}\` moved ${m.dx} px across, ${m.dy} px down`);
    if (l.moved.length > 10) out.push(`- and ${l.moved.length - 10} more`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}
