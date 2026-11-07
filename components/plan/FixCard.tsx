import type { CSSProperties, ReactNode } from "react";
import { CheckIcon, CrossIcon, PersonaIcon } from "@/components/icons";
import type { FixSpec, PageModel } from "@/lib/contracts";
import type { FixOutcome, FixStage, WordingEdit } from "@/lib/livefix/types";
import { describeImpact, type FixImpact } from "@/lib/ui/compare";
import { diffHtml } from "@/lib/ui/diff";
import { SOURCE_NOTE, STAGE_WORD, displaySelector, elapsedText, isSettled, tidyHtml, wordingWcag, type ChipView } from "@/lib/ui/fix-run";
import { fmtNum } from "@/lib/ui/format";
import { PERSONA_BY_ID } from "@/lib/ui/personas";
import { CssView, DiffView, diffHeightRem } from "./DiffView";

/** What a card needs once "Fix this page" has been pressed. */
export interface RunView {
  /** Latest outcome of this fix; absent until its first stage event arrives (it then reads "Waiting"). */
  outcome?: FixOutcome;
  /** Re-checked chips for the people this fix touched. */
  chips: ChipView[];
  /** For readable selectors in the diff. */
  page?: PageModel;
  taskLabels: Record<string, string>;
  /** More than one task on the page: chips then say which task they are about. */
  manyTasks: boolean;
}

interface Props {
  fix: FixSpec;
  rank: number;
  impact?: FixImpact;
  /** Present once a run has started. Before that the card shows the plan only. */
  run?: RunView;
}

/** Flat grey block at the size of what is coming: no shimmer, so nothing moves when the real thing lands. */
function Hold({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`block rounded border border-rule bg-paper-2 ${className ?? ""}`} style={style} />;
}

const MAX_DIFFS_SHOWN = 2;

function RunBody({ run, templateLines }: { run: RunView; templateLines: number }) {
  const o = run.outcome;
  const stage: FixStage = o?.stage ?? "queued";
  const settled = isSettled(stage);
  const failed = stage === "failed";
  const applied = o?.applied ?? {};
  const selectors = Object.keys(applied);
  const css = o?.edits?.css;
  const source = o?.edits?.source;
  const elapsed = elapsedText(o);
  const note = o?.edits?.note;
  const waitingForEdit = stage === "queued" || stage === "writing";

  const diff = (sel: string) => (
    <DiffView
      key={sel}
      patch={{ selector: displaySelector(sel, run.page), before: tidyHtml(o?.originals?.[sel] ?? ""), after: tidyHtml(applied[sel] ?? "") }}
    />
  );

  return (
    <div className="space-y-3 border-t border-rule pt-3 sm:col-span-full">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem]">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${failed ? "text-blocked" : ""}`}>
          {stage === "proven" && <CheckIcon size={14} />}
          {failed && <CrossIcon size={14} />}
          <span className="sr-only">Fix state: </span>
          <span>{STAGE_WORD[stage]}</span>
        </span>
        {elapsed && <span className="tnum text-muted">{elapsed}</span>}
        {source ? <span className="text-muted">{SOURCE_NOTE[source]}</span> : !failed && <Hold className="h-4 w-44" />}
      </p>

      {(stage === "partial" || failed) && o?.reason && (
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">Why: </span>
          {o.reason}
        </p>
      )}

      {selectors.length > 0 ? (
        <div className="space-y-2">
          {selectors.slice(0, MAX_DIFFS_SHOWN).map(diff)}
          {selectors.length > MAX_DIFFS_SHOWN && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {selectors.length - MAX_DIFFS_SHOWN} more place{selectors.length - MAX_DIFFS_SHOWN === 1 ? "" : "s"} edited
              </summary>
              <div className="mt-2 space-y-2">{selectors.slice(MAX_DIFFS_SHOWN).map(diff)}</div>
            </details>
          )}
          {css && <CssView css={css} />}
        </div>
      ) : (
        waitingForEdit && <Hold style={{ height: `${diffHeightRem(templateLines)}rem` }} />
      )}

      {note ? (
        <p className="text-sm leading-relaxed text-muted">
          <span className="font-semibold text-ink">For the site owner: </span>
          {note}
        </p>
      ) : (
        !settled && <Hold className="h-4 w-3/4 max-w-md" />
      )}

      {run.chips.length > 0 ? (
        <ul aria-label="Re-checked on the fixed page" className="flex flex-wrap gap-x-4 gap-y-1.5">
          {run.chips.map((c) => {
            const meta = PERSONA_BY_ID[c.persona];
            const blocked = c.to === "can’t finish";
            return (
              <li key={c.persona} className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex min-h-6 flex-wrap items-center gap-x-1.5 rounded px-2 py-0.5 text-[0.8125rem] font-medium"
                  style={{ background: meta.tint, color: blocked ? "var(--blocked)" : meta.color }}
                >
                  <PersonaIcon persona={c.persona} size={14} />
                  <span>{meta.label}:</span>
                  <span className="tnum">
                    {c.from} <span aria-hidden="true">→</span>
                    <span className="sr-only"> became </span> {c.to}
                  </span>
                  <span className="tnum font-normal text-muted">(predicted {c.predicted})</span>
                </span>
                {run.manyTasks && <span className="text-[0.8125rem] text-muted">{run.taskLabels[c.taskId] ?? c.taskId}</span>}
              </li>
            );
          })}
        </ul>
      ) : settled ? (
        !failed && <p className="text-sm text-muted">No change in seconds for these tasks.</p>
      ) : (
        <div aria-hidden="true" className="flex flex-wrap gap-1.5">
          <Hold className="h-6 w-56" />
          <Hold className="h-6 w-44" />
        </div>
      )}
    </div>
  );
}

function Shell({ rank, title, kind, rationale, wcag, side, run, templateLines }: {
  rank?: number;
  title: string;
  kind: string;
  rationale: ReactNode;
  wcag: string[];
  side?: ReactNode;
  run?: RunView;
  templateLines: number;
}) {
  return (
    <li
      className={`card grid gap-x-4 gap-y-3 p-4 sm:p-5 ${rank === undefined ? "sm:grid-cols-[minmax(0,1fr)_auto]" : "sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]"}`}
    >
      {/* A rank is data: a plain number, no badge. */}
      {rank !== undefined && (
        <span aria-hidden="true" className="tnum text-lg font-semibold leading-snug text-muted max-sm:hidden">
          {rank}.
        </span>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="h-card">
            {rank !== undefined && <span className="sr-only">Fix {rank}: </span>}
            {title}
          </h3>
          <span className="rounded bg-paper-2 px-1.5 py-0.5 text-[0.8125rem] text-muted">{kind}</span>
        </div>
        <p className="mt-1.5 max-w-prose text-[0.9375rem] leading-relaxed text-muted">{rationale}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="WCAG 2.2 success criteria">
          {wcag.map((w) => (
            <li key={w} className="rounded border border-rule-strong px-2 py-0.5 text-[0.8125rem] font-medium">
              WCAG <span className="tnum">{w}</span>
            </li>
          ))}
        </ul>
      </div>
      {side}
      {run && <RunBody run={run} templateLines={templateLines} />}
    </li>
  );
}

/** A planned fix: the plan's reasoning and predicted gain, and once the page is being fixed, what really happened. */
export function FixCard({ fix, rank, impact, run }: Props) {
  const d = impact ? describeImpact(impact) : { savings: [] as string[], unblocks: [] as string[] };
  const seconds = impact?.seconds ?? 0;
  const unblocks = d.unblocks.length > 0;
  const side = (
    <div className="sm:text-right">
      <p className="tnum text-2xl font-semibold leading-none">{seconds >= 0.5 ? `−${fmtNum(seconds)} s` : unblocks ? "Unblocks" : "–"}</p>
      <p className="mt-1 text-[0.8125rem] text-muted">
        {seconds >= 0.5 ? "predicted, across tasks" : unblocks ? "predicted: a person who could not finish" : "no predicted gain"}
      </p>
      {(d.savings.length > 0 || unblocks) && (
        <ul className="mt-2 space-y-1 text-[0.8125rem]">
          {unblocks &&
            d.unblocks.map((u) => (
              <li key={u} className="inline-block rounded bg-lime px-2 py-0.5 font-medium sm:ml-auto sm:block sm:w-fit">
                {u.replace(/^unblockss+/i, "")} can finish
              </li>
            ))}
          {d.savings.map((s) => (
            <li key={s} className="text-muted">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  // The template diff only sizes the placeholder; it is never shown.
  const templateLines = run ? diffHtml(fix.patch.before, fix.patch.after).length : 0;
  return <Shell rank={rank} title={fix.title} kind={fix.kind} rationale={fix.rationale} wcag={fix.wcag} side={side} run={run} templateLines={templateLines} />;
}

/** A verified heading rename or label: the same card, from the same run. */
export function WordingCard({ edit, run }: { edit: WordingEdit; run: RunView }) {
  const rationale =
    edit.kind === "heading"
      ? `The scent model checked that “${edit.text}” helps a screen-reader user find this section faster than “${edit.original}”.`
      : `This control has no accessible name. “${edit.text}” is the name proposed for it and checked against the page.`;
  const title = run.outcome?.title ?? (edit.kind === "heading" ? `Rename the heading “${edit.original}” to “${edit.text}”` : `Label the control “${edit.text}”`);
  return <Shell title={title} kind="wording" rationale={rationale} wcag={wordingWcag(edit)} run={run} templateLines={3} />;
}
