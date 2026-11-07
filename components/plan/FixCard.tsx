import type { FixSpec } from "@/lib/contracts";
import { describeImpact, type FixImpact } from "@/lib/ui/compare";
import { fmtNum } from "@/lib/ui/format";
import { DiffView } from "./DiffView";

interface Props {
  fix: FixSpec;
  rank: number;
  impact?: FixImpact;
  defaultOpen?: boolean;
}

export function FixCard({ fix, rank, impact, defaultOpen }: Props) {
  const d = impact ? describeImpact(impact) : { savings: [] as string[], unblocks: [] as string[] };
  const seconds = impact?.seconds ?? 0;
  const unblocks = d.unblocks.length > 0;
  return (
    <li className="card grid gap-x-4 gap-y-3 p-4 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:p-5">
      {/* A rank is data: a plain number, no badge. */}
      <span aria-hidden="true" className="tnum text-lg font-semibold leading-snug text-muted max-sm:hidden">
        {rank}.
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="h-card">
            <span className="sr-only">Fix {rank}: </span>
            {fix.title}
          </h3>
          <span className="rounded bg-paper-2 px-1.5 py-0.5 text-[0.8125rem] text-muted">{fix.kind}</span>
        </div>
        <p className="mt-1.5 max-w-prose text-[0.9375rem] leading-relaxed text-muted">{fix.rationale}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="WCAG 2.2 success criteria">
          {fix.wcag.map((w) => (
            <li key={w} className="rounded border border-rule-strong px-2 py-0.5 text-[0.8125rem] font-medium">
              WCAG <span className="tnum">{w}</span>
            </li>
          ))}
        </ul>
        <details className="mt-3" open={defaultOpen}>
          <summary className="cursor-pointer text-sm font-medium">Code change</summary>
          <div className="mt-2">
            <DiffView patch={fix.patch} />
          </div>
        </details>
      </div>
      <div className="sm:text-right">
        <p className="tnum text-2xl font-semibold leading-none">
          {seconds >= 0.5 ? `−${fmtNum(seconds)} s` : unblocks ? "Unblocks" : "–"}
        </p>
        <p className="mt-1 text-[0.8125rem] text-muted">{seconds >= 0.5 ? "saved across tasks" : unblocks ? "a persona that could not finish" : "no measurable gain"}</p>
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
    </li>
  );
}
