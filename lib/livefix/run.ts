// The browser side of "fix the page you choose": ask for edits, apply them to the live copy of the page in the
// preview iframe, re-read the patched page, re-time every persona with the engine and compare with what the
// plan predicted. The seconds after a fix are still the model's, computed on the really patched page: they are
// "re-checked on the fixed page", never "measured" in user-facing words.

import { BLOCKED_PENALTY_SECONDS, type FixSpec, type PageModel, type PersonaId, type Task, type TaskResult } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { applyEdits, collectContext, measureLayout, pinLayout, restore, selectorFor, stampIds, type ApplyResult } from "./dom";
import {
  MAX_FIXES_PER_RUN,
  PROVEN_TOLERANCE_SECONDS,
  type EditOp,
  type FixEdits,
  type FixOutcome,
  type FixRequestItem,
  type FixRunEvent,
  type FixRunRequest,
  type FixStage,
  type FixTargetContext,
  type LiveFixEvent,
  type LiveFixInput,
  type LiveFixReport,
  type PersonaSeconds,
  type RunLiveFix,
  type TaskCheck,
  type WordingEdit,
} from "./types";

const PERSONAS: PersonaId[] = ["mouse", "keyboard", "screenreader"];
const PERSONA_NAME: Record<PersonaId, string> = { mouse: "Mouse", keyboard: "Keyboard", screenreader: "Screen reader" };
const NO_SERVICE = "Couldn't reach the fixing service.";
/** Targets sent to the agent for one fix (a group fix such as five size options is well inside this). */
const MAX_TARGETS = 12;
/** How long to wait for an animation frame that a hidden or throttled frame may never deliver. */
const FRAME_TIMEOUT_MS = 100;

const fmt = (s: number) => (Math.round(s * 10) / 10).toFixed(1);

// ---------------------------------------------------------------------------------------------------------
// Seconds

function secondsOf(results: TaskResult[]): Map<string, PersonaSeconds> {
  const out = new Map<string, PersonaSeconds>();
  for (const r of results) {
    const row: PersonaSeconds = {};
    for (const p of PERSONAS) row[p] = r.personas[p].blocked ? null : r.personas[p].seconds;
    out.set(r.taskId, row);
  }
  return out;
}

/** Plan gains record a blocked persona as BLOCKED_PENALTY_SECONDS; a persona the plan did not time is left out. */
function predictedAfter(after: Record<string, Partial<Record<PersonaId, number>>> | undefined, taskId: string): PersonaSeconds {
  const row: PersonaSeconds = {};
  for (const p of PERSONAS) {
    const v = after?.[taskId]?.[p];
    if (v !== undefined) row[p] = v >= BLOCKED_PENALTY_SECONDS ? null : v;
  }
  return row;
}

function checksOf(tasks: Task[], before: Map<string, PersonaSeconds>, predicted: (taskId: string) => PersonaSeconds, measured: Map<string, PersonaSeconds>): TaskCheck[] {
  return tasks.map((t) => ({ taskId: t.id, before: before.get(t.id) ?? {}, predicted: predicted(t.id), measured: measured.get(t.id) ?? {} }));
}

/**
 * Null when every persona that was expected to finish a task does so within the tolerance of what was
 * expected; otherwise a sentence for the site owner about the first shortfall.
 */
function shortfall(expected: (taskId: string) => PersonaSeconds, checks: TaskCheck[], results: TaskResult[]): string | null {
  for (const c of checks) {
    const want = expected(c.taskId);
    for (const p of PERSONAS) {
      const w = want[p];
      if (w === null || w === undefined) continue;
      const got = c.measured[p];
      if (got !== null && got !== undefined && got <= w + PROVEN_TOLERANCE_SECONDS) continue;
      const blocked = results.find((r) => r.taskId === c.taskId)?.personas[p].blocked?.reason;
      if (got === null || got === undefined) return blocked ?? `${PERSONA_NAME[p]}: ${fmt(w)} s predicted, can't finish on the fixed page`;
      return `${PERSONA_NAME[p]}: ${fmt(w)} s predicted, ${fmt(got)} s on the fixed page`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Timing and abort helpers

function abortError(): Error {
  const e = new Error("The fix run was cancelled.");
  e.name = "AbortError";
  return e;
}

const isAbort = (e: unknown) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

/** One animation frame of the frame's window, with a timer behind it, or a plain tick without frames. */
function nextFrame(win: Window | null): Promise<void> {
  return new Promise((resolve) => {
    const own = win && typeof win.requestAnimationFrame === "function" ? win : null;
    if (!own && typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    const timer = setTimeout(resolve, FRAME_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    if (own) own.requestAnimationFrame(done);
    else requestAnimationFrame(done);
  });
}

// ---------------------------------------------------------------------------------------------------------
// POST /api/fix

function parseLine(line: string): FixRunEvent | null {
  const text = line.trim();
  if (!text) return null;
  try {
    const e = JSON.parse(text) as Partial<FixRunEvent> & { result?: Partial<FixEdits>; fixId?: unknown; reason?: unknown };
    if (e.type === "edits" && e.result && typeof e.result.fixId === "string" && Array.isArray(e.result.edits)) return { type: "edits", result: e.result as FixEdits };
    if (e.type === "error" && typeof e.fixId === "string") return { type: "error", fixId: e.fixId, reason: typeof e.reason === "string" ? e.reason : "The agent gave up." };
    if (e.type === "done") return { type: "done" };
  } catch {
    /* a half-written or non-JSON line is skipped */
  }
  return null;
}

/** Send the request and hand each NDJSON event to `onEvent` as it arrives. Resolves to a reason on failure. */
async function postFix(fetchImpl: typeof fetch, body: FixRunRequest, signal: AbortSignal | undefined, onEvent: (e: FixRunEvent) => void): Promise<string | null> {
  const feed = (line: string) => {
    const e = parseLine(line);
    if (e) onEvent(e);
  };
  try {
    const res = await fetchImpl("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!res.ok) return `${NO_SERVICE} (${res.status})`;
    const reader = res.body?.getReader();
    if (!reader) {
      for (const line of (await res.text()).split("\n")) feed(line);
      return null;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        feed(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    feed(buffer + decoder.decode());
    return null;
  } catch (e) {
    if (isAbort(e) || signal?.aborted) throw abortError();
    return NO_SERVICE;
  }
}

type Arrival = { fixId: string; edits: FixEdits; at: number } | { fixId: string; error: string; at: number };

// ---------------------------------------------------------------------------------------------------------
// The run

interface Attempt {
  verdict: "proven" | "partial" | "unusable";
  reason?: string;
  checks: TaskCheck[];
  apply: ApplyResult;
  page: PageModel;
  results: TaskResult[];
}

export const runLiveFix: RunLiveFix = async (input: LiveFixInput): Promise<LiveFixReport> => {
  const emit = (e: LiveFixEvent) => input.onEvent(e);
  try {
    return await run(input, emit);
  } catch (e) {
    if (!isAbort(e)) emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
};

async function run(input: LiveFixInput, emit: (e: LiveFixEvent) => void): Promise<LiveFixReport> {
  const doc = input.doc ?? input.frame?.contentDocument ?? null;
  if (!doc) throw new Error("The preview page can't be edited: its document isn't available (it may be from another origin or not loaded yet).");
  const fetchImpl = input.fetchImpl ?? fetch;
  const checkAbort = () => {
    if (input.signal?.aborted) throw abortError();
  };

  const chosen: FixSpec[] = input.plan.chosen.slice(0, MAX_FIXES_PER_RUN);
  const wording: WordingEdit[] = input.wording ?? [];
  const t0 = Date.now();

  // Ids first, then what the agents see (before pins appear in the markup), then the pins.
  stampIds(doc, input.page);
  const items = chosen.map((fix) => buildItem(fix, doc, input.page));
  const pins = pinLayout(doc);

  const outcomes: FixOutcome[] = [
    ...chosen.map((fix): FixOutcome => ({ fixId: fix.id, title: fix.title, stage: "queued", attempts: 0 })),
    ...wording.map((w): FixOutcome => ({ fixId: w.fixId, title: wordingTitle(w), stage: "queued", attempts: 0 })),
  ];
  const set = (i: number, patch: Partial<FixOutcome> & { stage?: FixStage }) => {
    outcomes[i] = { ...outcomes[i], ...patch };
    emit({ type: "stage", outcome: outcomes[i] });
  };
  outcomes.forEach((_, i) => set(i, {}));

  const before = secondsOf(input.before);
  const finalPredicted = secondsOf(input.predicted);
  let page = input.page;
  let results = input.before;
  /** Selectors whose subtree each kept fix changed (layout inside them is not compared). */
  const edited = new Map<string, string[]>();

  // ---- ask for edits (one request for every fix that has something to edit)
  const arrivals = new Map<string, Arrival>();
  let streamEnded = false;
  let streamFailure: string | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const toSend = items.flatMap((item, i) => (item ? [{ item, i }] : []));
  chosen.forEach((_, i) => {
    if (items[i]) set(i, { stage: "writing", attempts: 1 });
    else set(i, { stage: "failed", reason: "Couldn't find this element on the live page." });
  });
  if (toSend.length > 0) {
    const request: FixRunRequest = { siteId: input.siteId, pageTitle: input.page.title, fixes: toSend.map((s) => s.item) };
    void postFix(fetchImpl, request, input.signal, (e) => {
      if (e.type === "edits") arrivals.set(e.result.fixId, { fixId: e.result.fixId, edits: e.result, at: Date.now() });
      else if (e.type === "error") arrivals.set(e.fixId, { fixId: e.fixId, error: e.reason, at: Date.now() });
      notify();
    })
      .then((failure) => {
        streamFailure = failure;
      })
      .catch(() => {
        streamFailure = "The fix run was cancelled.";
      })
      .finally(() => {
        streamEnded = true;
        notify();
      });
  } else {
    streamEnded = true;
  }
  const arrival = async (fixId: string): Promise<Arrival> => {
    for (;;) {
      checkAbort();
      const a = arrivals.get(fixId);
      if (a) return a;
      if (streamEnded) return { fixId, error: streamFailure ?? "The fixing service sent no edits for this fix.", at: Date.now() };
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  };

  // ---- one attempt: apply, re-read, re-time, compare
  const attempt = async (edits: FixEdits, expected: (taskId: string) => PersonaSeconds, checked: (taskId: string) => PersonaSeconds, on: (stage: FixStage, extra?: Partial<FixOutcome>) => void): Promise<Attempt> => {
    const apply = applyEdits(doc, edits);
    if (apply.ok === 0) {
      restore(doc, apply.originals, edits.fixId);
      return { verdict: "unusable", reason: apply.errors[0] ?? "None of the edits could be applied.", checks: [], apply, page, results };
    }
    on("applied", { edits, originals: apply.originals, applied: apply.applied });
    on("rereading");
    try {
      await nextFrame(doc.defaultView);
      await nextFrame(doc.defaultView);
      const nextPage = extractPage(doc, { url: input.url });
      const nextResults = await input.engine.evaluate(nextPage, input.tasks);
      const checks = checksOf(input.tasks, before, checked, secondsOf(nextResults));
      const reason = shortfall(expected, checks, nextResults);
      return { verdict: reason === null ? "proven" : "partial", ...(reason === null ? {} : { reason }), checks, apply, page: nextPage, results: nextResults };
    } catch (e) {
      if (isAbort(e)) throw e;
      restore(doc, apply.originals, edits.fixId);
      return { verdict: "unusable", reason: `Couldn't re-check the page after this fix: ${e instanceof Error ? e.message : String(e)}`, checks: [], apply, page, results };
    }
  };
  const keep = (fixId: string, a: Attempt) => {
    page = a.page;
    results = a.results;
    edited.set(fixId, a.apply.edited);
  };

  // ---- plan fixes, in plan order
  for (let i = 0; i < chosen.length; i++) {
    const item = items[i];
    if (!item) continue;
    const fix = chosen[i];
    const arrived = await arrival(fix.id);
    const ms = arrived.at - t0;
    if (!("edits" in arrived)) {
      set(i, { stage: "failed", reason: arrived.error, ms });
      continue;
    }
    set(i, { ms });
    const gains = input.plan.gains[i]?.after;
    const predictedHere = (taskId: string) => predictedAfter(gains, taskId);
    const on = (stage: FixStage, extra?: Partial<FixOutcome>) => set(i, { stage, ...extra });

    let first = await attempt(arrived.edits, predictedHere, predictedHere, on);
    if (first.verdict === "unusable") {
      set(i, { stage: "failed", reason: first.reason, edits: arrived.edits });
      continue;
    }
    keep(fix.id, first);
    if (first.verdict === "proven") {
      set(i, { stage: "proven", checks: first.checks });
      continue;
    }

    // Partial: tell the agent why and let it try once more, on the page as it was before this fix.
    set(i, { stage: "partial", reason: first.reason, checks: first.checks });
    restore(doc, first.apply.originals, fix.id);
    edited.delete(fix.id);
    set(i, { stage: "retrying", attempts: 2 });
    const retryStart = Date.now();
    const retryItem = buildItem(fix, doc, input.page);
    let retried: FixEdits | null = null;
    if (retryItem) {
      await postFix(fetchImpl, { siteId: input.siteId, pageTitle: input.page.title, fixes: [{ ...retryItem, feedback: first.reason }] }, input.signal, (e) => {
        if (e.type === "edits" && e.result.fixId === fix.id) retried = e.result;
      }).catch((e: unknown) => {
        if (isAbort(e)) throw e;
        return NO_SERVICE;
      });
    }
    const retriedEdits = retried as FixEdits | null;
    const second = retriedEdits ? await attempt(retriedEdits, predictedHere, predictedHere, on) : null;
    if (second && second.verdict !== "unusable") {
      keep(fix.id, second);
      set(i, { stage: second.verdict, checks: second.checks, ms: ms + (Date.now() - retryStart), ...(second.reason ? { reason: second.reason } : { reason: undefined }) });
      continue;
    }
    // No usable second try: put the first edits back; they still helped.
    const again = applyEdits(doc, arrived.edits);
    first = { ...first, apply: again };
    keep(fix.id, first);
    set(i, {
      stage: "partial",
      edits: arrived.edits,
      originals: again.originals,
      applied: again.applied,
      checks: first.checks,
      reason: first.reason,
      ms: ms + (Date.now() - retryStart),
    });
  }

  // ---- verified wording: deterministic, one outcome each
  for (let k = 0; k < wording.length; k++) {
    checkAbort();
    const i = chosen.length + k;
    const w = wording[k];
    const node = input.page.nodes[w.nodeId];
    const edits = node ? wordingEdits(w, selectorFor(node)) : null;
    if (!edits) {
      set(i, { stage: "failed", reason: "That element is no longer on the page." });
      continue;
    }
    const wasAt = secondsOf(results);
    const on = (stage: FixStage, extra?: Partial<FixOutcome>) => set(i, { stage, attempts: 1, ...extra });
    const a = await attempt(edits, (id) => wasAt.get(id) ?? {}, (id) => finalPredicted.get(id) ?? {}, on);
    if (a.verdict === "unusable") {
      set(i, { stage: "failed", reason: a.reason, edits });
      continue;
    }
    keep(w.fixId, a);
    set(i, { stage: a.verdict, checks: a.checks, ...(a.reason ? { reason: a.reason } : {}) });
  }

  // ---- layout, then the report
  checkAbort();
  const layout = measureLayout(doc, pins, [...edited.values()].flat());
  emit({ type: "layout", layout });
  const finalChecks = checksOf(input.tasks, before, (id) => finalPredicted.get(id) ?? {}, secondsOf(results));
  const report: LiveFixReport = {
    fixes: outcomes,
    checks: finalChecks,
    results,
    page,
    layout,
    proven: outcomes.filter((o) => o.stage === "proven").length,
    total: outcomes.length,
  };
  emit({ type: "done", report });
  return report;
}

// ---------------------------------------------------------------------------------------------------------
// Request items and wording

function buildItem(fix: FixSpec, doc: Document, page: PageModel): FixRequestItem | null {
  const targets: FixTargetContext[] = [];
  for (const id of fix.targets.slice(0, MAX_TARGETS)) {
    try {
      targets.push(collectContext(doc, page, id));
    } catch {
      /* a target that is gone is left out */
    }
  }
  if (targets.length === 0) return null;
  return {
    fixId: fix.id,
    kind: fix.kind,
    title: fix.title,
    params: fix.params,
    wcag: fix.wcag,
    targets,
    ...(fix.kind === "skip-link" ? { extraSelectors: ["body"] } : {}),
  };
}

function wordingTitle(w: WordingEdit): string {
  return w.kind === "heading" ? `Rename the heading “${w.original}” to “${w.text}”` : `Label ${w.original ? `“${w.original}”` : "the control"} as “${w.text}”`;
}

function wordingEdits(w: WordingEdit, selector: string): FixEdits | null {
  const edit: EditOp = w.kind === "heading" ? { op: "setText", selector, text: w.text } : { op: "setAttributes", selector, attributes: { "aria-label": w.text } };
  return {
    fixId: w.fixId,
    edits: [edit],
    note: w.kind === "heading" ? `Heading text changed from “${w.original}” to “${w.text}”.` : `aria-label="${w.text}" added so the control has a name.`,
    source: "wording",
  };
}
