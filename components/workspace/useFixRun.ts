"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WordingEdit } from "@/lib/livefix/types";
import type { Analysis, DataSource, PlanOutcome, SiteInfo } from "@/lib/ui/datasource";
import { failRun, finishRun, reduceEvent, startRun, type FixRunState } from "@/lib/ui/fix-run";
import { frameDocument, reapplyAll, restoreAll } from "@/lib/ui/fix-page";

export type PageView = "fixed" | "original";

interface Options {
  source: DataSource;
  site: SiteInfo | undefined;
  ready: Analysis | undefined;
  outcome: PlanOutcome | undefined;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** Verified wording that joins the run. */
  wording: WordingEdit[];
  /** Called when a run has finished and its result is on screen. */
  onDone: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

/**
 * One "Fix this page" run: start it, follow its stage events, undo it, and flip the preview between the fixed
 * and the original page. A new run, a re-plan and a change of page all go through `reset`, which also puts the
 * preview back to the original.
 */
export function useFixRun({ source, site, ready, outcome, frameRef, wording, onDone }: Options) {
  const [run, setRun] = useState<FixRunState | null>(null);
  const [shown, setShown] = useState<PageView>("fixed");
  /** Changes whenever a run finishes (restarts the after race and moves focus to it). */
  const [doneKey, setDoneKey] = useState(0);

  const controller = useRef<AbortController | null>(null);
  /** Events and results of a run that has been replaced or reset are dropped. */
  const token = useRef(0);
  /** Ids of the last run's fixes: the keys of the edit journals in the preview document. */
  const ids = useRef<string[]>([]);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const canFix = !!source.fixPage;

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    token.current++;
    const doc = frameDocument(frameRef.current);
    if (doc) restoreAll(doc, ids.current);
    ids.current = [];
    setRun(null);
    setShown("fixed");
  }, [frameRef]);

  // Leaving the screen stops a run in flight. The preview goes away with it.
  useEffect(
    () => () => {
      controller.current?.abort();
      token.current++;
    },
    [],
  );

  const fix = useCallback(async () => {
    const frame = frameRef.current;
    if (!source.fixPage || !site || !ready || !outcome || !frame) return;
    // Always start from the original page: fixes made by an earlier run come off first.
    const doc = frameDocument(frame);
    if (doc) restoreAll(doc, ids.current);
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    const mine = ++token.current;
    const planIds = outcome.plan.chosen.map((f) => f.id);
    const start = startRun(planIds, wording);
    ids.current = start.ids;
    setShown("fixed");
    setRun(start);
    try {
      const report = await source.fixPage(site, ready, outcome, frame, {
        wording,
        signal: ctl.signal,
        onEvent: (e) => {
          if (token.current === mine) setRun((cur) => (cur ? reduceEvent(cur, e) : cur));
        },
      });
      if (token.current !== mine) return;
      setRun((cur) => (cur ? finishRun(cur, report) : cur));
      setDoneKey((n) => n + 1);
      done.current();
    } catch (e) {
      if (token.current !== mine || isAbort(e)) return;
      // Whatever was applied before the failure stays out of the way.
      const d = frameDocument(frame);
      if (d) restoreAll(d, ids.current);
      setRun((cur) => (cur ? failRun(cur, errMsg(e)) : cur));
    }
  }, [source, site, ready, outcome, frameRef, wording]);

  /** Flip the preview between the original page and the fixed one, without reloading it. */
  const toggle = useCallback(() => {
    const doc = frameDocument(frameRef.current);
    if (!doc || !run || run.status !== "done") return;
    if (shown === "fixed") {
      restoreAll(doc, run.ids);
      setShown("original");
    } else {
      reapplyAll(
        doc,
        run.ids.map((id) => run.outcomes[id]),
      );
      setShown("fixed");
    }
  }, [frameRef, run, shown]);

  return { run, shown, doneKey, canFix, fix, reset, toggle };
}
