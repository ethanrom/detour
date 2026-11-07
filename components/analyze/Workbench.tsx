"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDataSource, useDataSourceMode } from "@/components/DataSourceProvider";
import { PersonaIcon } from "@/components/icons";
import { AfterSection } from "@/components/plan/AfterSection";
import { FixPlanPanel, type PlanStatus } from "@/components/plan/FixPlanPanel";
import type { ExportMeta } from "@/lib/livefix/export";
import type { WordingEdit } from "@/lib/livefix/types";
import { Race, raceDuration } from "@/components/race/Race";
import { Transcript } from "@/components/race/Transcript";
import { useRaceClock } from "@/components/race/useRaceClock";
import type { A11yNode, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import { LlmUnavailableError, type Analysis, type PlanOutcome, type RepairReport, type SiteInfo } from "@/lib/ui/datasource";
import { buildWordingEdits, taskLabels, wordingWcag } from "@/lib/ui/fix-run";
import { nodeLabel, roleWord, taskForNode } from "@/lib/ui/pick";
import { buildRenameStory, hideSearchInsight } from "@/lib/ui/rename-story";
import { searchInsight } from "@/lib/ui/search-insight";
import { fmtSeconds } from "@/lib/ui/format";
import { PERSONAS, PERSONA_BY_ID } from "@/lib/ui/personas";
import { PERSONA_ORDER, buildLane, type Lane } from "@/lib/ui/timeline";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import { CustomTaskBox, type CustomState } from "./CustomTaskBox";
import { RepairPanel, type RepairStatus } from "./RepairPanel";
import { SearchInsight } from "./SearchInsight";
import { SiteCards } from "./SiteCards";
import { SitePreview } from "./SitePreview";
import { TargetPicker } from "./TargetPicker";
import { TaskList } from "./TaskList";
import { useFixRun } from "./useFixRun";
import { WhyPanel } from "./WhyPanel";
import { sourceUrl } from "@/lib/ui/any-url";

/** Fewer reading stops than this and the page, without its JavaScript, is mostly empty. */
const MIN_READING_STOPS = 5;

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
  const [afterTaskId, setAfterTaskId] = useState<string | null>(null);
  // Tasks found on a typed-in page by the barrier scan, and whether that scan is running.
  const [suggestedIds, setSuggestedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [custom, setCustom] = useState<CustomState>({ siteId: "", status: "idle" });
  const [repair, setRepair] = useState<RepairState | null>(null);
  // "Click to choose a target" (pages from a typed-in address start with no tasks).
  const [picking, setPicking] = useState(false);
  const [hovered, setHovered] = useState<A11yNode | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pickMsg, setPickMsg] = useState("");

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
  const isUrl = site?.kind === "url";
  const reading = analysis?.status === "loading" && analysis.siteId === siteId;
  /** Something is being worked on: the task waiting for its analysis, the page being read, or the scan for suggestions. */
  const busyId = pending ?? (reading ? "page" : suggesting ? "suggest" : null);

  // Heading and label suggestions come from the server (LLM, verified by the scent model). What they accept is
  // applied in the same run as the plan's fixes.
  const readyPage = ready?.page;
  const taskKey = site?.tasks.map((t) => t.id).join("|") ?? "";
  const repairKey = site && readyPage && site.tasks.length > 0 ? `${site.id}|${taskKey}` : "";
  const repairReport = repair?.key === repairKey ? repair.report : undefined;
  const wording = useMemo(() => buildWordingEdits(repairReport), [repairReport]);

  // "Fix this page": the agents' edits go onto the live preview, then Detour re-reads and re-times it.
  const fixer = useFixRun({ source, site, ready, outcome, frameRef, wording, onDone: () => setAfterTaskId(taskId) });
  const resetFix = fixer.reset;
  const fixAvailable = fixer.canFix && (ready?.mode ?? mode) === "live";

  const chooseSite = useCallback(
    (id: string) => {
      resetFix();
      setSiteId(id);
      setTaskId(null);
      setAnalysis(null);
      setPending(null);
      setSuggesting(false);
      setPlan({ siteId: id, status: "idle" });
      setPicking(false);
      setHovered(null);
      setHighlightId(null);
      setPickMsg("");
    },
    [resetFix],
  );

  /** The proxy accepted a typed-in address: add it as the (one) page of its kind and select it. */
  const addUrlSite = useCallback(
    (added: SiteInfo) => {
      setSites((list) => {
        const cur = list ?? [];
        // The same address again keeps the tasks already chosen on it.
        return cur.some((s) => s.id === added.id) ? cur : [...cur.filter((s) => s.kind !== "url"), added];
      });
      chooseSite(added.id);
    },
    [chooseSite],
  );

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

  // A page from a typed-in address has no tasks to wait for, so read it as soon as it is selected.
  useEffect(() => {
    if (!site || site.kind !== "url" || analysis !== null) return;
    startAnalysis(site).catch(() => undefined); // the error is shown by the analysis state
  }, [site, analysis, startAnalysis]);

  // ...and then offer tasks for the controls some people cannot use, so there is something to run without typing.
  const suggestedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!site || site.kind !== "url" || !ready || !source.suggestTasks || !source.addTask) return;
    if (suggestedFor.current === ready.page) return;
    suggestedFor.current = ready.page;
    const sid = site.id;
    const suggest = source.suggestTasks.bind(source);
    const addTask = source.addTask.bind(source);
    setSuggesting(true);
    void (async () => {
      try {
        const found = await suggest(site, ready);
        const fresh = found.filter((t) => !site.tasks.some((x) => x.id === t.id));
        if (found.length === 0 || liveSite.current !== sid) return;
        const next: SiteInfo = { ...site, tasks: [...site.tasks, ...fresh] };
        let data = ready;
        for (const t of fresh) data = await addTask(next, data, t);
        if (liveSite.current !== sid) return;
        setSuggestedIds((cur) => new Set([...cur, ...found.map((t) => t.id)]));
        if (fresh.length > 0) {
          setSites((list) => list?.map((s) => (s.id === sid ? next : s)) ?? list);
          setAnalysis({ siteId: sid, status: "ready", data });
        }
      } catch {
        /* suggestions are a convenience: without them the page still takes a picked target or a typed task */
      } finally {
        setSuggesting(false);
      }
    })();
  }, [site, ready, source]);

  /** Add a task to the site (evaluated on the page that is already read) and run it. False if the user moved on meanwhile. */
  const adoptTask = useCallback(
    async (target: SiteInfo, data: Analysis, task: Task): Promise<boolean> => {
      const sid = target.id;
      const next: SiteInfo = { ...target, tasks: [...target.tasks.filter((t) => t.id !== task.id), task] };
      const withTask = source.addTask ? await source.addTask(next, data, task) : data;
      if (liveSite.current !== sid) return false;
      setSites((list) => list?.map((s) => (s.id === sid ? next : s)) ?? list);
      setAnalysis({ siteId: sid, status: "ready", data: withTask });
      setPlan({ siteId: sid, status: "idle" });
      resetFix();
      setTaskId(task.id);
      setRunKey((n) => n + 1);
      return true;
    },
    [source, resetFix],
  );

  /** A node chosen on the page or from the list: the deterministic task for it, added and run. No LLM. */
  const choosePick = useCallback(
    async (nodeId: string) => {
      if (!site || !ready) return;
      const task = taskForNode(ready.page, site.id, nodeId);
      const node = ready.page.nodes[nodeId];
      if (!task || !node) return;
      setPicking(false);
      setHovered(null);
      try {
        if (await adoptTask(site, ready, task)) {
          setPickMsg(`Chose the ${roleWord(node)} “${nodeLabel(node, 60)}”. Task added and running: ${task.label}.`);
        }
      } catch (e) {
        setPickMsg(`Could not time that target: ${errMsg(e)}`);
      }
    },
    [site, ready, adoptTask],
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
        if (await adoptTask(site, data, task)) mine({ siteId: sid, status: "done", text, task });
      } catch (e) {
        mine(e instanceof LlmUnavailableError ? { siteId: sid, status: "unavailable", text } : { siteId: sid, status: "error", text, error: errMsg(e) });
      }
    },
    [site, ready, source, startAnalysis, adoptTask],
  );

  const doPlan = useCallback(() => {
    if (!site || !ready) return;
    // A new plan is for the page as it was read: a page patched by an earlier run goes back first.
    resetFix();
    setPlan({ siteId: site.id, status: "loading" });
    source
      .plan(site, ready, k)
      .then((o) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "ready", outcome: o }))
      .catch((e) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "error", error: errMsg(e) }));
  }, [site, ready, source, k, resetFix]);

  // Move to the before/after section when a fix run has finished.
  const doneKey = fixer.doneKey;
  useEffect(() => {
    if (doneKey === 0) return;
    const h = afterHeading.current;
    if (!h) return;
    h.focus({ preventScroll: true });
    (h.closest("section") ?? h).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [doneKey, reduced]);

  // Heading and label suggestions: the server asks the LLM for wording and the scent model verifies it.
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

  // The Wording panel tells the heading story per task; the separate realistic-search panel steps aside for it.
  const repairStatus: RepairStatus | undefined =
    source.suggestRepairs && repairKey ? (repair?.key === repairKey ? repair.status : "loading") : undefined;
  const story = useMemo(() => {
    if (!readyPage || !site || !repairReport) return null;
    try {
      return buildRenameStory(readyPage, site.tasks, repairReport);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyPage, taskKey, repairReport]);
  const hideInsight = useCallback(
    (forTask: string, search: SearchEstimate) => hideSearchInsight({ loading: repairStatus === "loading", story, taskId: forTask, search }),
    [repairStatus, story],
  );

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

  // The tasks are the screen's main job, so on the fixed demo pages they sit above the preview, in view on the first screen.
  const ownTasks = site.tasks.filter((t) => !suggestedIds.has(t.id));
  const suggestedTasks = isUrl ? site.tasks.filter((t) => suggestedIds.has(t.id)) : [];
  // The scan lists blocked controls first and tops up with the slowest ones; the heading says which it found.
  const blockedSuggested = suggestedTasks.filter((t) => {
    const r = ready?.results.find((x) => x.taskId === t.id);
    return !!(r?.personas.keyboard.blocked || r?.personas.screenreader.blocked);
  }).length;
  const suggestedHeading =
    blockedSuggested === 0
      ? "Suggested: the controls that take longest to reach"
      : blockedSuggested === suggestedTasks.length
        ? "Suggested: controls some people can’t use"
        : "Suggested: controls some people can’t use, then the slowest to reach";
  const taskList =
    site.tasks.length > 0 ? (
      <div className="space-y-5">
        {(ownTasks.length > 0 || suggestedTasks.length === 0) && (
          <TaskList tasks={ownTasks.length > 0 ? ownTasks : site.tasks} results={ready?.results} selectedId={taskId} busyId={busyId} onRun={run} />
        )}
        {suggestedTasks.length > 0 && (
          <div>
            <h3 id="suggested-h" className="mb-2 text-[0.9375rem] font-semibold">
              {suggestedHeading}
            </h3>
            <TaskList
              tasks={suggestedTasks}
              results={ready?.results}
              selectedId={taskId}
              busyId={busyId}
              onRun={run}
              label="Suggested tasks"
              primaryFirst={ownTasks.length === 0}
            />
          </div>
        )}
      </div>
    ) : (
      isUrl && (
        <p className="rounded-lg border border-dashed border-rule-strong bg-surface p-4 text-sm text-muted">
          {suggesting ? (
            <>
              <span className="font-medium text-ink">Looking for controls some people can’t use…</span> Suggested tasks show up here.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">No tasks yet.</span> Choose a target on the page above, or describe a task below. It shows up here and the race starts.
            </>
          )}
        </p>
      )
    );

  const left = (
    <div className="space-y-5">
      <div>
        <h2 className="h-card">Pick a task</h2>
        <p className="mt-1 text-sm text-muted">Each task is a short chain of steps on the page.</p>
      </div>
      {!isUrl && taskList}
      <SitePreview
        key={site.id}
        site={site}
        frameRef={frameRef}
        fixed={
          fixer.run && fixer.run.status !== "error"
            ? { shown: fixer.shown, busy: fixer.run.status === "running", onToggle: fixer.toggle }
            : undefined
        }
        pick={
          isUrl
            ? {
                active: picking,
                page: ready?.page,
                onHover: setHovered,
                onPick: (n) => void choosePick(n.id),
                onCancel: () => setPicking(false),
                highlight: highlightId && ready ? (ready.page.nodes[highlightId] ?? null) : null,
              }
            : undefined
        }
      />
      {isUrl && ready && ready.page.readingOrder.length < MIN_READING_STOPS && (
        <p role="status" className="rounded-lg border border-blocked bg-surface p-3 text-sm">
          <strong>This page renders almost nothing without JavaScript; try a server-rendered page.</strong> Detour found only{" "}
          {ready.page.readingOrder.length} thing{ready.page.readingOrder.length === 1 ? "" : "s"} to read or press, so any time it predicts here says little about
          the real page.
        </p>
      )}
      {isUrl && (
        <TargetPicker
          page={ready?.page}
          picking={picking}
          onPicking={(on) => {
            setPicking(on);
            if (on) setPickMsg("");
          }}
          hovered={hovered}
          onChoose={(id) => void choosePick(id)}
          onActive={setHighlightId}
          message={pickMsg}
          busy={busyId !== null}
        />
      )}
      {isUrl && taskList}
      {source.groundTask && (
        <CustomTaskBox
          key={`custom-${site.id}`}
          state={custom.siteId === site.id ? custom : { siteId: site.id, status: "idle" }}
          page={ready?.page}
          busy={busyId !== null}
          onSubmit={runCustom}
        />
      )}
      {analysis?.status === "error" && analysis.siteId === siteId && (
        <p role="alert" className="rounded-lg border border-blocked bg-surface p-3 text-sm text-blocked">
          Analysis failed: {analysis.error}
          {isUrl && " Check that the page loads in the preview, or try another address."}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="pick-h">
        <h2 id="pick-h" className="h-card mb-3">
          Choose a page
        </h2>
        <SiteCards sites={sites} value={siteId} onChange={chooseSite} onAddUrl={addUrlSite} />
        {(ready?.mode ?? mode) === "sample" ? (
          <p className="mt-3 text-[0.8125rem] text-muted">
            <span className="font-medium text-ink">Sample data.</span> Times on this screen come from hand-calibrated fixtures
            {ready?.fallbackReason ? ` because the live page could not be read (${ready.fallbackReason})` : ", not the live engine"}.
          </p>
        ) : (
          ready && (
            <p className="mt-3 text-[0.8125rem] text-muted">
              <span className="font-medium text-ink">Live page.</span> Read <span className="tnum">{Object.keys(ready.page.nodes).length}</span> elements from the rendered page, with their real positions
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
        loading={reading}
        url={isUrl}
        hideInsight={hideInsight}
        wording={
          ready && repair?.key === repairKey ? <RepairPanel status={repair.status} report={repair.report} page={ready.page} story={story} task={task} /> : null
        }
      />

      {ready && site.tasks.length > 0 && (
        <FixPlanPanel
          baseline={ready.results}
          k={k}
          onK={(n) => {
            // Another number of fixes is another plan: the fix state starts over.
            setK(n);
            resetFix();
          }}
          status={planForSite.status}
          outcome={outcome}
          error={planForSite.error}
          onPlan={doPlan}
          fix={{
            available: fixAvailable,
            run: fixer.run,
            page: ready.page,
            tasks: site.tasks,
            meta: exportMeta(site, ready.page.title, outcome, fixer.run?.wording ?? wording),
            onFix: () => void fixer.fix(),
          }}
        />
      )}

      {ready && outcome && fixer.run?.status === "done" && fixer.run.report && (
        <AfterSection
          ref={afterHeading}
          tasks={site.tasks}
          before={ready.results}
          after={fixer.run.report.results}
          predicted={outcome.results}
          taskId={afterTaskId ?? taskId ?? site.tasks[0].id}
          onTask={setAfterTaskId}
          runKey={fixer.doneKey}
          hideInsight={hideInsight}
        />
      )}
    </div>
  );
}

/** What the patch and the report need beyond the run itself: the page's address and title, WCAG numbers, task names. */
function exportMeta(site: SiteInfo, title: string, outcome: PlanOutcome | undefined, wording: WordingEdit[]): ExportMeta {
  const wcag: Record<string, string[]> = {};
  for (const f of outcome?.plan.chosen ?? []) wcag[f.id] = f.wcag;
  for (const w of wording) wcag[w.fixId] = wordingWcag(w);
  return { url: sourceUrl(site), title, wcag, taskLabels: taskLabels(site.tasks) };
}

/** The race, the transcript and the explanation share one clock, so they live under one component. */
function Stage({
  resetKey,
  left,
  lanes,
  result,
  taskLabel,
  loading,
  url,
  wording,
  hideInsight,
}: {
  resetKey: string;
  left: ReactNode;
  lanes: Lane[] | null;
  result?: TaskResult;
  taskLabel: string;
  loading: boolean;
  /** The page came from a typed-in address. */
  url: boolean;
  /** The Wording panel: right under the race, so the heading story is visible before any plan. */
  wording: ReactNode;
  hideInsight: (taskId: string, search: SearchEstimate) => boolean;
}) {
  const duration = lanes ? raceDuration(lanes) : 0;
  const clock = useRaceClock(duration, resetKey);
  const sr = lanes?.find((l) => l.persona === "screenreader");
  const found = result ? searchInsight(result.personas.screenreader) : undefined;
  const insight = result && found && !hideInsight(result.taskId, found) ? found : undefined;

  return (
    <>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        {left}
        <section aria-labelledby="race-h" className="card p-5 sm:p-6 lg:sticky lg:top-24">
          <h2 id="race-h" className="h-card">
            The race
          </h2>
          {lanes ? (
            <p className="mb-4 mt-1">
              <span className={`block text-base font-medium ${lanes.some((l) => l.blocked) ? "text-blocked" : "text-ink"}`}>{raceFinding(lanes)}</span>
              <span className="block text-sm text-muted">{taskLabel}</span>
            </p>
          ) : (
            <p className="mb-4 mt-1 text-sm text-muted">Three people, one task, one clock.</p>
          )}
          {lanes ? (
            <Race idBase="race" taskLabel={taskLabel} lanes={lanes} clock={clock} announcePrefix="Race finished." />
          ) : (
            <EmptyRace loading={loading} url={url} />
          )}
        </section>
      </div>

      {wording}

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

/** The finding the race answers first: who cannot finish, or who is slowest. Built from the lanes, no model involved. */
function raceFinding(lanes: Lane[]): string {
  const name = (l: Lane) => PERSONA_BY_ID[l.persona].label;
  const blocked = lanes.filter((l) => l.blocked);
  if (blocked.length > 0) {
    const names = blocked.map(name);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${who} can’t finish this task.`;
  }
  const slowest = lanes.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  return `Everyone finishes. ${name(slowest)} takes longest, ${fmtSeconds(slowest.seconds)}.`;
}

function EmptyRace({ loading, url }: { loading: boolean; url: boolean }) {
  const reading = url ? "Reading the page…" : "Reading the page’s accessibility tree…";
  return (
    <div>
      <div role={loading ? "status" : undefined} className="space-y-3" aria-busy={loading}>
        {PERSONAS.map((p) => (
          <div key={p.id} className="grid items-center gap-x-4 gap-y-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
            <div className="flex items-center gap-2" style={{ color: p.color }}>
              <PersonaIcon persona={p.id} size={16} />
              <span className="font-semibold">{p.label}</span>
            </div>
            <div className="relative h-14 overflow-hidden rounded-lg border border-dashed border-rule-strong bg-paper">
              <span className="absolute inset-x-3 top-1/2 h-px bg-ink/20" />
            </div>
          </div>
        ))}
        {loading && <span className="sr-only">{reading}</span>}
      </div>
      <p className="mt-5 text-sm text-muted">
        {loading ? (
          url ? (
            <>
              <span className="font-medium text-ink">Reading the page…</span> Detour is reading its accessibility tree from the rendered page. A large page can take a few seconds.
            </>
          ) : (
            "Reading the page’s accessibility tree and modelling each person…"
          )
        ) : url ? (
          "Choose a target on the page, or describe a task in your own words. Detour then models a mouse user, a keyboard-only user and a blind screen-reader user doing it, and races them."
        ) : (
          "Press Run on a task. Detour models a mouse user, a keyboard-only user and a blind screen-reader user doing the same thing, then races them."
        )}
      </p>
    </div>
  );
}
