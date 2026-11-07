"use client";

/* eslint-disable react-hooks/set-state-in-effect -- dev-only page: it loads data in effects, like the old Workbench */

// Dev only: the Race and Plan panels with real data, each in a box of the centre column's size, so you can see
// that each one fits and scrolls inside. Delete with the rest of app/dev when the workspace shell is in.
//
//   /dev/race-plan?site=northwind&task=buy-m          sites: northwind, riverside, alpine
//   &w=684&h=824                                      box size (the centre column at 1440x900); 524x696 at 1280x800
//   &state=empty|loading                              the race panel without a result
//   &plan=idle|loading|error|auto                     the plan panel in another state (auto plans on load)
//   &recheck=1                                        a third box: compact Race with ghost + predicted (what Re-check uses)

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDataSource } from "@/components/DataSourceProvider";
import { Race, raceDuration } from "@/components/race/Race";
import { useRaceClock } from "@/components/race/useRaceClock";
import { RacePanel } from "@/components/workspace/panels/RacePanel";
import { PlanPanel } from "@/components/workspace/panels/PlanPanel";
import type { PlanStatus, RepairView } from "@/components/workspace/contract";
import type { SearchEstimate, TaskResult } from "@/lib/contracts";
import type { Analysis, PlanOutcome, SiteInfo } from "@/lib/ui/datasource";
import { buildRenameStory, hideSearchInsight, type RenameStory } from "@/lib/ui/rename-story";
import { PERSONA_ORDER, buildLane } from "@/lib/ui/timeline";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The planned page's results as the "after" race, the original as ghost, the plan's own numbers as the prediction. */
function RecheckDemo({ before, after }: { before: TaskResult; after: TaskResult }) {
  const lanes = useMemo(() => PERSONA_ORDER.map((p) => buildLane(after.personas[p])), [after]);
  const ghost = useMemo(() => PERSONA_ORDER.map((p) => buildLane(before.personas[p])), [before]);
  const clock = useRaceClock(raceDuration(lanes, ghost), after.taskId);
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <Race idBase="recheck" taskLabel={after.taskId} lanes={lanes} ghost={ghost} predicted={after} clock={clock} announcePrefix="After the fixes." compact />
    </div>
  );
}

function Page() {
  const q = useSearchParams();
  const siteId = q.get("site") ?? "northwind";
  const wantTask = q.get("task");
  const width = Number(q.get("w") ?? 684);
  const height = Number(q.get("h") ?? 824);
  const raceState = q.get("state");
  const planMode = q.get("plan") ?? "auto";

  const source = useDataSource();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const raceHeading = useRef<HTMLHeadingElement>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);

  const [site, setSite] = useState<SiteInfo | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string>();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(1);
  const [k, setK] = useState(3);
  const [plan, setPlan] = useState<{ status: PlanStatus; outcome?: PlanOutcome; error?: string }>({ status: "idle" });
  const [repair, setRepair] = useState<RepairView | null>(null);

  useEffect(() => {
    let alive = true;
    source
      .listSites()
      .then((list) => {
        const found = list.find((s) => s.id === siteId);
        if (!alive) return;
        if (!found) setError(`No site "${siteId}".`);
        else {
          setSite(found);
          setTaskId(wantTask && found.tasks.some((t) => t.id === wantTask) ? wantTask : (found.tasks[0]?.id ?? null));
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [source, siteId, wantTask]);

  // Read the page from the offscreen iframe and evaluate every task.
  useEffect(() => {
    if (!site) return;
    let alive = true;
    source.analyze(site, frameRef.current).then(
      (data) => alive && setAnalysis(data),
      (e) => alive && setError(errMsg(e)),
    );
    return () => {
      alive = false;
    };
  }, [site, source]);

  // The wording suggestions, verified by the scent model (cached for the demo sites).
  useEffect(() => {
    if (!site || !analysis || !source.suggestRepairs) return;
    let alive = true;
    setRepair({ status: "loading", story: null });
    source
      .suggestRepairs(site, analysis)
      .then((report) => {
        if (!alive) return;
        if (!report) return setRepair({ status: "unavailable", story: null });
        let story: RenameStory[] | null = null;
        try {
          story = buildRenameStory(analysis.page, site.tasks, report);
        } catch {
          story = null;
        }
        setRepair({ status: "ready", report, story });
      })
      .catch(() => alive && setRepair({ status: "unavailable", story: null }));
    return () => {
      alive = false;
    };
  }, [site, analysis, source]);

  const doPlan = useCallback(
    (n: number) => {
      if (!site || !analysis) return;
      setPlan({ status: "loading" });
      source.plan(site, analysis, n).then(
        (outcome) => setPlan({ status: "ready", outcome }),
        (e) => setPlan({ status: "error", error: errMsg(e) }),
      );
    },
    [site, analysis, source],
  );

  useEffect(() => {
    if (planMode === "auto" && analysis) doPlan(3);
    else if (planMode === "error") setPlan({ status: "error", error: "The engine stopped before it finished." });
    else if (planMode === "loading") setPlan({ status: "loading" });
  }, [analysis, planMode, doPlan]);

  const task = site?.tasks.find((t) => t.id === taskId) ?? null;
  const result: TaskResult | null = analysis?.results.find((r) => r.taskId === taskId) ?? null;
  const lanes = useMemo(() => (result ? PERSONA_ORDER.map((p) => buildLane(result.personas[p])) : null), [result]);
  const hideInsight = useCallback(
    (forTask: string, search: SearchEstimate) =>
      hideSearchInsight({ loading: repair?.status === "loading", story: repair?.story ?? null, taskId: forTask, search }),
    [repair],
  );

  const forceEmpty = raceState === "empty";
  const forceLoading = raceState === "loading" || (!analysis && !error);

  const box = { width, height } as const;
  return (
    <div className="min-h-screen bg-paper p-3 text-sm">
      {/* The page is read from here, offscreen, like the workspace's preview. */}
      {site && (
        <iframe
          ref={frameRef}
          title={`Source of ${site.name}`}
          src={site.path}
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", left: -10000, top: 0, width: 1280, height: 800, border: 0 }}
        />
      )}
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold">Race and Plan panels, real data</h1>
        <span className="text-xs text-muted">
          {site?.name ?? siteId} · box {width}×{height} · {analysis ? `${Object.keys(analysis.page.nodes).length} elements` : "reading the page…"}
        </span>
        {site && (
          <div role="group" aria-label="Task" className="flex flex-wrap gap-1">
            {site.tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn btn-sm"
                aria-pressed={t.id === taskId}
                onClick={() => {
                  setTaskId(t.id);
                  setRunKey((n) => n + 1);
                }}
              >
                {t.id}
              </button>
            ))}
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="mb-3 text-blocked">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div id="race-box" className="grid" style={{ ...box, gridTemplateRows: "minmax(0,1fr)" }}>
          <RacePanel
            headingRef={raceHeading}
            task={forceEmpty ? null : task}
            result={forceEmpty ? null : result}
            lanes={forceEmpty ? null : lanes}
            loading={forceLoading}
            runKey={runKey}
            isUrl={false}
            hideInsight={hideInsight}
          />
        </div>
        <div id="plan-box" className="grid" style={{ ...box, gridTemplateRows: "minmax(0,1fr)" }}>
          <PlanPanel
            headingRef={planHeading}
            status={plan.status}
            outcome={plan.outcome}
            error={plan.error}
            baseline={analysis?.results ?? []}
            k={k}
            onK={(n) => {
              setK(n);
              if (planMode === "auto") doPlan(n);
              else setPlan({ status: "idle" });
            }}
            repair={repair}
            page={analysis?.page ?? null}
            task={task}
          />
        </div>
        {q.get("recheck") && result && plan.outcome && (
          <div id="recheck-box" style={{ width }}>
            <RecheckDemo before={result} after={plan.outcome.results.find((r) => r.taskId === result.taskId) ?? result} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function RacePlanDevPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
