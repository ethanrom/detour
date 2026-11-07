// "Fix the page you choose": shared types for the live fix loop.
//
//   plan (lib/fixes) -> POST /api/fix: one fast-tier agent per planned fix writes real edits against the
//   element's own markup (validated, sanitised; deterministic fallback without keys) -> the browser applies
//   the edits to the live copy of the page in the preview iframe -> Detour re-reads the patched page
//   (extractPage) and re-times every persona (engine) against the plan's prediction -> layout check.
//
// The seconds after a fix are still the model's, computed on the really patched page. UI and docs call them
// "re-checked on the fixed page", never "measured". In code, `measured` means exactly that.
//
// Frozen for the parallel tracks: change only via the lead.

import type { FixKind, FixPlan, FixSpec, NodeId, PageModel, PersonaId, Task, TaskResult } from "@/lib/contracts";

// ---------------------------------------------------------------------------------------------------------
// Limits (shared by the server validator and the client sanitiser)

export const MAX_FIXES_PER_RUN = 5;
/** Cap on a target's outer HTML sent to the agent. */
export const MAX_OUTER_HTML = 1500;
/** Cap on the parent's outer HTML sent to the agent. */
export const MAX_PARENT_HTML = 600;
export const MAX_EDITS_PER_FIX = 8;
/** Cap on the HTML of one edit. */
export const MAX_EDIT_HTML = 4096;
/** Cap on the CSS of one fix. */
export const MAX_EDIT_CSS = 2048;
/** A fix is "proven" when every persona the plan unblocked is unblocked and the re-checked seconds are within
 *  this many seconds of the prediction (or better). */
export const PROVEN_TOLERANCE_SECONDS = 0.5;
/** Stable-id attribute the extractor reads (ExtractOptions.idAttr default). Before the first edit the client
 *  stamps it on every element whose node id was generated, so ids survive edits that shift document order
 *  (a skip link inserted at the top would otherwise renumber every generated id). Edits must keep it; the
 *  client copies it onto a replacement's root when an agent drops it. */
export const ID_ATTR = "data-detour-id";

// ---------------------------------------------------------------------------------------------------------
// Request to POST /api/fix

/** What an agent sees about one target element of a fix. Collected in the browser from the live page. */
export interface FixTargetContext {
  nodeId: NodeId;
  /** Unique selector of the element in the page (A11yNode.selector, or the stamped [data-detour-id] one). */
  selector: string;
  /** The element's real outer HTML, cut to MAX_OUTER_HTML characters (cut marked with "…"). */
  outerHTML: string;
  /** The parent's outer HTML with the target replaced by "<!-- target -->", cut to MAX_PARENT_HTML. */
  parentHTML: string;
  /** Up to 4 short texts heard near the element (announcements of the reading stops before and after it). */
  nearbyText: string[];
  /** A few computed styles, so an edit can keep the look. Missing values are "". */
  style: Record<"display" | "fontSize" | "fontWeight" | "color" | "background" | "border" | "padding" | "margin" | "cursor", string>;
}

export interface FixRequestItem {
  fixId: string;
  kind: FixKind;
  title: string;
  params: FixSpec["params"];
  wcag: string[];
  targets: FixTargetContext[];
  /** Selectors an edit may touch besides the targets' own (skip-link: "body" and the skip target's selector). */
  extraSelectors?: string[];
  /** On a retry: why the first edit fell short (Detour's reason sentence or the validator's errors). */
  feedback?: string;
}

export interface FixRunRequest {
  siteId: string;
  pageTitle: string;
  fixes: FixRequestItem[];
}

// ---------------------------------------------------------------------------------------------------------
// Edits (the agent's tool output, after validation)

export type InsertPosition = "beforebegin" | "afterbegin" | "beforeend" | "afterend";

/** Tags wrapChildren may create. */
export type WrapTag = "button" | "span";

/** Prefer the ops that keep the original element (setAttributes, removeAttributes, wrapChildren, insert):
 *  the site's own listeners stay attached. `replace` creates a new element and drops them, so it is the
 *  last resort. */
export type EditOp =
  | { op: "replace"; selector: string; html: string }
  /** Move the element's existing children into a new <tag> inside it (for example a real <button> inside a
   *  clickable <div>: clicks still bubble to the div's own handler, and Enter on the button fires click). */
  | { op: "wrapChildren"; selector: string; tag: WrapTag; attributes: Record<string, string> }
  | { op: "setAttributes"; selector: string; attributes: Record<string, string> }
  | { op: "removeAttributes"; selector: string; names: string[] }
  | { op: "insert"; selector: string; position: InsertPosition; html: string }
  /** Plain text replacement of an element's text (used for verified wording; never parsed as HTML). */
  | { op: "setText"; selector: string; text: string };

/** Who wrote an edit. agent: the fast-tier model, validated. recorded: one real agent run saved for a demo site
 *  (fixtures/fix/<siteId>.json). fallback: deterministic templates (no keys, guard refused, or the agent failed
 *  twice). wording: a verified heading or label suggestion from /api/repair, applied as text. */
export type EditSource = "agent" | "recorded" | "fallback" | "wording";

export interface FixEdits {
  fixId: string;
  edits: EditOp[];
  /** Scoped CSS that keeps the original look (for example a reset for a new <button>). At most MAX_EDIT_CSS. */
  css?: string;
  /** One sentence for the site owner: what changed and where it likely lives in their source. */
  note: string;
  source: EditSource;
  /** Model call time in milliseconds (agent only). */
  ms?: number;
}

/** One NDJSON line of the POST /api/fix response, written as each fix settles. */
export type FixRunEvent =
  | { type: "edits"; result: FixEdits }
  | { type: "error"; fixId: string; reason: string }
  | { type: "done" };

// ---------------------------------------------------------------------------------------------------------
// Verified wording joins the same run (deterministic, no model call)

export interface WordingEdit {
  /** Synthetic fix id, e.g. "wording:heading:<nodeId>". */
  fixId: string;
  nodeId: NodeId;
  kind: "heading" | "label";
  /** heading: the accepted rename. label: the proposed accessible name. */
  text: string;
  /** The current text, for the card. */
  original: string;
}

// ---------------------------------------------------------------------------------------------------------
// The client run and its report

export type FixStage = "queued" | "writing" | "applied" | "rereading" | "proven" | "partial" | "retrying" | "failed";

export interface LayoutMove {
  selector: string;
  dx: number;
  dy: number;
}

export interface LayoutReport {
  /** Elements compared (outside the edited subtrees). */
  checked: number;
  /** Elements whose box moved by more than 1 px. */
  moved: LayoutMove[];
  docHeightBefore: number;
  docHeightAfter: number;
}

/** A persona's seconds on one task; null when that persona cannot finish. */
export type PersonaSeconds = Partial<Record<PersonaId, number | null>>;

export interface TaskCheck {
  taskId: string;
  before: PersonaSeconds;
  predicted: PersonaSeconds;
  /** Re-checked on the fixed page. */
  measured: PersonaSeconds;
}

export interface FixOutcome {
  fixId: string;
  title: string;
  stage: FixStage;
  edits?: FixEdits;
  /** Original outer HTML per edited selector (for the patch and to restore before a retry). */
  originals?: Record<string, string>;
  /** Outer HTML per edited selector right after the edit (for the patch). */
  applied?: Record<string, string>;
  /** Cumulative checks after this fix, in plan order. */
  checks?: TaskCheck[];
  /** Why a fix is partial or failed, in Detour's words. */
  reason?: string;
  attempts: number;
  /** Wall time from request to edits arriving, in milliseconds. */
  ms?: number;
}

export interface LiveFixReport {
  fixes: FixOutcome[];
  /** Final page: before, predicted and re-checked per task. */
  checks: TaskCheck[];
  /** Re-checked results on the fixed page (feed the after race). */
  results: TaskResult[];
  /** The re-read page after every fix. */
  page: PageModel;
  layout?: LayoutReport;
  proven: number;
  total: number;
}

export type LiveFixEvent =
  | { type: "stage"; outcome: FixOutcome }
  | { type: "layout"; layout: LayoutReport }
  | { type: "done"; report: LiveFixReport }
  | { type: "error"; message: string };

/** What runLiveFix needs. `plan.chosen` and `plan.gains` are in pick order; `predicted` is planAll's results. */
export interface LiveFixInput {
  frame: HTMLIFrameElement;
  siteId: string;
  /** URL recorded on the re-read PageModel (same as the original analysis). */
  url: string;
  /** The page as analysed before any fix. */
  page: PageModel;
  tasks: Task[];
  plan: FixPlan;
  before: TaskResult[];
  predicted: TaskResult[];
  wording?: WordingEdit[];
  /** opts.samples 0 = point estimates only: re-checks use that; the final results get the default intervals. */
  engine: { evaluate(page: PageModel, tasks: Task[], opts?: { samples?: number }): Promise<TaskResult[]> };
  /** Test seam: the document to patch (defaults to frame.contentDocument). */
  doc?: Document;
  /** Test seam and offline switch: defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  onEvent: (e: LiveFixEvent) => void;
  signal?: AbortSignal;
}

export type RunLiveFix = (input: LiveFixInput) => Promise<LiveFixReport>;
