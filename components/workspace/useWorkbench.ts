"use client";

// All state and actions of the Analyze workspace. This is the old Workbench's logic, unchanged in behaviour, plus
// the step state (which panel shows, which primary action the rail offers) and the address check of the page menu.
// The components of components/workspace/ are presentational over what this returns.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useDataSource, useDataSourceMode } from "@/components/DataSourceProvider";
import type { A11yNode, SearchEstimate, Task, TaskResult } from "@/lib/contracts";
import type { ExportMeta } from "@/lib/livefix/export";
import type { WordingEdit } from "@/lib/livefix/types";
import { checkUrl, normalizeUrlInput, sourceUrl, urlSiteFromCheck } from "@/lib/ui/any-url";
import { LlmUnavailableError, type Analysis, type PlanOutcome, type RepairReport, type SiteInfo } from "@/lib/ui/datasource";
import { buildWordingEdits, taskLabels, wordingWcag } from "@/lib/ui/fix-run";
import { nodeLabel, roleWord, taskForNode } from "@/lib/ui/pick";
import { buildRenameStory, hideSearchInsight } from "@/lib/ui/rename-story";
import { PERSONA_ORDER, buildLane, type Lane } from "@/lib/ui/timeline";
import type { CustomState } from "./CustomTaskBox";
import { currentStep, primaryAction, stepStates, type PrimaryKind, type StepFacts } from "./steps";
import { useFixRun } from "./useFixRun";
import type { ChangeDrawerProps, PlanPanelProps, PlanStatus, RacePanelProps, RecheckPanelProps, RepairStatus, RepairView, StepId, FixPanelProps } from "./contract";

export type { CustomState };

/** Fewer reading stops than this and the page, without its JavaScript, is mostly empty. */
export const MIN_READING_STOPS = 5;

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

/** The typed address of the page menu: its text, whether the proxy is checking it, and why it was refused. */
export type AddressState =
  | { status: "idle"; text: string }
  | { status: "checking"; text: string }
  | { status: "error"; text: string; message: string };

/** One group of the Tasks panel: "On this page" or the suggestion heading. */
export interface TaskGroup {
  id: "own" | "suggested";
  label: string;
  tasks: Task[];
}

const NO_TASKS: Task[] = [];
const NO_RESULTS: TaskResult[] = [];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The preview iframe once it is mounted; null if it never is (the page is missing: analysis then uses sample data). */
async function waitForFrame(ref: RefObject<HTMLIFrameElement | null>, timeoutMs = 2000): Promise<HTMLIFrameElement | null> {
  for (let waited = 0; !ref.current && waited < timeoutMs; waited += 50) await new Promise((r) => setTimeout(r, 50));
  return ref.current;
}

/** What the patch and the report need beyond the run itself: the page's address and title, WCAG numbers, task names. */
function exportMeta(site: SiteInfo | undefined, title: string, outcome: PlanOutcome | undefined, wording: WordingEdit[]): ExportMeta {
  if (!site) return { url: "", title, wcag: {}, taskLabels: {} };
  const wcag: Record<string, string[]> = {};
  for (const f of outcome?.plan.chosen ?? []) wcag[f.id] = f.wcag;
  for (const w of wording) wcag[w.fixId] = wordingWcag(w);
  return { url: sourceUrl(site), title, wcag, taskLabels: taskLabels(site.tasks) };
}

export function useWorkbench() {
  const source = useDataSource();
  const mode = useDataSourceMode();

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
  // "Pick on the page" (pages from a typed-in address start with no tasks).
  const [picking, setPicking] = useState(false);
  const [hovered, setHovered] = useState<A11yNode | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pickMsg, setPickMsg] = useState("");
  // The step rail.
  const [step, setStep] = useState<StepId>("race");
  const [focusReq, setFocusReq] = useState<{ step: StepId; n: number } | null>(null);
  // The change drawer: the fix id (a plan fix or a wording edit) being shown.
  const [viewId, setViewId] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressState>({ status: "idle", text: "" });

  const frameRef = useRef<HTMLIFrameElement>(null);
  const liveSite = useRef("");
  const raceHeading = useRef<HTMLHeadingElement>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const fixHeading = useRef<HTMLHeadingElement>(null);
  const recheckHeading = useRef<HTMLHeadingElement>(null);
  const headingRefs = useMemo<Record<StepId, RefObject<HTMLHeadingElement | null>>>(
    () => ({ race: raceHeading, plan: planHeading, fix: fixHeading, recheck: recheckHeading }),
    [],
  );

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
  const analysisError = analysis?.status === "error" && analysis.siteId === siteId ? analysis.error : undefined;
  /** Something is being worked on: the task waiting for its analysis, the page being read, or the scan for suggestions. */
  const busyId = pending ?? (reading ? "page" : suggesting ? "suggest" : null);

  // Heading and label suggestions come from the server (LLM, verified by the scent model). What they accept is
  // applied in the same run as the plan's fixes.
  const readyPage = ready?.page;
  const taskKey = site?.tasks.map((t) => t.id).join("|") ?? "";
  const repairKey = site && readyPage && site.tasks.length > 0 ? `${site.id}|${taskKey}` : "";
  const repairReport = repair?.key === repairKey ? repair.report : undefined;
  const wording = useMemo(() => buildWordingEdits(repairReport), [repairReport]);

  // ---- steps ----------------------------------------------------------------------------------------------------

  /** Open a step. Focus moves to its heading unless told otherwise (arrow keys on the rail keep focus on the tabs). */
  const go = useCallback((to: StepId, opts?: { focus?: boolean }) => {
    setStep(to);
    if (opts?.focus !== false) setFocusReq((r) => ({ step: to, n: (r?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (focusReq) headingRefs[focusReq.step].current?.focus();
  }, [focusReq, headingRefs]);

  // ---- the fix run ----------------------------------------------------------------------------------------------

  // "Fix this page": the agents' edits go onto the live preview, then Detour re-reads and re-times it.
  const fixer = useFixRun({ source, site, ready, outcome, frameRef, wording, onDone: () => setAfterTaskId(taskId) });
  const resetFix = fixer.reset;
  const fixAvailable = fixer.canFix && (ready?.mode ?? mode) === "live";

  // ---- page and tasks -------------------------------------------------------------------------------------------

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
      setViewId(null);
      setStep("race");
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

  const setAddressText = useCallback((text: string) => setAddress((cur) => (cur.status === "checking" ? cur : { status: "idle", text })), []);

  /** Check an address with the proxy and, if it is a page, analyse it. Resolves true when the page was added. */
  const submitAddress = useCallback(
    async (typed?: string): Promise<boolean> => {
      const text = typed ?? address.text;
      if (address.status === "checking") return false;
      const parsed = normalizeUrlInput(text);
      if (!parsed.ok) {
        setAddress({ status: "error", text, message: parsed.message });
        return false;
      }
      setAddress({ status: "checking", text });
      const checked = await checkUrl(parsed.url);
      if (!checked.ok) {
        setAddress({ status: "error", text, message: checked.message });
        return false;
      }
      setAddress({ status: "idle", text: "" });
      addUrlSite(urlSiteFromCheck(checked));
      return true;
    },
    [address, addUrlSite],
  );

  /** Read the page and evaluate every task of the site. Resolves with the analysis once it is on screen. */
  const startAnalysis = useCallback(
    (target: SiteInfo): Promise<Analysis> => {
      setAnalysis({ siteId: target.id, status: "loading" });
      // The preview mounts a moment after the page list (it checks the page first): a run clicked in that moment waits
      // for it instead of falling back to sample data.
      return waitForFrame(frameRef)
        .then((frame) => source.analyze(target, frame))
        .then(
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

  /** Run a task: opens the race and reads the page first when that has not happened yet. */
  const run = useCallback(
    (id: string) => {
      if (!site) return;
      setTaskId(id);
      go("race");
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
    [site, ready, startAnalysis, go],
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
    async (target: SiteInfo, data: Analysis, added: Task): Promise<boolean> => {
      const sid = target.id;
      const next: SiteInfo = { ...target, tasks: [...target.tasks.filter((t) => t.id !== added.id), added] };
      const withTask = source.addTask ? await source.addTask(next, data, added) : data;
      if (liveSite.current !== sid) return false;
      setSites((list) => list?.map((s) => (s.id === sid ? next : s)) ?? list);
      setAnalysis({ siteId: sid, status: "ready", data: withTask });
      setPlan({ siteId: sid, status: "idle" });
      resetFix();
      setViewId(null);
      setTaskId(added.id);
      setRunKey((n) => n + 1);
      go("race");
      return true;
    },
    [source, resetFix, go],
  );

  /** A node chosen on the page or from the list: the deterministic task for it, added and run. No LLM. */
  const choosePick = useCallback(
    async (nodeId: string) => {
      if (!site || !ready) return;
      const picked = taskForNode(ready.page, site.id, nodeId);
      const node = ready.page.nodes[nodeId];
      if (!picked || !node) return;
      setPicking(false);
      setHovered(null);
      try {
        if (await adoptTask(site, ready, picked)) {
          setPickMsg(`Chose the ${roleWord(node)} “${nodeLabel(node, 60)}”. Task added and running: ${picked.label}.`);
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
        const grounded = await source.groundTask(site, data, text);
        if (liveSite.current !== sid) return;
        if (await adoptTask(site, data, grounded)) mine({ siteId: sid, status: "done", text, task: grounded });
      } catch (e) {
        mine(e instanceof LlmUnavailableError ? { siteId: sid, status: "unavailable", text } : { siteId: sid, status: "error", text, error: errMsg(e) });
      }
    },
    [site, ready, source, startAnalysis, adoptTask],
  );

  const setPickingOn = useCallback((on: boolean) => {
    setPicking(on);
    if (on) setPickMsg("");
  }, []);

  // ---- plan and fix ---------------------------------------------------------------------------------------------

  const doPlan = useCallback(() => {
    if (!site || !ready) return;
    // A new plan is for the page as it was read: a page patched by an earlier run goes back first.
    resetFix();
    setViewId(null);
    setPlan({ siteId: site.id, status: "loading" });
    source
      .plan(site, ready, k)
      .then((o) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "ready", outcome: o }))
      .catch((e) => liveSite.current === site.id && setPlan({ siteId: site.id, status: "error", error: errMsg(e) }));
  }, [site, ready, source, k, resetFix]);

  /** Another number of fixes is another plan: the fix state starts over and the rail offers "Plan fixes" again. */
  const changeK = useCallback(
    (n: number) => {
      setK(n);
      resetFix();
      setViewId(null);
      setPlan({ siteId, status: "idle" });
    },
    [resetFix, siteId],
  );

  // The actions below are handed to panels, so they keep one identity: they call the latest run through a ref.
  const fixerRef = useRef(fixer);
  useEffect(() => {
    fixerRef.current = fixer;
  });
  const fixThisPage = useCallback(() => {
    go("fix");
    void fixerRef.current.fix();
  }, [go]);

  const fixAgain = useCallback(() => {
    fixerRef.current.reset();
    // The header button unmounts while the run restarts: keep keyboard focus on the Fix heading.
    go("fix");
    void fixerRef.current.fix();
  }, [go]);

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

  // The Plan panel tells the heading story per task; the separate realistic-search note steps aside for it.
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

  // ---- the step rail --------------------------------------------------------------------------------------------

  const fixRun = fixer.run;
  const fixDone = fixRun?.status === "done" && !!fixRun.report;
  const facts: StepFacts = {
    step,
    hasResult: !!result,
    plan: planForSite.status,
    fixes: outcome?.plan.chosen.length ?? 0,
    canFix: fixAvailable,
    run: fixRun?.status ?? null,
  };
  const steps = stepStates(facts);
  const shownStep = currentStep(facts);

  /** "Plan fixes": opens the plan, and plans unless a plan is already there or on its way. */
  const planFixes = useCallback(() => {
    go("plan");
    if (planForSite.status === "ready" || planForSite.status === "loading") return;
    doPlan();
  }, [go, planForSite.status, doPlan]);

  /** "Plan fixes" / "Plan again" on the Plan step. The button turns into "Planning…" (disabled) while it works, so focus goes to the heading. */
  const planAgain = useCallback(() => {
    go("plan");
    doPlan();
  }, [go, doPlan]);

  const chosen = primaryAction(facts);
  const onPrimary: Record<PrimaryKind, (() => void) | undefined> = {
    "plan-fixes": planFixes,
    plan: planAgain,
    fix: fixThisPage,
    retry: fixAgain,
    recheck: () => go("recheck"),
    busy: undefined,
  };
  const primary = chosen && { label: chosen.label, disabled: chosen.disabled, secondary: chosen.secondary, onClick: onPrimary[chosen.kind] };

  // ---- what the panels get --------------------------------------------------------------------------------------

  const tasks = site?.tasks ?? NO_TASKS;
  const baseline = ready?.results ?? NO_RESULTS;
  const runWording = fixRun?.wording ?? wording;
  const pageTitle = ready?.page.title ?? "";
  const meta = useMemo(() => exportMeta(site, pageTitle, outcome, runWording), [site, pageTitle, outcome, runWording]);

  const racePanel: Omit<RacePanelProps, "headingRef"> = {
    task: task ?? null,
    result: result ?? null,
    lanes,
    loading: reading || pending !== null,
    runKey,
    isUrl: !!isUrl,
    hideInsight,
  };

  const repairView = useMemo<RepairView | null>(
    () => (ready && repair?.key === repairKey ? { status: repair.status, report: repair.report, story } : null),
    [ready, repair, repairKey, story],
  );
  const planPanel: Omit<PlanPanelProps, "headingRef"> = {
    status: planForSite.status,
    outcome,
    error: planForSite.error,
    baseline,
    k,
    onK: changeK,
    repair: repairView,
    page: ready?.page ?? null,
    task: task ?? null,
  };

  const fixPanel: Omit<FixPanelProps, "headingRef"> = {
    available: fixAvailable,
    outcome,
    run: fixRun,
    page: ready?.page ?? null,
    tasks,
    meta,
    onFixAgain: fixAgain,
    onView: setViewId,
  };

  const recheckPanel: Omit<RecheckPanelProps, "headingRef"> = {
    tasks,
    before: baseline,
    after: fixDone ? (fixRun?.report?.results ?? null) : null,
    predicted: outcome?.results ?? null,
    taskId: afterTaskId ?? taskId ?? tasks[0]?.id ?? "",
    onTask: setAfterTaskId,
    runKey: fixer.doneKey,
    hideInsight,
  };

  const viewFix = viewId ? outcome?.plan.chosen.find((f) => f.id === viewId) : undefined;
  const viewWording = viewId ? runWording.find((w) => w.fixId === viewId) : undefined;
  const closeDrawer = useCallback(() => setViewId(null), []);
  const drawer: ChangeDrawerProps = {
    open: !!viewFix || !!viewWording,
    onClose: closeDrawer,
    fix: viewFix,
    wording: viewWording,
    outcome: viewId ? fixRun?.outcomes[viewId] : undefined,
    page: ready?.page ?? null,
  };

  // ---- the tasks panel and the top bar --------------------------------------------------------------------------

  // The scan lists blocked controls first and tops up with the slowest ones; the heading says which it found.
  const ownTasks = tasks.filter((t) => !suggestedIds.has(t.id));
  const suggestedTasks = isUrl ? tasks.filter((t) => suggestedIds.has(t.id)) : [];
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
  const groups: TaskGroup[] = [];
  if (ownTasks.length > 0) groups.push({ id: "own", label: "On this page", tasks: ownTasks });
  if (suggestedTasks.length > 0) groups.push({ id: "suggested", label: suggestedHeading, tasks: suggestedTasks });

  const sampleMode = (ready?.mode ?? mode) === "sample";
  const status = {
    text: address.status === "checking" ? "Checking the page…" : reading ? "Reading the page…" : sampleMode ? "Sample data" : ready ? `Live page · ${Object.keys(ready.page.nodes).length} elements` : "",
    /** Why the numbers are samples, when the live page could not be read. */
    detail: sampleMode && ready?.fallbackReason ? `Times come from hand-calibrated fixtures because the live page could not be read (${ready.fallbackReason}).` : undefined,
  };

  return {
    // pages
    sites,
    loadError,
    site,
    isUrl: !!isUrl,
    chooseSite,
    address,
    setAddressText,
    submitAddress,
    status,
    // the page preview
    frameRef,
    ready,
    reading,
    fixed:
      fixRun && fixRun.status !== "error"
        ? { shown: fixer.shown, busy: fixRun.status === "running", onToggle: fixer.toggle }
        : undefined,
    // tasks
    taskId,
    groups,
    results: ready?.results,
    busyId,
    run,
    suggesting,
    analysisError,
    thinPage: !!isUrl && !!ready && ready.page.readingOrder.length < MIN_READING_STOPS ? ready.page.readingOrder.length : null,
    pick: {
      active: picking,
      setActive: setPickingOn,
      hovered,
      onHover: setHovered,
      choose: choosePick,
      onHighlight: setHighlightId,
      highlight: highlightId && ready ? (ready.page.nodes[highlightId] ?? null) : null,
      message: pickMsg,
      onCancel: () => setPicking(false),
    },
    custom: {
      state: custom.siteId === siteId ? custom : ({ siteId, status: "idle" } as CustomState),
      available: !!source.groundTask,
      run: runCustom,
    },
    // steps
    step: shownStep,
    steps,
    go,
    primary,
    headingRefs,
    racePanel,
    planPanel,
    fixPanel,
    recheckPanel,
    drawer,
  };
}

/** Everything the workspace components read and call. */
export type WorkbenchApi = ReturnType<typeof useWorkbench>;
