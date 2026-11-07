// The state of one "Fix this page" run, as the Analyze screen shows it. Pure: the stage events of runLiveFix
// go in, cards, chips, sentences and a live-region message come out. The DOM side is lib/ui/fix-page.ts.
//
// The seconds on these cards are the model's, computed on the really patched page. Words: "re-checked on the
// fixed page", never "measured".

import type { PageModel, PersonaId, Task } from "@/lib/contracts";
import type { EditSource, FixOutcome, FixStage, LayoutReport, LiveFixEvent, LiveFixReport, PersonaSeconds, TaskCheck, WordingEdit } from "@/lib/livefix/types";
import type { RepairReport } from "@/lib/repair/types";
import { fmtElapsed, fmtSeconds } from "./format";
import { PERSONA_BY_ID } from "./personas";
import { PERSONA_ORDER } from "./timeline";

// ---------------------------------------------------------------------------------------------------------
// Words

export const STAGE_WORD: Record<FixStage, string> = {
  queued: "Waiting",
  writing: "Writing the edit",
  applied: "Applied",
  rereading: "Re-reading the page",
  proven: "Proven",
  partial: "Partly",
  retrying: "Trying again",
  failed: "Couldn’t apply",
};

export const SOURCE_NOTE: Record<EditSource, string> = {
  agent: "Written by Claude (fast tier)",
  recorded: "Recorded Claude run",
  fallback: "Template edit (no AI)",
  wording: "Verified wording",
};

/** A fix whose run is over, one way or the other. */
export const isSettled = (s: FixStage): boolean => s === "proven" || s === "partial" || s === "failed";

/** A fix whose edits stay on the page (proven, or partly working). */
export const isKept = (o: FixOutcome | undefined): o is FixOutcome =>
  !!o && (o.stage === "proven" || o.stage === "partial") && !!o.edits && !!o.applied && Object.keys(o.applied).length > 0;

// ---------------------------------------------------------------------------------------------------------
// Verified wording: what /api/repair accepted, as edits for the same run

const WORDING_WCAG = { heading: ["2.4.6 Headings and Labels"], label: ["4.1.2 Name, Role, Value"] } as const;

export function wordingWcag(w: Pick<WordingEdit, "kind">): string[] {
  return [...WORDING_WCAG[w.kind]];
}

/** Every accepted heading rename and every proposed label. */
export function buildWordingEdits(report: RepairReport | null | undefined): WordingEdit[] {
  if (!report) return [];
  const out: WordingEdit[] = [];
  for (const h of report.headings) {
    if (h.accepted) out.push({ fixId: `wording:heading:${h.nodeId}`, nodeId: h.nodeId, kind: "heading", text: h.proposed, original: h.original });
  }
  for (const l of report.labels) {
    out.push({ fixId: `wording:label:${l.nodeId}`, nodeId: l.nodeId, kind: "label", text: l.proposed, original: "" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Run state

export type RunStatus = "running" | "done" | "error";

export interface FixRunState {
  status: RunStatus;
  /** Plan fix ids in plan order, then the wording ids. */
  ids: string[];
  /** How many of `ids` are plan fixes. */
  planCount: number;
  wording: WordingEdit[];
  /** Latest outcome per fix id, from the stage events. */
  outcomes: Record<string, FixOutcome>;
  layout?: LayoutReport;
  report?: LiveFixReport;
  error?: string;
  /** Short message for the polite live region. */
  announce: string;
}

export function startRun(planIds: string[], wording: WordingEdit[]): FixRunState {
  return {
    status: "running",
    ids: [...planIds, ...wording.map((w) => w.fixId)],
    planCount: planIds.length,
    wording,
    outcomes: {},
    announce: `Fixing the page. ${planIds.length} fix${planIds.length === 1 ? "" : "es"}${wording.length ? ` and ${wording.length} wording edit${wording.length === 1 ? "" : "s"}` : ""}.`,
  };
}

/** What to say when a fix changes stage; null for the stages that are only worth showing, not saying. */
export function announceFor(prev: FixOutcome | undefined, next: FixOutcome): string | null {
  if (prev?.stage === next.stage) return null;
  switch (next.stage) {
    case "proven":
      return `${next.title}: proven`;
    case "partial":
      return `${next.title}: partly working`;
    case "retrying":
      return `${next.title}: trying again`;
    case "failed":
      return `${next.title}: couldn’t apply`;
    default:
      return null;
  }
}

export function reduceEvent(state: FixRunState, e: LiveFixEvent): FixRunState {
  switch (e.type) {
    case "stage": {
      const said = announceFor(state.outcomes[e.outcome.fixId], e.outcome);
      return { ...state, outcomes: { ...state.outcomes, [e.outcome.fixId]: e.outcome }, announce: said ?? state.announce };
    }
    case "layout":
      return { ...state, layout: e.layout };
    default:
      return state;
  }
}

export interface RunSummary {
  /** Plan fixes proven, of all plan fixes. */
  proven: number;
  total: number;
  /** Wording edits that stayed on the page (proven or partly), of all wording edits. */
  wordingKept: number;
  wordingTotal: number;
}

export function summarize(state: FixRunState): RunSummary {
  const plan = state.ids.slice(0, state.planCount).map((id) => state.outcomes[id]);
  const wording = state.ids.slice(state.planCount).map((id) => state.outcomes[id]);
  return {
    proven: plan.filter((o) => o?.stage === "proven").length,
    total: state.planCount,
    wordingKept: wording.filter((o) => o?.stage === "proven" || o?.stage === "partial").length,
    wordingTotal: wording.length,
  };
}

export function finishRun(state: FixRunState, report: LiveFixReport): FixRunState {
  // The report's outcomes are the final ones (the last stage event of each fix is the same).
  const outcomes = { ...state.outcomes };
  for (const o of report.fixes) outcomes[o.fixId] = o;
  const next: FixRunState = { ...state, status: "done", outcomes, report, layout: report.layout ?? state.layout, announce: "" };
  const s = summarize(next);
  return { ...next, announce: `Finished. Proven: ${s.proven} of ${s.total}.` };
}

export function failRun(state: FixRunState, message: string): FixRunState {
  return { ...state, status: "error", error: message, announce: `Couldn’t fix the page. ${message}` };
}

// ---------------------------------------------------------------------------------------------------------
// Sentences

/** "412 elements kept their place", or which moved. */
export function layoutSentence(layout: LayoutReport | undefined): string {
  if (!layout || layout.checked === 0) return "The layout was not compared";
  const n = layout.checked;
  if (layout.moved.length === 0) return `${n} element${n === 1 ? "" : "s"} kept their place`;
  const m = layout.moved.length;
  return `${m} of ${n} element${n === 1 ? "" : "s"} moved`;
}

/** The moved elements, one short line each (at most `limit`). */
export function movedLines(layout: LayoutReport | undefined, limit = 6): string[] {
  if (!layout) return [];
  const lines = layout.moved.slice(0, limit).map((m) => `${m.selector}: ${m.dx} px across, ${m.dy} px down`);
  if (layout.moved.length > limit) lines.push(`and ${layout.moved.length - limit} more`);
  return lines;
}

export function wordingSentence(s: RunSummary): string {
  if (s.wordingTotal === 0) return "";
  const edits = `${s.wordingTotal} wording edit${s.wordingTotal === 1 ? "" : "s"}`;
  return s.wordingKept === s.wordingTotal ? `${edits} applied` : `${s.wordingKept} of ${edits} applied`;
}

// ---------------------------------------------------------------------------------------------------------
// Markup shown in a diff

const NOISE = [/ data-detour-pin="[^"]*"/g, / data-detour-fix="[^"]*"/g, / data-detour-id="n\d+(?:t\d+)?(?:-\d+)?"/g];

/** Page-local noise a reader should not see in a diff: layout pins, fix bookkeeping and generated ids. */
export function tidyHtml(html: string): string {
  return NOISE.reduce((s, re) => s.replace(re, ""), html);
}

/** `[data-detour-id="n12"]` as the element's own selector from the page model, when there is one. */
export function displaySelector(selector: string, page: PageModel | undefined): string {
  const id = /^\[data-detour-id="([^"]+)"\]$/.exec(selector)?.[1];
  const own = id ? page?.nodes[id]?.selector : undefined;
  return own && own.length <= 80 ? own : selector;
}

/** Lines of CSS, one rule per line, for display. */
export function cssLines(css: string): string {
  return css
    .replace(/\s*\{\s*/g, " { ")
    .replace(/;\s*/g, "; ")
    .replace(/\s*\}\s*/g, " }\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------------------
// Re-checked chips

export interface ChipView {
  persona: PersonaId;
  taskId: string;
  /** Re-checked seconds before this fix, or "can’t finish". */
  from: string;
  /** Re-checked on the fixed page. */
  to: string;
  /** What the plan predicted for this person after this fix. */
  predicted: string;
}

const cell = (v: number | null | undefined): string => (v === undefined ? "–" : v === null ? "can’t finish" : fmtSeconds(v));

/** How far two readings are apart; a flip between finishing and not finishing counts as a lot. */
function distance(a: number | null | undefined, b: number | null | undefined): number {
  if (a === undefined || b === undefined) return 0;
  if (a === null && b === null) return 0;
  if (a === null || b === null) return 1000;
  return Math.abs(a - b);
}

const NOTICEABLE = 0.5;

/**
 * One chip per person this fix touched: the plan predicted a change for them, or the page changed for them.
 * `prev` is the cumulative check of the fix before this one (the original `before` for the first fix). With
 * several tasks the task where the person moved most is the one shown.
 */
export function personaChips(checks: TaskCheck[] | undefined, prev: TaskCheck[] | undefined): ChipView[] {
  if (!checks) return [];
  const out: ChipView[] = [];
  for (const persona of PERSONA_ORDER) {
    let best: { chip: ChipView; size: number } | null = null;
    for (const c of checks) {
      const p = prev?.find((x) => x.taskId === c.taskId);
      const wasMeasured: PersonaSeconds = p ? p.measured : c.before;
      const wasPredicted: PersonaSeconds = p ? p.predicted : c.before;
      const size = Math.max(distance(wasPredicted[persona], c.predicted[persona]), distance(wasMeasured[persona], c.measured[persona]));
      if (size < NOTICEABLE) continue;
      if (!best || size > best.size) {
        best = { size, chip: { persona, taskId: c.taskId, from: cell(wasMeasured[persona]), to: cell(c.measured[persona]), predicted: cell(c.predicted[persona]) } };
      }
    }
    if (best) out.push(best.chip);
  }
  return out;
}

/** "Keyboard: can’t finish → 4.4 s (predicted 4.4 s)" as one sentence. */
export function chipSentence(c: ChipView): string {
  return `${PERSONA_BY_ID[c.persona].label}: ${c.from} → ${c.to} (predicted ${c.predicted})`;
}

/** The checks of the previous kept plan fix, in plan order, to compare a fix against. */
export function previousChecks(state: FixRunState, index: number): TaskCheck[] | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const o = state.outcomes[state.ids[i]];
    if (o?.checks && isKept(o)) return o.checks;
  }
  return undefined;
}

export function taskLabels(tasks: readonly Task[]): Record<string, string> {
  return Object.fromEntries(tasks.map((t) => [t.id, t.label]));
}

/** "0.4 s" for the time a fix's edit took to arrive; empty when unknown. */
export function elapsedText(o: FixOutcome | undefined): string {
  return o?.ms === undefined ? "" : fmtElapsed(o.ms / 1000);
}
