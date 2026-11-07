"use client";

// The Plan step (spec: internal/ui-v2-spec.md §3): one line that says what the plan wins back, the number of fixes,
// the chosen fixes with what each is predicted to do, and the verified wording as one row. No primary button:
// "Plan fixes" and "Fix this page" live in the step rail.

import { exhaustivePoolSize } from "@/lib/fixes";
import { fmtOptimality } from "@/lib/ui/format";
import type { PlanPanelProps } from "../contract";
import { Bars, Panel, Segmented } from "../ui";
import { FixList } from "./plan/FixList";
import { penaltyNote, planSentence, wordingCounts } from "./plan/summary";
import { WordingRow } from "./plan/WordingRow";

const KS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const block = "rounded bg-paper-2";

// Every branch below puts this group in a wrapper with the same key, so React keeps the radios (and the focus on
// them) when a new number of fixes clears the plan and the panel switches from its "plan" branch to its "idle" one.
function NumberOfFixes({ k, onK }: { k: number; onK: (k: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="text-sm font-medium">
        Number of fixes
      </span>
      <Segmented label="Number of fixes" name="plan-k" options={KS} value={k} onChange={onK} />
    </div>
  );
}

/** Grey rows at the size of the real ones: a two-line title, a meta line and a chip. */
function PlanSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true">
      <div className={`h-7 w-4/5 ${block}`} />
      <Bars widths={["60%"]} className="mt-2" />
      <div className="mt-4 h-9 w-72 max-w-full rounded-md bg-paper-2" />
      <div className="mt-3 divide-y divide-rule">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-[68px] items-start gap-3 py-2.5">
            <Bars widths={["85%", "35%"]} className="flex-1 pt-1.5" />
            <div className={`h-[22px] w-28 rounded-full ${block}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanPanel({ headingRef, status, outcome, error, baseline, k, onK, repair, page, task }: PlanPanelProps) {
  const plan = status === "ready" ? outcome?.plan : undefined;
  const wording = repair?.status === "ready" ? repair.report : null;

  let body;
  if (status === "loading") {
    body = (
      <>
        <p role="status" className="sr-only">
          Planning fixes…
        </p>
        <PlanSkeleton rows={k} />
      </>
    );
  } else if (status === "error") {
    body = (
      <>
        <p role="alert" className="text-sm leading-5">
          <span className="font-semibold">Could not plan fixes.</span> {error ? `${error} ` : ""}Use the plan button above to try again.
        </p>
        <div key="number-of-fixes" className="mt-4">
          <NumberOfFixes k={k} onK={onK} />
        </div>
      </>
    );
  } else if (plan && plan.chosen.length === 0) {
    body = (
      <>
        <p className="text-xl font-semibold leading-7">Nothing worth fixing.</p>
        <p className="mt-1 max-w-[60ch] text-sm leading-5 text-muted">
          No candidate fix saves a measurable amount of time for these tasks on this page. Detour does not invent problems.
        </p>
        <div key="number-of-fixes" className="mt-4">
          <NumberOfFixes k={k} onK={onK} />
        </div>
      </>
    );
  } else if (plan) {
    const certificate = fmtOptimality(plan.optimalityGap, exhaustivePoolSize(plan), plan.candidates.length, plan.k);
    const penalty = penaltyNote(baseline);
    body = (
      <>
        <p className="text-xl font-semibold leading-7">{planSentence(plan)}</p>
        <p className="mt-1 text-xs leading-4 text-muted">
          {certificate ? `${certificate}.` : "Greedy plan. Exhaustive certification runs for up to 3 fixes."}
          {penalty ? ` ${penalty}` : ""}
        </p>
        <div key="number-of-fixes" className="mt-4">
          <NumberOfFixes k={k} onK={onK} />
        </div>
        <div className="mt-3">
          <FixList plan={plan} baseline={baseline} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="max-w-[60ch] text-sm leading-5">
          Detour tries each candidate fix on this page and keeps the few that win the most seconds back for keyboard and screen-reader users. Choose how many,
          then press Plan fixes in the step rail above.
        </p>
        <div key="number-of-fixes" className="mt-4">
          <NumberOfFixes k={k} onK={onK} />
        </div>
      </>
    );
  }

  return (
    <Panel title="The plan" headingRef={headingRef}>
      <div className="relative text-sm leading-5">
        {body}
        {status !== "loading" && wordingCounts(wording) !== "" && (
          <div className={plan && plan.chosen.length > 0 ? "border-t border-rule" : "mt-4"}>
            <WordingRow report={wording} page={page} story={repair?.story ?? null} taskId={task?.id} />
          </div>
        )}
        {status !== "loading" && repair?.status === "loading" && (
          <p role="status" className="mt-4 text-xs leading-4 text-muted">
            Checking heading and label suggestions…
          </p>
        )}
      </div>
    </Panel>
  );
}
