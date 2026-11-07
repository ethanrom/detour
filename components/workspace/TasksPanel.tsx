"use client";

import { useId, useState } from "react";
import { CustomTaskBox } from "@/components/analyze/CustomTaskBox";
import type { Task, TaskResult } from "@/lib/contracts";
import { PERSONA_ORDER } from "@/lib/ui/timeline";
import { PickBox } from "./PickBox";
import { Bars, Disclosure, GroupLabel, Panel, PersonaTime } from "./ui";
import { useMediaQuery } from "./useMediaQuery";
import type { WorkbenchApi } from "./useWorkbench";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Fewer tasks than this and the list is never capped. */
const LIMIT = 5;
const LIMIT_NARROW = 3;

/** One task as one row: a button named by its label (the whole row is its click target), and what each person gets. */
function TaskRow({ task, result, selected, busy, disabled, onRun }: { task: Task; result?: TaskResult; selected: boolean; busy: boolean; disabled: boolean; onRun: () => void }) {
  const chipsId = useId();
  const verb = busy ? "Analyzing…" : selected && result ? "Run again" : "Run";
  return (
    <li
      className={cx(
        "relative rounded-lg has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-accent",
        selected ? "bg-lime" : "has-[:enabled:hover]:bg-paper-2",
      )}
    >
      {/* The button holds only the label, so its name ("Run: <label>") contains the visible text. Its ::after stretches
          over the row; the chips sit above it and let clicks through. */}
      <button
        type="button"
        aria-label={`${verb}: ${task.label}`}
        aria-describedby={result ? chipsId : undefined}
        aria-busy={busy}
        disabled={disabled}
        onClick={onRun}
        className="flex min-h-11 w-full px-3 py-2.5 text-left outline-none! after:absolute after:inset-0 after:rounded-lg disabled:cursor-wait"
      >
        <span className="line-clamp-2 text-sm font-medium leading-5">{task.label}</span>
      </button>
      {result && (
        <div id={chipsId} className="pointer-events-none relative -mt-1 flex flex-wrap gap-1 px-3 pb-2.5">
          {PERSONA_ORDER.map((p) => (
            <PersonaTime key={p} persona={p} seconds={result.personas[p].blocked ? null : result.personas[p].seconds} />
          ))}
        </div>
      )}
    </li>
  );
}

export function TasksPanel({ wb }: { wb: WorkbenchApi }) {
  const { site, groups, results, taskId, busyId, isUrl, pick, custom, ready } = wb;
  const narrow = useMediaQuery("(max-width: 1023.98px)");
  const [showAll, setShowAll] = useState(false);

  // The list is capped (5 on a wide screen, 3 on a narrow one). The task being shown always stays in it.
  const all = groups.flatMap((g) => g.tasks);
  const limit = narrow ? LIMIT_NARROW : LIMIT;
  const visible = new Set(showAll ? all.map((t) => t.id) : [...all.slice(0, limit).map((t) => t.id), ...(taskId ? [taskId] : [])]);
  const capped = all.length > limit;

  const showPick = isUrl;
  const footer =
    showPick || custom.available ? (
      <div className="-m-1 max-h-[55dvh] space-y-3 overflow-auto p-1">
        {showPick && (
          <PickBox
            page={ready?.page}
            picking={pick.active}
            onPicking={pick.setActive}
            hovered={pick.hovered}
            onChoose={(id) => void pick.choose(id)}
            onActive={pick.onHighlight}
            message={pick.message}
            busy={busyId !== null}
          />
        )}
        {custom.available && site && (
          <Disclosure summary="Describe a task">
            {/* The existing grounded free-text box, without its card frame and heading. */}
            <div className="[&_h3]:sr-only [&>section]:rounded-none [&>section]:border-0! [&>section]:bg-transparent! [&>section]:p-0!">
              <CustomTaskBox key={`custom-${site.id}`} state={custom.state} page={ready?.page} busy={busyId !== null} onSubmit={custom.run} />
            </div>
          </Disclosure>
        )}
      </div>
    ) : undefined;

  return (
    <Panel title="Tasks" footer={footer} bodyClassName="p-2">
      {wb.loadError ? (
        <p role="alert" className="m-2 text-sm text-blocked">
          Could not load the list of pages: {wb.loadError}
        </p>
      ) : !wb.sites || !site ? (
        <div role="status" className="p-2">
          <span className="sr-only">Loading pages…</span>
          <Bars widths={["80%", "55%", "70%"]} />
        </div>
      ) : (
        <div className="space-y-4">
          {wb.analysisError && (
            <p role="alert" className="mx-2 mt-2 text-sm text-blocked">
              Analysis failed: {wb.analysisError}
              {isUrl && " Check that the page loads in the preview, or try another address."}
            </p>
          )}
          {wb.thinPage !== null && (
            <p role="status" className="mx-2 mt-2 text-sm">
              <strong>This page renders almost nothing without JavaScript; try a server-rendered page.</strong> Detour found only {wb.thinPage} thing
              {wb.thinPage === 1 ? "" : "s"} to read or press, so any time it predicts here says little about the real page.
            </p>
          )}
          {groups.length === 0 ? (
            <p className="m-2 max-w-[48ch] text-sm text-muted">
              {wb.suggesting ? (
                <>
                  <span className="font-medium text-ink">Looking for controls some people can’t use…</span> Suggested tasks show up here.
                </>
              ) : (
                "No tasks yet. Pick a target on the page or describe one."
              )}
            </p>
          ) : (
            groups.map((g) => {
              const rows = g.tasks.filter((t) => visible.has(t.id));
              if (rows.length === 0) return null;
              return (
                <div key={g.id}>
                  <div className="px-3">
                    <GroupLabel id={`tasks-${g.id}`}>{g.label}</GroupLabel>
                  </div>
                  <ul aria-labelledby={`tasks-${g.id}`} className="divide-y divide-rule">
                    {rows.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        result={results?.find((r) => r.taskId === t.id)}
                        selected={t.id === taskId}
                        busy={t.id === busyId}
                        disabled={busyId !== null}
                        onRun={() => wb.run(t.id)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
          {capped && (
            <button type="button" className="mx-3 text-sm font-medium underline underline-offset-2" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
