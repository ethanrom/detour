"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDataSource, useDataSourceMode } from "@/components/DataSourceProvider";
import { PersonaIcon } from "@/components/icons";
import { AfterSection } from "@/components/plan/AfterSection";
import { FixPlanPanel, type PlanStatus } from "@/components/plan/FixPlanPanel";
import { Race, raceDuration } from "@/components/race/Race";
import { Transcript } from "@/components/race/Transcript";
import { useRaceClock } from "@/components/race/useRaceClock";
import type { Task, TaskResult } from "@/lib/contracts";
import { LlmUnavailableError, type Analysis, type PlanOutcome, type RepairReport, type SiteInfo } from "@/lib/ui/datasource";
import { searchInsight } from "@/lib/ui/search-insight";
import { PERSONAS } from "@/lib/ui/personas";
import { PERSONA_ORDER, buildLane, type Lane } from "@/lib/ui/timeline";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import { CustomTaskBox, type CustomState } from "./CustomTaskBox";
import { RepairPanel, type RepairStatus } from "./RepairPanel";
import { SearchInsight } from "./SearchInsight";
import { SiteCards } from "./SiteCards";
import { SitePreview } from "./SitePreview";
import { TaskList } from "./TaskList";
import { WhyPanel } from "./WhyPanel";

type AnalysisState =
  | { siteId: string; status: "loading" }
  | { siteId: string; status: "ready"; data: Analysis }
  | { siteId: string; status: "error"; error: string };

interface PlanState {
  siteId: string;
  status: PlanStatus;
  outcome?: PlanOutcome;
  error?: string;
}

interface RepairState {
  key: string;
  status: RepairStatus;
  report?: RepairReport | null;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Workbench() {
  const source = useDataSource();
  const mode = useDataSourceMode();
  const reduced = useReducedMotion();

  const [sites, setSites] = useState<SiteInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [siteId, setSiteId] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [k, setK] = useState(3);
  const [plan, setPlan] = useState<PlanState>({ siteId: "", status: "idle" });
  const [applied, setApplied] = useState(false);
  const [applyKey, setApplyKey] = useState(0);
  const [afterTaskId, setAfterTaskId] = useState<string | null>(null);
  const [custom, setCustom] = useState<CustomState>({ siteId: "", status: "idle" });
  const [repair, setRepair] = useState<RepairState | null>(null);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const afterHeading = useRef<HTMLHeadingElement>(null);
  const liveSite = useRef("");

  useEffect(() => {
    let alive = true;
    source
      .listSites()
      .then((list) => {
        if (!alive) return;
        setSites(list);
        setSiteId((cur) => cur || list[0]?.id || "");
      })
      .catch((e) => alive && setLoadError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [source]);

  useEffect(() => {
    liveSite.current = siteId;
  }, [siteId]);

  const site = sites?.find((s) => s.id === siteId);
  const ready = analysis?.status === "ready" && analysis.siteId === siteId ? analysis.data : undefined;
  const planForSite = plan.siteId === siteId ? plan : { siteId, status: "idle" as PlanStatus };
  const outcome = planForSite.status === "ready" ? planForSite.outcome : undefined;
  const task: Task | undefined = site?.tasks.find((t) => t.id === taskId);
  const result: TaskResult | undefined = ready?.results.find((r) => r.taskId === taskId);

  const chooseSite = useCallback((id: string) => {
    setSiteId(id);
    setTaskId(null);
    setAnalysis(null);
    setPending(null);
    setApplied(false);
    setPlan({ siteId: id, status: "idle" });
  }, []);

  /** Read the page and evaluate every task of the site. Resolves with the analysis once it is on screen. */
  const startAnalysis = useCallback(
    (target: SiteInfo): Promise<Analysis> => {
      setAnalysis({ siteId: target.id, status: "loading" });
      return source.analyze(target, frameRef.current).then(
        (data) => {
          if (liveSite.current === target.id) setAnalysis({ siteId: target.id, status: "ready", data });
          return data;
        },
        (e) => {
          if (liveSite.current === target.id) setAnalysis({ siteId: target.id, status: "error", error: errMsg(e) });
          throw e;
        },
      );
    },
    [source],
  );

  const run = useCallback(
    (id: string) => {
      if (!site) return;
      setTaskId(id);
      if (ready) {
        setRunKey((n) => n + 1);
        return;
      }
      setPending(id);
      startAnalysis(site)
        .then(() => {
          if (liveSite.current !== site.id) return;
          setPending(null);
          setRunKey((n) => n + 1);
        })
        .catch(() => liveSite.current === site.id && setPending(null));
    },
    [site, ready, startAnalysis],
  );

  /** Ground a sentence on the page with the LLM, add the task to the site and run it. */
  const runCustom = useCallback(
    async (text: string) => {
      if (!site || !source.groundTask) return;
      const sid = site.id;
      const mine = (v: CustomState): void => {
        if (liveSite.current === sid) setCustom(v);
      };
      mine({ siteId: sid, status: "working", text });
      try {
        let data = ready;
        if (!data) {
          setPending("custom");
          try {
            data = await startAnalysis(site);
          } finally {
            if (liveSite.current === sid) setPending(null);
          }
        }
        const task = await source.groundTask(site, data, text);
        if (liveSite.current !== sid) return;
        const next: SiteInfo = { ...site, tasks: [...site.tasks.filter((t) => t.id !== task.id), task] };
        const withTask = source.addTask ? await source.addTask(next, data, task) : data;
        if (liveSite.current !== sid) return;
        setSites((list) => list?.map((s) => (s.id === sid ? next : s)) ?? list);
        setAnalysis({ siteId: sid, status: "ready", data: withTask });
        setPlan({ siteId: sid, status: "idle" });
        setApplied(false);
        setTaskId(task.id);
        setRunKey((n) => n + 1);
        mine({ siteId: sid, status: "done", text, task });
      } catch (e) {
        mine(e instanceof LlmUnavailableError ? { siteId: sid, status: "unavailable", text } : { siteId: sid, status: "error", text, error: errMsg(e) });
      }
    },
    [site, ready, source, startAnalysis],
  );

  const doPlan = useCallback(() => {
    if (!site || !ready) return;
    setApplied(false);
    setPlan({ siteId: site.id, status: "loading" });
    source
      .plan(site, ready, k)
      .then((o) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "ready", outcome: o }))
      .catch((e) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "error", error: errMsg(e) }));
  }, [site, ready, source, k]);

  const apply = useCallback(() => {
    setApplied(true);
    setApplyKey((n) => n + 1);
    setAfterTaskId(taskId);
  }, [taskId]);

  // Move to the before/after section when a plan is applied.
  useEffect(() => {
    if (applyKey === 0) return;
    const h = afterHeading.current;
    if (!h) return;
    h.focus({ preventScroll: true });
    (h.closest("section") ?? h).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [applyKey, reduced]);

  // Heading and label suggestions: the server asks the LLM for wording and the scent model verifies it.
  const readyPage = ready?.page;
  const taskKey = site?.tasks.map((t) => t.id).join("|") ?? "";
  const repairKey = site && readyPage ? `${site.id}|${taskKey}` : "";
  useEffect(() => {
    if (!repairKey || !site || !ready || !source.suggestRepairs) return;
    let alive = true;
    setRepair({ key: repairKey, status: "loading" });
    source
      .suggestRepairs(site, ready)
      .then((report) => alive && setRepair({ key: repairKey, status: report ? "ready" : "unavailable", report }))
      .catch(() => alive && setRepair({ key: repairKey, status: "unavailable" }));
    return () => {
      alive = false;
    };
    // `site` and `ready` are captured on purpose: re-run only when the page or the task list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairKey, source]);

  const lanes = useMemo<Lane[] | null>(() => (result ? PERSONA_ORDER.map((p) => buildLane(result.personas[p])) : null), [result]);

  if (loadError) {
    return (
      <p role="alert" className="rounded-lg border border-blocked bg-surface p-4 text-blocked">
        Could not load the list of pages: {loadError}
      </p>
    );
  }
  if (!sites || !site) {
    return (
      <p role="status" className="text-muted">
        Loading pages…
      </p>
    );
  }

  const left = (
    <div className="space-y-5">
      <div>
        <h2 className="h-card">2 · Pick a task</h2>
        <p className="mt-1 text-sm text-muted">Each task is a short chain of steps on the page.</p>
      </div>
      <SitePreview key={site.id} site={site} frameRef={frameRef} />
      <TaskList tasks={site.tasks} results={ready?.results} selectedId={taskId} busyId={pending} onRun={run} />
      {source.groundTask && (
        <CustomTaskBox
          key={`custom-${site.id}`}
          state={custom.siteId === site.id ? custom : { siteId: site.id, status: "idle" }}
          page={ready?.page}
          busy={pending !== null}
          onSubmit={runCustom}
        />
      )}
      {analysis?.status === "error" && analysis.siteId === siteId && (
        <p role="alert" className="rounded-lg border border-blocked bg-surface p-3 text-sm text-blocked">
          Analysis failed: {analysis.error}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="pick-h">
        <h2 id="pick-h" className="h-card mb-3">
          1 · Choose a page
        </h2>
        <SiteCards sites={sites} value={siteId} onChange={chooseSite} />
        {(ready?.mode ?? mode) === "sample" ? (
          <p className="mt-3 text-sm text-muted">
            <strong className="text-ink">Sample data.</strong> Times on this screen come from hand-calibrated fixtures
            {ready?.fallbackReason ? ` because the live page could not be read (${ready.fallbackReason})` : ", not the live engine"}.
          </p>
        ) : (
          ready && (
            <p className="mt-3 text-sm text-muted">
              <strong className="text-ink">Measured live.</strong> Read {Object.keys(ready.page.nodes).length} elements from the rendered page, with their real positions
              and sizes.
            </p>
          )
        )}
      </section>

      <Stage
        resetKey={`${site.id}-${taskId ?? "none"}-${runKey}`}
        left={left}
        lanes={lanes}
        result={result}
        taskLabel={task?.label ?? ""}
        loading={analysis?.status === "loading" && analysis.siteId === siteId}
      />

      {ready && repair?.key === repairKey && <RepairPanel status={repair.status} report={repair.report} page={ready.page} />}

      {ready && (
        <FixPlanPanel
          baseline={ready.results}
          k={k}
          onK={setK}
          status={planForSite.status}
          outcome={outcome}
          error={planForSite.error}
          applied={applied}
          onPlan={doPlan}
          onApply={apply}
        />
      )}

      {ready && outcome && applied && (
        <AfterSection
          ref={afterHeading}
          tasks={site.tasks}
          before={ready.results}
          after={outcome.results}
          taskId={afterTaskId ?? taskId ?? site.tasks[0].id}
          onTask={setAfterTaskId}
          runKey={applyKey}
        />
      )}
    </div>
  );
}

/** The race, the transcript and the explanation share one clock, so they live under one component. */
function Stage({
  resetKey,
  left,
  lanes,
  result,
  taskLabel,
  loading,
}: {
  resetKey: string;
  left: ReactNode;
  lanes: Lane[] | null;
  result?: TaskResult;
  taskLabel: string;
  loading: boolean;
}) {
  const duration = lanes ? raceDuration(lanes) : 0;
  const clock = useRaceClock(duration, resetKey);
  const sr = lanes?.find((l) => l.persona === "screenreader");
  const insight = result ? searchInsight(result.personas.screenreader) : undefined;

  return (
    <>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        {left}
        <section aria-labelledby="race-h" className="card p-5 sm:p-6 lg:sticky lg:top-24">
          <h2 id="race-h" className="h-card">
            3 · The race
          </h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            {lanes ? (
              <>
                <span className="font-semibold text-ink">{taskLabel}</span>. Time is on the shared axis; each lane follows its most likely strategy.
              </>
            ) : (
              "Three people, one task, one clock."
            )}
          </p>
          {lanes ? (
            <Race idBase="race" taskLabel={taskLabel} lanes={lanes} clock={clock} announcePrefix="Race finished." />
          ) : (
            <EmptyRace loading={loading} />
          )}
        </section>
      </div>

      {lanes && result && sr && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Transcript lane={sr} clock={clock} />
          <WhyPanel result={result} />
        </div>
      )}

      {result && insight && <SearchInsight search={insight} taskLabel={taskLabel} />}
    </>
  );
}

function EmptyRace({ loading }: { loading: boolean }) {
  return (
    <div>
      <div role={loading ? "status" : undefined} className="space-y-3" aria-busy={loading}>
        {PERSONAS.map((p) => (
          <div key={p.id} className="grid items-center gap-x-4 sm:grid-cols-[9.75rem_minmax(0,1fr)]">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl" style={{ background: p.tint, color: p.color }}>
                <PersonaIcon persona={p.id} size={22} />
              </span>
              <span className="font-semibold">{p.label}</span>
            </div>
            <div className={`relative h-14 overflow-hidden rounded-xl border border-dashed border-rule-strong ${loading ? "animate-pulse" : ""}`} style={{ background: p.tint }}>
              <span className="absolute inset-x-3 top-1/2 h-px bg-ink/20" />
            </div>
          </div>
        ))}
        {loading && <span className="sr-only">Reading the page’s accessibility tree…</span>}
      </div>
      <p className="mt-5 text-sm text-muted">
        {loading
          ? "Reading the page’s accessibility tree and modelling each person…"
          : "Press Run on a task. Detour models a mouse user, a keyboard-only user and a blind screen-reader user doing the same thing, then races them."}
      </p>
    </div>
  );
}
