"use client";

import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import type { TaskResult } from "@/lib/contracts";
import { fixImpacts } from "@/lib/ui/compare";
import { exhaustivePoolSize } from "@/lib/fixes";
import type { PlanOutcome } from "@/lib/ui/datasource";
import { fmtOptimality } from "@/lib/ui/format";
import { FixCard } from "./FixCard";

export type PlanStatus = "idle" | "loading" | "ready" | "error";

interface Props {
  baseline: TaskResult[];
  k: number;
  onK: (k: number) => void;
  status: PlanStatus;
  outcome?: PlanOutcome;
  error?: string;
  applied: boolean;
  onPlan: () => void;
  onApply: () => void;
}

const KS = [1, 2, 3, 4, 5];

export function FixPlanPanel({ baseline, k, onK, status, outcome, error, applied, onPlan, onApply }: Props) {
  const plan = outcome?.plan;
  const impacts = plan ? fixImpacts(plan, baseline) : [];
  const certified = plan ? fmtOptimality(plan.optimalityGap, exhaustivePoolSize(plan), plan.candidates.length, plan.k) : null;
  const exactlyOptimal = plan?.optimalityGap !== undefined && Math.abs(plan.optimalityGap) < 1e-9;

  return (
    <section aria-labelledby="plan-h" className="card p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-xl">
          <p className="eyebrow">Fix plan</p>
          <h2 id="plan-h" className="h-section mt-2">
            The smallest set of fixes that wins the most seconds back
          </h2>
          <p className="mt-2 text-muted">
            Detour re-measures the page after each candidate fix and keeps the ones that save the most time for keyboard and screen-reader users.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-bold">Number of fixes</legend>
            <div className="inline-flex rounded-full border-2 border-ink bg-surface p-0.5">
              {KS.map((n) => (
                <label key={n} className="relative">
                  <input
                    type="radio"
                    name="plan-k"
                    value={n}
                    checked={k === n}
                    onChange={() => onK(n)}
                    className="peer sr-only"
                  />
                  <span className="grid size-9 cursor-pointer place-items-center rounded-full text-sm font-bold text-ink transition-colors hover:bg-paper-2 peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-focus-visible:shadow-[0_0_0_6px_var(--lime)]">
                    {n}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" className="btn btn-primary" onClick={onPlan} disabled={status === "loading"} aria-busy={status === "loading"}>
            {status === "loading" ? "Planning…" : status === "ready" ? "Plan again" : "Plan fixes"}
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </div>

      {status === "error" && (
        <p role="alert" className="mt-6 rounded-lg border border-blocked bg-surface p-3 text-blocked">
          Could not plan fixes: {error}
        </p>
      )}

      {status === "ready" && plan && (
        <div className="mt-8">
          {plan.chosen.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border-2 border-ink bg-lime/40 p-5">
              <CheckIcon size={22} className="mt-0.5 shrink-0" />
              <p>
                <strong>Nothing worth fixing.</strong> No candidate fix saves a measurable amount of time on this page. That is the answer
                a control page should get.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {certified && (
                  <p
                    className={`inline-flex items-center gap-2 rounded-full border-2 border-ink px-3.5 py-1.5 text-sm font-bold ${
                      exactlyOptimal ? "bg-lime" : "bg-surface"
                    }`}
                  >
                    <CheckIcon size={16} />
                    {certified}
                  </p>
                )}
                {!certified && (
                  <p className="inline-flex items-center rounded-full border-2 border-ink bg-surface px-3.5 py-1.5 text-sm font-bold">
                    Greedy plan. Exhaustive certification runs for up to 3 fixes.
                  </p>
                )}
                <p className="font-mono text-xs text-muted">
                  {plan.chosen.length} of {plan.candidates.length} candidates · {plan.evaluations} model runs · objective{" "}
                  {Math.round(plan.baselineObjective)} → {Math.round(plan.plannedObjective)} s
                </p>
              </div>

              <ol className="mt-5 space-y-4" aria-label="Chosen fixes, best first">
                {plan.chosen.map((fix, i) => (
                  <FixCard key={fix.id} fix={fix} rank={i + 1} impact={impacts.find((x) => x.fixId === fix.id)} defaultOpen={i === 0} />
                ))}
              </ol>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button type="button" className="btn btn-primary" onClick={onApply}>
                  {applied ? "Replay before and after" : "Apply plan"}
                  <ArrowRightIcon size={16} />
                </button>
                <p className="text-sm text-muted">Applies the fixes to the page model and races all three users again.</p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
