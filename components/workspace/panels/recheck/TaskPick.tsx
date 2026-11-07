"use client";

import type { Task } from "@/lib/contracts";
import { Segmented } from "../../ui";

/** Up to four short task names fit a segmented control; anything else (more tasks, or sentences) is a select. */
const MAX_SEGMENTS = 4;
const MAX_SEGMENT_CHARS = 48;

export function TaskPick({ tasks, value, onChange }: { tasks: Task[]; value: string; onChange: (taskId: string) => void }) {
  if (tasks.length < 2) return <p className="text-sm font-medium">{tasks[0]?.label}</p>;

  const chars = tasks.reduce((n, t) => n + t.label.length, 0);
  if (tasks.length <= MAX_SEGMENTS && chars <= MAX_SEGMENT_CHARS) {
    return <Segmented label="Task to race" name="recheck-task" value={value} onChange={onChange} options={tasks.map((t) => ({ value: t.id, label: t.label }))} />;
  }
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="shrink-0 font-medium">Task</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-2 text-sm text-ink"
      >
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
