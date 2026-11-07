"use client";

import { CrossIcon, PersonaIcon, PlayIcon } from "@/components/icons";
import type { PersonaId, Task, TaskResult } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { PERSONAS } from "@/lib/ui/personas";

interface Props {
  tasks: Task[];
  results?: TaskResult[];
  selectedId: string | null;
  /** Task whose Run is waiting on the analysis. */
  busyId: string | null;
  onRun: (taskId: string) => void;
  /** Label of the list for assistive technology, when the page has more than one (for example the suggested tasks). */
  label?: string;
  /** The first task is the page's one primary action until a task has been run. False for a second list. */
  primaryFirst?: boolean;
}

/** A small status chip: a pale persona tint with the persona's colour as text. 24px tall. */
function Chip({ result, persona }: { result: TaskResult; persona: PersonaId }) {
  const meta = PERSONAS.find((p) => p.id === persona)!;
  const pr = result.personas[persona];
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded px-2 text-[0.8125rem] font-medium"
      style={{ background: meta.tint, color: pr.blocked ? "var(--blocked)" : meta.color }}
    >
      {pr.blocked ? <CrossIcon size={14} /> : <PersonaIcon persona={persona} size={14} />}
      <span className="sr-only">{meta.label}: </span>
      <span className="tnum">{pr.blocked ? "Can’t finish" : fmtSeconds(pr.seconds)}</span>
    </span>
  );
}

export function TaskList({ tasks, results, selectedId, busyId, onRun, label, primaryFirst = true }: Props) {
  return (
    <ul aria-label={label} className="divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-surface">
      {tasks.map((t, i) => {
        const selected = t.id === selectedId;
        const busy = t.id === busyId;
        const result = results?.find((r) => r.taskId === t.id);
        const verb = busy ? "Analyzing…" : selected && result ? "Run again" : "Run";
        // The one primary: the first task until a task has been run; after that the next step (planning) is primary.
        const primary = primaryFirst && selectedId === null && i === 0;
        return (
          <li
            key={t.id}
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 ${selected ? "bg-lime" : ""}`}
          >
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-base font-semibold leading-snug">
                {t.label}
                {t.grounding === "llm" && (
                  <span className="ml-2 rounded bg-paper-2 px-1.5 py-0.5 align-middle text-[0.8125rem] font-medium text-ink-2">your task</span>
                )}
              </p>
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
                <span className="tnum">{t.steps.length}</span> step{t.steps.length === 1 ? "" : "s"}: {t.steps.map((s) => s.note ?? s.action).join(" → ")}
              </p>
              {result && (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {PERSONAS.map((p) => (
                    <Chip key={p.id} result={result} persona={p.id} />
                  ))}
                </p>
              )}
            </div>
            <button
              type="button"
              className={`btn btn-sm max-sm:min-h-11 ${primary ? "btn-primary" : ""}`}
              onClick={() => onRun(t.id)}
              disabled={busyId !== null}
              aria-busy={busy}
              aria-label={`${verb}: ${t.label}`}
            >
              <PlayIcon size={14} />
              {verb}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
