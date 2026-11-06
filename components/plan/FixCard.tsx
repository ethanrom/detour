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
    <li className="card grid gap-x-4 gap-y-3 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-full bg-ink font-serif text-xl font-bold text-lime"
      >
        {rank}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="h-card">
            <span className="sr-only">Fix {rank}: </span>
            {fix.title}
          </h3>
          <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-xs text-muted">{fix.kind}</code>
        </div>
        <p className="mt-1.5 max-w-prose text-[0.9375rem] leading-relaxed text-muted">{fix.rationale}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="WCAG 2.2 success criteria">
          {fix.wcag.map((w) => (
            <li key={w} className="rounded-full border border-ink px-2.5 py-0.5 text-xs font-semibold">
              WCAG {w}
            </li>
          ))}
        </ul>
        <details className="mt-3" open={defaultOpen}>
          <summary className="cursor-pointer text-sm font-bold">Code change</summary>
          <div className="mt-2">
            <DiffView patch={fix.patch} />
          </div>
        </details>
      </div>
      <div className="sm:text-right">
        <p className="tnum font-serif text-3xl font-bold leading-none">
          {seconds >= 0.5 ? `−${fmtNum(seconds)} s` : unblocks ? "Unblocks" : "–"}
        </p>
        <p className="mt-1 text-xs text-muted">{seconds >= 0.5 ? "saved across tasks" : unblocks ? "a persona that could not finish" : "no measurable gain"}</p>
        {(d.savings.length > 0 || unblocks) && (
          <ul className="mt-2 space-y-1 text-xs font-semibold">
            {unblocks &&
              d.unblocks.map((u) => (
                <li key={u} className="inline-block rounded bg-lime px-2 py-0.5 sm:block sm:w-fit sm:ml-auto">
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
