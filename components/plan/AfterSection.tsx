"use client";

import { forwardRef, useMemo, useState } from "react";
import { SearchInsight } from "@/components/analyze/SearchInsight";
import { CheckIcon, PersonaIcon } from "@/components/icons";
import { Race, raceDuration } from "@/components/race/Race";
import { useRaceClock } from "@/components/race/useRaceClock";
import type { PersonaId, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { compareTask, describeComparison, type Change, type PersonaDelta } from "@/lib/ui/compare";
import { fmtPercentLess, fmtSeconds } from "@/lib/ui/format";
import { PERSONAS, PERSONA_BY_ID } from "@/lib/ui/personas";
import { searchInsight } from "@/lib/ui/search-insight";
import { buildLane, PERSONA_ORDER } from "@/lib/ui/timeline";

interface Props {
  tasks: Task[];
  before: TaskResult[];
  after: TaskResult[];
  taskId: string;
  onTask: (id: string) => void;
  /** Changes whenever a plan is (re)applied, to restart the race. */
  runKey: number;
  /** True when the separate realistic-search panel would contradict the Wording panel for this task. */
  hideInsight?: (taskId: string, search: SearchEstimate) => boolean;
}

function Headline({ d }: { d: PersonaDelta }) {
  const b = d.before.seconds;
  const a = d.after.seconds;
  if (d.change === "still-blocked") return <span className="text-blocked">Can’t finish</span>;
  if (d.change === "unblocked") return <>Can’t finish <span aria-hidden="true">→</span><span className="sr-only"> became </span> {fmtSeconds(a!)}</>;
  if (d.change === "newly-blocked") return <>{fmtSeconds(b!)} <span aria-hidden="true">→</span><span className="sr-only"> became </span> can’t finish</>;
  if (d.change === "same" && d.nearlySame) return <>{fmtSeconds(b!)} <span aria-hidden="true">→</span><span className="sr-only"> became </span> {fmtSeconds(a!)}</>;
  if (d.change === "same") return <>{fmtSeconds(a!)}</>;
  return <>{fmtSeconds(b!)} <span aria-hidden="true">→</span><span className="sr-only"> became </span> {fmtSeconds(a!)}</>;
}

const sameLabel = (d: PersonaDelta) => (d.nearlySame ? "about the same" : CHANGE_LABEL.same);

const CHANGE_LABEL: Record<Change, string> = {
  faster: "",
  slower: "slower",
  same: "no change",
  unblocked: "unblocked",
  "newly-blocked": "now blocked",
  "still-blocked": "still blocked",
};


function Tile({ d }: { d: PersonaDelta }) {
  const meta = PERSONA_BY_ID[d.persona];
  return (
    <div className="p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: meta.color }}>
        <PersonaIcon persona={d.persona} size={16} />
        {meta.label}
      </p>
      <p className="tnum mt-2 text-2xl font-semibold leading-tight">
        <Headline d={d} />
      </p>
      <p className="mt-2.5">
        {d.change === "faster" && (
          <span className="inline-flex items-center gap-1 rounded bg-lime px-2 py-0.5 text-sm font-medium">
            <CheckIcon size={14} /> <span className="tnum">{fmtPercentLess(d.before.seconds!, d.after.seconds!)}</span>
          </span>
        )}
        {d.change === "unblocked" && (
          <span className="inline-flex items-center gap-1 rounded bg-lime px-2 py-0.5 text-sm font-medium">
            <CheckIcon size={14} /> Unblocked
          </span>
        )}
        {d.change !== "faster" && d.change !== "unblocked" && (
          <span className="rounded border border-rule-strong px-2 py-0.5 text-sm text-muted">
            {d.change === "slower" ? `${fmtPercentLess(d.before.seconds!, d.after.seconds!)}` : d.change === "same" ? sameLabel(d) : CHANGE_LABEL[d.change]}
          </span>
        )}
      </p>
    </div>
  );
}

export const AfterSection = forwardRef<HTMLHeadingElement, Props>(function AfterSection(
  { tasks, before, after, taskId, onTask, runKey, hideInsight },
  headingRef,
) {
  const beforeTask = before.find((r) => r.taskId === taskId) ?? before[0];
  const afterTask = after.find((r) => r.taskId === beforeTask?.taskId) ?? after[0];
  const task = tasks.find((t) => t.id === beforeTask?.taskId);

  const lanes = useMemo(() => PERSONA_ORDER.map((p) => buildLane(afterTask.personas[p])), [afterTask]);
  const ghost = useMemo(() => PERSONA_ORDER.map((p) => buildLane(beforeTask.personas[p])), [beforeTask]);
  const duration = raceDuration(lanes, ghost);
  const deltas = compareTask(beforeTask, afterTask);
  const [openTable, setOpenTable] = useState(true);
  const found = searchInsight(afterTask.personas.screenreader);
  const insight = found && !hideInsight?.(afterTask.taskId, found) ? found : undefined;

  return (
    <section aria-labelledby="after-h" className="scroll-mt-24">
      <div className="card p-5 sm:p-6">
        <h2 id="after-h" ref={headingRef} tabIndex={-1} className="h-card outline-none">
          Same task, same three people, fewer seconds
        </h2>

        <div role="group" aria-label="Task to race" className="mt-4 flex flex-wrap gap-2">
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={t.id === task?.id}
              onClick={() => onTask(t.id)}
              className={`min-h-10 rounded-md border px-3.5 text-sm font-medium transition-colors max-sm:min-h-11 ${
                t.id === task?.id ? "border-ink bg-lime text-ink" : "border-rule-strong bg-surface text-ink hover:bg-paper-2"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid divide-y divide-rule overflow-hidden rounded-lg border border-rule md:grid-cols-3 md:divide-x md:divide-y-0">
          {deltas.map((d) => (
            <Tile key={d.persona} d={d} />
          ))}
        </div>
        <p className="sr-only">{describeComparison(task?.label ?? "", deltas)}</p>

        <div className="mt-6 border-t border-rule pt-5">
          <AfterRace
            key={`${runKey}-${afterTask.taskId}`}
            taskLabel={task?.label ?? ""}
            lanes={lanes}
            ghost={ghost}
            duration={duration}
          />
        </div>
      </div>

      {insight && (
        <div className="mt-6">
          <SearchInsight search={insight} taskLabel={task?.label ?? ""} idBase="after-search" context="After the fixes, for" />
        </div>
      )}

      <div className="card mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="h-card">Every task, before and after</h3>
          <button type="button" className="btn btn-sm max-sm:min-h-11" aria-expanded={openTable} onClick={() => setOpenTable((o) => !o)}>
            {openTable ? "Hide table" : "Show table"}
          </button>
        </div>
        {openTable && (
          <div className="relative mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <caption className="sr-only">Predicted time for each task and persona, before and after the fixes</caption>
              <thead>
                <tr className="border-b border-rule-strong text-[0.8125rem]">
                  <th scope="col" className="py-2 pr-3 font-medium text-muted">Task</th>
                  {PERSONAS.map((p) => (
                    <th key={p.id} scope="col" className="py-2 pl-3 text-right font-medium" style={{ color: p.color }}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const b = before.find((r) => r.taskId === t.id);
                  const a = after.find((r) => r.taskId === t.id);
                  if (!b || !a) return null;
                  const ds = compareTask(b, a);
                  return (
                    <tr key={t.id} className="border-b border-rule align-top">
                      <th scope="row" className="py-3 pr-3 font-medium">{t.label}</th>
                      {PERSONA_ORDER.map((pid: PersonaId) => {
                        const d = ds.find((x) => x.persona === pid)!;
                        return (
                          <td key={pid} className="tnum py-3 pl-3 text-right">
                            <span className="font-medium"><Headline d={d} /></span>
                            <span className="block text-[0.8125rem] text-muted">
                              {d.change === "faster" ? fmtPercentLess(d.before.seconds!, d.after.seconds!) : d.change === "slower" ? `▲ ${fmtPercentLess(d.before.seconds!, d.after.seconds!)}` : d.change === "same" ? sameLabel(d) : CHANGE_LABEL[d.change]}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
});

function AfterRace({ taskLabel, lanes, ghost, duration }: { taskLabel: string; lanes: ReturnType<typeof buildLane>[]; ghost: ReturnType<typeof buildLane>[]; duration: number }) {
  const clock = useRaceClock(duration);
  return (
    <>
      <h3 className="h-card mb-3">Before (ghost) and after (solid)</h3>
      <Race idBase="after" taskLabel={taskLabel} lanes={lanes} ghost={ghost} clock={clock} announcePrefix="After the fixes." />
    </>
  );
}
