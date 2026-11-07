import { CheckIcon } from "@/components/icons";
import type { PageModel, Task } from "@/lib/contracts";
import type { RepairReport } from "@/lib/ui/datasource";
import { fmtNum, fmtSeconds } from "@/lib/ui/format";
import { renameChanges, type RenameStory } from "@/lib/ui/rename-story";

export type RepairStatus = "loading" | "ready" | "unavailable";

interface Props {
  status: RepairStatus;
  report?: RepairReport | null;
  page: PageModel;
  /** Per-task numbers for each accepted rename (lib/ui/rename-story). */
  story?: RenameStory[] | null;
  /** The task shown in the race: its numbers are the headline of every rename. */
  task?: Task;
}

const who = (source: "llm" | "fallback") => (source === "llm" ? "Claude" : "a rule-based fallback (no LLM)");

function nodeLabel(page: PageModel, id: string): string {
  const n = page.nodes[id];
  if (!n) return id;
  const hint = n.hints.visualLabel?.trim();
  return `${n.role === "generic" ? n.tag : n.role}${hint ? ` that looks like “${hint}”` : ""}`;
}

/** "The LLM proposes, the model verifies": renames are shown with the seconds the scent model says they save. */
export function RepairPanel({ status, report, page, story, task }: Props) {
  if (status === "unavailable") return null;
  if (status === "loading") {
    return (
      <section aria-labelledby="repair-h" className="card p-5 sm:p-6" aria-busy="true">
        <h2 id="repair-h" className="h-card">
          Heading and label suggestions
        </h2>
        <p role="status" className="mt-2 text-sm text-muted">
          Asking Claude for clearer headings, then checking each one against the scent model…
        </p>
      </section>
    );
  }
  if (!report) return null;

  const accepted = report.headings.filter((h) => h.accepted);
  const rejected = report.headings.filter((h) => !h.accepted);
  if (accepted.length === 0 && rejected.length === 0 && report.labels.length === 0) return null;
  const total = accepted.reduce((a, h) => a + Math.max(0, h.savedSeconds), 0);

  return (
    <section aria-labelledby="repair-h" className="card p-5 sm:p-6">
      <h2 id="repair-h" className="h-card">
        Heading and label suggestions
      </h2>
      <p className="mt-1 text-sm text-muted">
        The language model proposes wording. The scent model then re-runs the heading search with that wording and keeps the change only if it saves time.
        {report.promoted && " Verified on the page with its styled-as-heading text already promoted to real headings."}
      </p>

      {accepted.length > 0 && (
        <>
          <h3 className="mt-5 text-[0.9375rem] font-semibold">
            Accepted renames{total > 0 ? ` · ${fmtSeconds(total)} saved across all tasks` : ""}
          </h3>
          <ul className="mt-2 space-y-3">
            {accepted.map((h) => {
              const line = task ? story?.find((s) => s.nodeId === h.nodeId)?.lines.find((l) => l.taskId === task.id) : undefined;
              return (
              <li key={h.nodeId} className="rounded-lg border border-rule bg-paper p-3.5">
                <p className="flex items-start gap-2 font-semibold leading-snug">
                  <CheckIcon size={16} className="mt-1 shrink-0" />
                  <span>
                    “{h.original}” <span aria-hidden="true">→</span>
                    <span className="sr-only"> becomes </span> “{h.proposed}”
                  </span>
                </p>
                {task && line && (
                  <p className="tnum mt-2 pl-6 text-[0.9375rem]">
                    <strong>{task.label}</strong>
                    {renameChanges(line) ? (
                      <>
                        : realistic search {fmtNum(line.before)} s <span aria-hidden="true">→</span>
                        <span className="sr-only"> becomes </span> <strong>{fmtNum(line.after)} s</strong> (best case {fmtNum(line.best)} s)
                      </>
                    ) : line.after - line.before > 0.5 ? (
                      <>
                        : this rename makes it slightly slower (realistic search {fmtNum(line.before)} s <span aria-hidden="true">→</span>
                        <span className="sr-only"> becomes </span> {fmtNum(line.after)} s, best case {fmtNum(line.best)} s)
                      </>
                    ) : (
                      <>: this rename does not change it (realistic search stays {fmtNum(line.before)} s, best case {fmtNum(line.best)} s)</>
                    )}
                  </p>
                )}
                <p className="mt-1 pl-6 text-sm text-muted">
                  <span className="tnum">
                    All tasks together: {fmtNum(h.before)} s <span aria-hidden="true">→</span>
                    <span className="sr-only"> becomes </span> {fmtNum(h.after)} s
                  </span>{" "}
                  · proposed by {who(h.source)}, verified by the scent model
                </p>
              </li>
              );
            })}
          </ul>
        </>
      )}

      {rejected.length > 0 && (
        <details className="mt-4 rounded-lg border border-rule bg-paper p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {rejected.length} suggestion{rejected.length === 1 ? "" : "s"} rejected by the model
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {rejected.map((h) => (
              <li key={h.nodeId}>
                “{h.original}” <span aria-hidden="true">→</span>
                <span className="sr-only"> would become </span> “{h.proposed}” ·{" "}
                <span className="font-semibold">
                  rejected by the model: {h.savedSeconds < -0.05 ? `+${fmtNum(-h.savedSeconds)} s slower` : "no time saved"}
                </span>{" "}
                <span className="tnum text-muted">
                  ({fmtNum(h.before)} s <span aria-hidden="true">→</span>
                  <span className="sr-only"> would become </span> {fmtNum(h.after)} s)
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.labels.length > 0 && (
        <>
          <h3 className="mt-5 text-[0.9375rem] font-semibold">Accessible names for unlabeled controls</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {report.labels.map((l) => (
              <li key={l.nodeId}>
                <span className="text-muted">{nodeLabel(page, l.nodeId)}</span> <span aria-hidden="true">→</span>
                <span className="sr-only"> gets the name </span> <strong>“{l.proposed}”</strong>{" "}
                <span className="text-muted">· proposed by {who(l.source)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
