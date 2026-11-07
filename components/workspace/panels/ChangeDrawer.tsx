"use client";

// The change drawer (spec §3): one modal <dialog> on the right, 560px wide and full height. It is the only place
// diffs appear. The native dialog traps focus, closes on Escape and puts focus back on the "View change" button that
// opened it, so none of that is re-implemented here.

import { useEffect, useId, useRef, useState } from "react";
import { CssView, DiffView } from "@/components/plan/DiffView";
import { SOURCE_NOTE, STAGE_WORD, displaySelector, tidyHtml } from "@/lib/ui/fix-run";
import { wordingTitle, wordingWhy } from "./fix/wording";
import type { ChangeDrawerProps } from "../contract";
import { Chip, GroupLabel } from "../ui";

/** Most edited places shown at once. */
const MAX_SELECTORS = 3;

export function ChangeDrawer({ open, onClose, fix, wording, outcome, page }: ChangeDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // The parent owns `open`; the dialog follows it.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const title = fix?.title ?? (wording ? wordingTitle(wording, outcome) : outcome?.title ?? "");
  const wcag = fix?.wcag ?? (wording ? (wording.kind === "heading" ? ["2.4.6 Headings and Labels"] : ["4.1.2 Name, Role, Value"]) : []);
  const why = fix?.rationale ?? (wording ? wordingWhy(wording) : "");

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape and the Close button end here. When the parent closes it (open=false) the handler sees open=false and stays quiet.
      onClose={() => {
        if (open) onClose();
      }}
      // A click on the backdrop lands on the dialog element itself (the dialog has no padding of its own).
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[560px] max-w-full overflow-hidden border-0 border-l border-rule bg-surface p-0 text-ink shadow-[-12px_0_32px_rgba(31,48,56,0.22)] backdrop:bg-ink/40"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <h2 id={titleId} className="min-w-0 text-base font-semibold leading-6 [overflow-wrap:anywhere]">
            Change: {title}
          </h2>
          <button type="button" className="btn btn-sm shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
          {(fix || wording) && <Body key={fix?.id ?? wording?.fixId} why={why} wcag={wcag} outcome={outcome} page={page} />}
        </div>
      </div>
    </dialog>
  );
}

function Body({ why, wcag, outcome: o, page }: { why: string; wcag: string[]; outcome: ChangeDrawerProps["outcome"]; page: ChangeDrawerProps["page"] }) {
  const [all, setAll] = useState(false);
  const wcagId = useId();
  const applied = o?.applied ?? {};
  const selectors = Object.keys(applied);
  const shown = all ? selectors : selectors.slice(0, MAX_SELECTORS);
  const css = o?.edits?.css;
  const note = o?.edits?.note;
  const source = o?.edits?.source;
  const stage = o?.stage;

  return (
    <>
      {why && <p className="text-sm leading-5">{why}</p>}

      {o && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted">
          {stage && <span className="font-medium text-ink">{STAGE_WORD[stage]}</span>}
          {source && (
            <>
              <span aria-hidden="true">·</span>
              <span>{SOURCE_NOTE[source]}</span>
            </>
          )}
        </p>
      )}

      {(stage === "partial" || stage === "failed") && o?.reason && (
        <p className="text-sm leading-5">
          <span className="font-semibold">Why it falls short: </span>
          {o.reason}
        </p>
      )}

      {selectors.length > 0 ? (
        <div>
          <GroupLabel>{selectors.length === 1 ? "The place that changed" : `${selectors.length} places changed`}</GroupLabel>
          <div className="flex flex-col gap-2">
            {shown.map((sel) => (
              <DiffView key={sel} patch={{ selector: displaySelector(sel, page ?? undefined), before: tidyHtml(o?.originals?.[sel] ?? ""), after: tidyHtml(applied[sel] ?? "") }} />
            ))}
          </div>
          {selectors.length > MAX_SELECTORS && (
            <button type="button" className="mt-2 text-sm font-medium underline underline-offset-2" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show ${selectors.length - MAX_SELECTORS} more`}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No edit has reached the page yet.</p>
      )}

      {css && <CssView css={css} />}

      {note && (
        <p className="text-sm leading-5 text-muted">
          <span className="font-semibold text-ink">For the site owner: </span>
          {note}
        </p>
      )}

      {wcag.length > 0 && (
        <div>
          <GroupLabel id={wcagId}>WCAG 2.2 success criteria</GroupLabel>
          <ul aria-labelledby={wcagId} className="flex flex-wrap gap-1.5">
            {wcag.map((w) => (
              <li key={w}>
                <Chip>
                  <span className="font-normal text-muted">WCAG</span> {w}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
