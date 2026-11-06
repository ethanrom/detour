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
}

function Chip({ result, persona }: { result: TaskResult; persona: PersonaId }) {
  const meta = PERSONAS.find((p) => p.id === persona)!;
  const pr = result.personas[persona];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: meta.tint, color: pr.blocked ? "var(--blocked)" : meta.color }}
    >
      {pr.blocked ? <CrossIcon size={12} /> : <PersonaIcon persona={persona} size={12} />}
      <span className="sr-only">{meta.label}: </span>
      <span className="tnum">{pr.blocked ? "Can’t finish" : fmtSeconds(pr.seconds)}</span>
    </span>
  );
}

export function TaskList({ tasks, results, selectedId, busyId, onRun }: Props) {
  return (
    <ul className="divide-y divide-rule rounded-xl border border-rule bg-surface">
      {tasks.map((t) => {
        const selected = t.id === selectedId;
        const busy = t.id === busyId;
        const result = results?.find((r) => r.taskId === t.id);
        return (
          <li
            key={t.id}
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-l-4 px-4 py-3 ${
              selected ? "border-ink bg-lime/30" : "border-transparent"
            }`}
          >
            <div className="min-w-0 flex-1 basis-56">
              <p className="font-semibold leading-snug">{t.label}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t.steps.length} step{t.steps.length === 1 ? "" : "s"}: {t.steps.map((s) => s.note ?? s.action).join(" → ")}
              </p>
              {result && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {PERSONAS.map((p) => (
                    <Chip key={p.id} result={result} persona={p.id} />
                  ))}
                </p>
              )}
            </div>
            <button
              type="button"
              className={`btn btn-sm ${selected ? "btn-primary" : ""}`}
              onClick={() => onRun(t.id)}
              disabled={busyId !== null}
              aria-busy={busy}
              aria-label={`${busy ? "Analyzing for" : "Run"}: ${t.label}`}
            >
              <PlayIcon size={14} />
              {busy ? "Analyzing…" : selected && result ? "Run again" : "Run"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
