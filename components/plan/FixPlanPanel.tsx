"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import type { PageModel, Task, TaskResult } from "@/lib/contracts";
import { patchText, reportMarkdown, type ExportMeta } from "@/lib/livefix/export";
import { fixImpacts } from "@/lib/ui/compare";
import { exhaustivePoolSize } from "@/lib/fixes";
import type { PlanOutcome } from "@/lib/ui/datasource";
import { layoutSentence, movedLines, personaChips, previousChecks, summarize, taskLabels, wordingSentence, type FixRunState } from "@/lib/ui/fix-run";
import { fmtOptimality } from "@/lib/ui/format";
import { FixCard, WordingCard, type RunView } from "./FixCard";

export type PlanStatus = "idle" | "loading" | "ready" | "error";

/** Everything the panel needs to fix the page and show the run. */
export interface FixView {
  /** The data source can fix this page (the live page, not sample data). */
  available: boolean;
  run: FixRunState | null;
  /** The page as read before any fix, for readable selectors in the diffs. */
  page: PageModel;
  tasks: Task[];
  /** Where the exports get their title, address, WCAG numbers and task names. */
  meta: ExportMeta;
  onFix: () => void;
}

interface Props {
  baseline: TaskResult[];
  k: number;
  onK: (k: number) => void;
  status: PlanStatus;
  outcome?: PlanOutcome;
  error?: string;
  onPlan: () => void;
  fix: FixView;
}

const KS = [1, 2, 3, 4, 5];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FixPlanPanel({ baseline, k, onK, status, outcome, error, onPlan, fix }: Props) {
  const plan = outcome?.plan;
  const impacts = plan ? fixImpacts(plan, baseline) : [];
  const certified = plan ? fmtOptimality(plan.optimalityGap, exhaustivePoolSize(plan), plan.candidates.length, plan.k) : null;
  const run = fix.run;
  const running = run?.status === "running";
  const finished = run?.status === "done";
  const summary = run ? summarize(run) : null;
  const labels = taskLabels(fix.tasks);
  const manyTasks = fix.tasks.length > 1;

  // "Report copied" is spoken once and then gives way to the run's own messages again.
  const [copyNote, setCopyNote] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const say = (msg: string) => {
    setCopyNote(msg);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyNote(""), 3000);
  };
  const copyReport = async () => {
    if (!run?.report) return;
    try {
      await navigator.clipboard.writeText(reportMarkdown(run.report, fix.meta));
      say("Report copied");
    } catch {
      say("Couldn’t copy the report. Download the patch instead.");
    }
  };

  const runView = (fixId: string, index: number): RunView | undefined => {
    if (!run) return undefined;
    const outcomeOf = run.outcomes[fixId];
    return { outcome: outcomeOf, chips: personaChips(outcomeOf?.checks, previousChecks(run, index)), page: fix.page, taskLabels: labels, manyTasks };
  };

  const fixLabel = running ? "Fixing…" : finished ? "Fix again" : "Fix this page";

  return (
    <section aria-labelledby="plan-h" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-xl">
          <h2 id="plan-h" className="h-card">
            The smallest set of fixes that wins the most seconds back
          </h2>
          <p className="mt-1 text-sm text-muted">
            Detour re-times the page after each candidate fix and keeps the ones that save the most time for keyboard and screen-reader users.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Number of fixes</legend>
            <div className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
              {KS.map((n) => (
                <label key={n} className="relative">
                  <input type="radio" name="plan-k" value={n} checked={k === n} onChange={() => onK(n)} className="peer sr-only" />
                  <span className="tnum grid size-10 cursor-pointer place-items-center rounded border border-transparent text-sm font-medium text-ink transition-colors hover:bg-paper-2 peer-checked:border-ink peer-checked:bg-lime peer-checked:font-semibold peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                    {n}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {/* The one primary: planning until there is a plan, then fixing the page. */}
          <button
            type="button"
            className={`btn max-sm:min-h-11 ${status === "ready" ? "" : "btn-primary"}`}
            onClick={onPlan}
            disabled={status === "loading" || running}
            aria-busy={status === "loading"}
          >
            {status === "loading" ? "Planning…" : status === "ready" ? "Plan again" : "Plan fixes"}
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </div>

      {/* Polite messages: each fix as it settles, the end of the run, and the copy confirmation. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copyNote || run?.announce || ""}
      </p>

      {status === "error" && (
        <p role="alert" className="mt-6 rounded-md border border-blocked bg-surface p-3 text-blocked">
          Could not plan fixes: {error}
        </p>
      )}

      {status === "ready" && plan && (
        <div className="mt-6">
          {plan.chosen.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-rule bg-paper p-4">
              <CheckIcon size={18} className="mt-1 shrink-0" />
              <p>
                <span className="font-semibold">Nothing worth fixing.</span> No candidate fix saves a measurable amount of time for these tasks on this
                page. Detour does not invent problems.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="inline-flex items-center gap-1.5 rounded bg-lime px-2 py-1 text-[0.8125rem] font-medium leading-snug text-ink">
                  {certified ? <CheckIcon size={14} /> : null}
                  {certified ?? "Greedy plan. Exhaustive certification runs for up to 3 fixes."}
                </p>
                <p className="tnum text-[0.8125rem] text-muted">
                  {plan.chosen.length} of {plan.candidates.length} candidates · {plan.evaluations} model runs · objective{" "}
                  {Math.round(plan.baselineObjective)} → {Math.round(plan.plannedObjective)} s
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                {fix.available ? (
                  <>
                    <button
                      type="button"
                      className={`btn max-sm:min-h-11 ${finished || running ? "" : "btn-primary"}`}
                      onClick={fix.onFix}
                      disabled={running}
                      aria-busy={running}
                    >
                      {fixLabel}
                      <ArrowRightIcon size={16} />
                    </button>
                    <p className="max-w-xl text-sm text-muted">
                      Agents write each edit on the live page in the preview. Detour then re-reads the page and re-times all three people.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted">Fixing needs the live page.</p>
                )}
              </div>

              {run?.status === "error" && (
                <p role="alert" className="mt-4 rounded-md border border-blocked bg-surface p-3 text-sm text-blocked">
                  Couldn’t fix the page: {run.error}
                </p>
              )}

              {run && summary && run.status !== "error" && (
                <div role="group" aria-label="Fix results" className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-rule bg-paper px-4 py-3">
                  <div className="min-w-0 text-sm">
                    {finished ? (
                      <>
                        <p>
                          <strong className="tnum text-lg font-semibold">
                            {summary.proven} of {summary.total} proven
                          </strong>
                          <span className="text-muted">
                            {" "}
                            · <span className="tnum">{layoutSentence(run.layout)}</span>
                            {summary.wordingTotal > 0 && <> · {wordingSentence(summary)}</>}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[0.8125rem] text-muted">
                          Re-checked on the fixed page: the same model, run on the page as it is now. A fix is proven when it matches what the plan predicted.
                        </p>
                        {run.layout && run.layout.moved.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[0.8125rem] font-medium">Which elements moved</summary>
                            <ul className="mt-1 space-y-0.5 font-mono text-[0.8125rem] text-muted">
                              {movedLines(run.layout).map((l) => (
                                <li key={l}>{l}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">
                          Fixing {run.ids.length} edit{run.ids.length === 1 ? "" : "s"} on the page
                        </p>
                        <span aria-hidden="true" className="mt-1.5 block h-4 w-64 max-w-full rounded border border-rule bg-paper-2" />
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-sm max-sm:min-h-11"
                      disabled={!finished || !run.report}
                      onClick={() => run.report && download("detour-patch.txt", patchText(run.report, fix.meta))}
                    >
                      Download patch
                    </button>
                    <button type="button" className="btn btn-sm max-sm:min-h-11" disabled={!finished || !run.report} onClick={() => void copyReport()}>
                      Copy report
                    </button>
                    <span aria-hidden="true" className="min-w-[6.5rem] text-[0.8125rem] text-muted">
                      {copyNote}
                    </span>
                  </div>
                </div>
              )}

              <ol className="mt-4 space-y-3" aria-label="Chosen fixes, best first">
                {plan.chosen.map((f, i) => (
                  <FixCard key={f.id} fix={f} rank={i + 1} impact={impacts.find((x) => x.fixId === f.id)} run={runView(f.id, i)} />
                ))}
              </ol>

              {run && run.wording.length > 0 && run.status !== "error" && (
                <>
                  <h3 className="mt-6 text-[0.9375rem] font-semibold">Verified wording, applied in the same run</h3>
                  <ol className="mt-2 space-y-3" aria-label="Verified wording edits">
                    {run.wording.map((w, j) => {
                      const view = runView(w.fixId, run.planCount + j);
                      return view ? <WordingCard key={w.fixId} edit={w} run={view} /> : null;
                    })}
                  </ol>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
