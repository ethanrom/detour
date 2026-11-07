"use client";

// "Same task, same three people, fewer seconds" (spec §3, Re-check): the model run again on the really fixed page.
// The task, three before → after numbers, the race with the old run as a ghost, and the other tasks behind a disclosure.

import type { SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { insightSentence, searchInsight } from "@/lib/ui/search-insight";
import type { RecheckPanelProps } from "../contract";
import { Disclosure, Empty, GroupLabel, Panel } from "../ui";
import { AfterRace } from "./recheck/AfterRace";
import { EveryTask } from "./recheck/EveryTask";
import { Strip } from "./recheck/Strip";
import { TaskPick } from "./recheck/TaskPick";

export function RecheckPanel({ headingRef, tasks, before, after, predicted, taskId, onTask, runKey, hideInsight }: RecheckPanelProps) {
  return (
    <Panel title="Same task, same three people, fewer seconds" headingRef={headingRef} className="h-full">
      {after ? (
        <Loaded tasks={tasks} before={before} after={after} predicted={predicted} taskId={taskId} onTask={onTask} runKey={runKey} hideInsight={hideInsight} />
      ) : (
        <Empty>Fix the page first. The re-check runs on the fixed page.</Empty>
      )}
    </Panel>
  );
}

function Loaded({ tasks, before, after, predicted, taskId, onTask, runKey, hideInsight }: {
  tasks: Task[];
  before: TaskResult[];
  after: TaskResult[];
  predicted: TaskResult[] | null;
  taskId: string;
  onTask: (taskId: string) => void;
  runKey: number;
  hideInsight: (taskId: string, search: SearchEstimate) => boolean;
}) {
  const b = before.find((r) => r.taskId === taskId) ?? before[0];
  const a = b ? (after.find((r) => r.taskId === b.taskId) ?? after[0]) : undefined;
  if (!b || !a) return <Empty>Fix the page first. The re-check runs on the fixed page.</Empty>;

  const task = tasks.find((t) => t.id === b.taskId);
  const pred = predicted?.find((r) => r.taskId === a.taskId);
  const found = searchInsight(a.personas.screenreader);
  const insight = found && !hideInsight(a.taskId, found) ? found : undefined;
  const sentence = insight ? insightSentence(insight) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Re-checked on the fixed page. Predicted seconds are shown in grey.</p>

      <TaskPick tasks={tasks} value={b.taskId} onChange={onTask} />

      <Strip before={b} after={a} predicted={pred} />

      <div>
        <GroupLabel>Before (ghost), re-checked (solid), predicted (mark)</GroupLabel>
        <AfterRace key={`${runKey}-${a.taskId}`} before={b} after={a} predicted={pred} taskLabel={task?.label ?? ""} />
      </div>

      {insight && (
        <p className="text-sm leading-5 text-muted">
          <span className="font-medium text-ink">Realistic search by headings, after the fixes: </span>
          <span className="tnum">{fmtSeconds(insight.seconds)}</span>
          <span> (best case, knowing where to go: </span>
          <span className="tnum">{fmtSeconds(insight.shortestSeconds)}</span>
          <span>).</span>
          {sentence && <> {sentence}</>}
        </p>
      )}

      <Disclosure summary="Every task, before and after">
        <EveryTask tasks={tasks} before={before} after={after} predicted={predicted} />
      </Disclosure>
    </div>
  );
}
