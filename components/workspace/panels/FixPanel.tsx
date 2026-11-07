"use client";

// "Fixes on the page" (spec §3, Fix): the answer first ("3 of 3 proven"), then one row per planned fix with its stage
// in words and the seconds re-checked on the fixed page. Wording edits are ONE collapsed row. Diffs live in the
// change drawer, never here. The panel has no primary button: the step rail owns "Fix this page" and "See the re-check".

import { useEffect, useRef, useState } from "react";
import { reportMarkdown } from "@/lib/livefix/export";
import { personaChips, previousChecks, taskLabels } from "@/lib/ui/fix-run";
import type { FixPanelProps } from "../contract";
import { Empty, Panel } from "../ui";
import { FixRow } from "./fix/FixRow";
import { Summary } from "./fix/Summary";
import { WordingRow } from "./fix/WordingRow";

export function FixPanel({ headingRef, available, outcome, run, tasks, meta, onFixAgain, onView }: FixPanelProps) {
  const finished = run?.status === "done";
  const labels = taskLabels(tasks);
  const manyTasks = tasks.length > 1;

  // "Report copied" is spoken once and then gives way to the run's own messages again.
  const [copyNote, setCopyNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (msg: string) => {
    setCopyNote(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyNote(""), 3000);
  };
  const copyReport = async () => {
    if (!run?.report) return;
    try {
      await navigator.clipboard.writeText(reportMarkdown(run.report, meta));
      say("Report copied");
    } catch {
      say("Couldn’t copy the report. Download the patch instead.");
    }
  };

  let body;
  if (!available) {
    body = <p className="text-sm text-muted">Fixing needs the live page.</p>;
  } else if (!run) {
    body = (
      <Empty>
        Fix this page runs one AI agent per planned fix on this page, then re-checks it. The button is in the step rail.
      </Empty>
    );
  } else if (run.status === "error") {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blocked p-3 text-sm">
        <p className="min-w-0 [overflow-wrap:anywhere]">Couldn’t fix the page: {run.error}</p>
        <button type="button" className="btn btn-sm" onClick={onFixAgain}>
          Try again
        </button>
      </div>
    );
  } else {
    // Plan fixes in plan order (the ids of the run), each with the title from the plan.
    const planIds = run.ids.slice(0, run.planCount);
    const specs = new Map((outcome?.plan.chosen ?? []).map((f) => [f.id, f]));
    body = (
      <div className="space-y-3">
        <Summary run={run} meta={meta} note={copyNote} onCopy={() => void copyReport()} />
        <div>
          <ol aria-label="Fix progress" className="divide-y divide-rule">
            {planIds.map((id, i) => {
              const o = run.outcomes[id];
              const title = specs.get(id)?.title ?? o?.title ?? id;
              return (
                <li key={id}>
                  <FixRow
                    title={title}
                    outcome={o}
                    chips={personaChips(o?.checks, previousChecks(run, i))}
                    manyTasks={manyTasks}
                    labels={labels}
                    onView={() => onView(id)}
                  />
                </li>
              );
            })}
          </ol>
          {run.wording.length > 0 && (
            <div className="border-t border-rule">
              <WordingRow run={run} onView={onView} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Panel
      title="Fixes on the page"
      headingRef={headingRef}
      className="h-full"
      actions={
        finished ? (
          <button type="button" className="btn btn-sm" onClick={onFixAgain}>
            Fix again
          </button>
        ) : undefined
      }
    >
      {/* Polite messages: each fix as it settles, the end of the run, and the copy confirmation. */}
      <p role="status" aria-live="polite" className="sr-only">
        {copyNote || run?.announce || ""}
      </p>
      {body}
    </Panel>
  );
}
