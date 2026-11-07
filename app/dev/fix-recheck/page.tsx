"use client";

// DEV ONLY: the Fix panel, the Re-check panel and the change drawer on real data, each in a box of exactly
// 684 x 824 px (or 524 x 696 with ?box=narrow). The lead deletes this route once the shell uses the panels.
//
//   /dev/fix-recheck?site=northwind            (default; also riverside, alpine)
//   /dev/fix-recheck?url=https://news.ycombinator.com/
//   add &auto=1 to start the fix as soon as the plan and the wording are ready
//   add &box=narrow for the 524 x 696 boxes
//   add &fake=16 to append 16 invented label proposals for real links and buttons of the page. A page without keys
//   often gets no wording edits, and this shows the wording row with a full list. The edits go through the real run.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SitePreview } from "@/components/analyze/SitePreview";
import { useFixRun } from "@/components/analyze/useFixRun";
import { useDataSource } from "@/components/DataSourceProvider";
import { ChangeDrawer } from "@/components/workspace/panels/ChangeDrawer";
import { FixPanel } from "@/components/workspace/panels/FixPanel";
import { RecheckPanel } from "@/components/workspace/panels/RecheckPanel";
import type { Task } from "@/lib/contracts";
import type { ExportMeta } from "@/lib/livefix/export";
import type { WordingEdit } from "@/lib/livefix/types";
import { checkUrl, normalizeUrlInput, sourceUrl, urlSiteFromCheck } from "@/lib/ui/any-url";
import type { Analysis, PlanOutcome, RepairReport, SiteInfo } from "@/lib/ui/datasource";
import { buildWordingEdits, taskLabels, wordingWcag } from "@/lib/ui/fix-run";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Page() {
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <Dev />
    </Suspense>
  );
}

function Dev() {
  const params = useSearchParams();
  const siteParam = params.get("site") ?? "northwind";
  const urlParam = params.get("url");
  const auto = params.get("auto") === "1";
  const narrow = params.get("box") === "narrow";
  const fake = Math.min(40, Math.max(0, Number(params.get("fake") ?? 0) || 0));
  const box = narrow ? { width: 524, height: 696 } : { width: 684, height: 824 };

  const source = useDataSource();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fixHeading = useRef<HTMLHeadingElement>(null);
  const recheckHeading = useRef<HTMLHeadingElement>(null);

  const [base, setBase] = useState<SiteInfo>();
  const [extra, setExtra] = useState<Task[]>([]);
  const [ready, setReady] = useState<Analysis>();
  const [suggested, setSuggested] = useState(false);
  const [outcome, setOutcome] = useState<PlanOutcome>();
  const [repair, setRepair] = useState<{ done: boolean; report?: RepairReport | null }>({ done: false });
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const site = useMemo<SiteInfo | undefined>(() => (base ? { ...base, tasks: [...base.tasks, ...extra] } : undefined), [base, extra]);
  const liveId = useRef("");
  useEffect(() => {
    liveId.current = base?.id ?? "";
  }, [base]);

  // 1. Which page: a demo, or a public address through the proxy.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (urlParam) {
        const n = normalizeUrlInput(urlParam);
        if (!n.ok) throw new Error(n.message);
        const c = await checkUrl(n.url);
        if (!c.ok) throw new Error(c.message);
        return urlSiteFromCheck(c);
      }
      const list = await source.listSites();
      return list.find((s) => s.id === siteParam) ?? list[0];
    })().then(
      (s) => alive && setBase(s),
      (e) => alive && setError(msg(e)),
    );
    return () => {
      alive = false;
    };
  }, [source, siteParam, urlParam]);

  // 2. Read the page once the preview iframe is on screen.
  useEffect(() => {
    if (!base) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!frameRef.current) return;
      clearInterval(timer);
      source.analyze(base, frameRef.current).then(
        (a) => alive && setReady(a),
        (e) => alive && setError(msg(e)),
      );
    }, 100);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [base, source]);

  // 3. A typed address starts with no tasks: take the suggested ones, as the workbench does.
  const needsTasks = base?.kind === "url" && !!source.suggestTasks && !!source.addTask;
  const tasksSettled = !needsTasks || suggested;
  const repairSettled = !source.suggestRepairs || repair.done;
  const suggestedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!base || !ready || !needsTasks || suggestedFor.current === ready.page) return;
    suggestedFor.current = ready.page;
    if (!source.suggestTasks || !source.addTask) return;
    const suggest = source.suggestTasks.bind(source);
    const addTask = source.addTask.bind(source);
    void (async () => {
      try {
        const found = await suggest(base, ready);
        const next: SiteInfo = { ...base, tasks: found };
        let data = ready;
        for (const t of found) data = await addTask(next, data, t);
        if (liveId.current !== base.id) return;
        setExtra(found);
        setReady(data);
      } catch (e) {
        setError(msg(e));
      } finally {
        setSuggested(true);
      }
    })();
  }, [base, ready, needsTasks, source]);

  // 4. Plan 3 fixes and ask for the verified wording.
  const planned = useRef<unknown>(null);
  useEffect(() => {
    if (!site || !ready || !tasksSettled || site.tasks.length === 0 || planned.current === ready) return;
    planned.current = ready;
    let alive = true;
    setTaskId((cur) => cur || site.tasks[0].id);
    source.plan(site, ready, 3).then(
      (o) => alive && setOutcome(o),
      (e) => alive && setError(msg(e)),
    );
    if (source.suggestRepairs) {
      source.suggestRepairs(site, ready).then(
        (report) => alive && setRepair({ done: true, report }),
        () => alive && setRepair({ done: true, report: null }),
      );
    }
    return () => {
      alive = false;
    };
  }, [site, ready, tasksSettled, source]);

  const wording = useMemo(() => {
    const real = buildWordingEdits(repair.report);
    if (!fake || !ready) return real;
    const taken = new Set(real.map((w) => w.nodeId));
    const invented: WordingEdit[] = ready.page.readingOrder
      .map((id) => ready.page.nodes[id])
      .filter((n) => n && (n.role === "link" || n.role === "button") && !taken.has(n.id))
      .slice(0, fake)
      .map((n, i) => ({ fixId: `wording:label:${n.id}`, nodeId: n.id, kind: "label", text: `Dev label ${i + 1}`, original: "" }));
    return [...real, ...invented];
  }, [repair.report, fake, ready]);
  const [doneNote, setDoneNote] = useState(0);
  const fixer = useFixRun({ source, site, ready, outcome, frameRef, wording, onDone: () => setDoneNote((n) => n + 1) });
  const { run, fix } = fixer;

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!auto || autoStarted.current || !outcome || !repairSettled) return;
    autoStarted.current = true;
    void fix();
  }, [auto, outcome, repairSettled, fix]);

  const step = !base ? "Loading the page list" : !ready ? "Reading the page" : !tasksSettled ? "Looking for tasks" : !outcome ? "Planning 3 fixes" : "Ready";

  const meta = useMemo<ExportMeta>(() => {
    const wcag: Record<string, string[]> = {};
    for (const f of outcome?.plan.chosen ?? []) wcag[f.id] = f.wcag;
    for (const w of run?.wording ?? wording) wcag[w.fixId] = wordingWcag(w);
    return { url: site ? sourceUrl(site) : "", title: ready?.page.title ?? "", wcag, taskLabels: taskLabels(site?.tasks ?? []) };
  }, [site, ready, outcome, run?.wording, wording]);

  const closeDrawer = useCallback(() => setSelected(null), []);
  const selFix = selected ? outcome?.plan.chosen.find((f) => f.id === selected) : undefined;
  const selWording = selected ? run?.wording.find((w) => w.fixId === selected) : undefined;
  const after = run?.status === "done" && run.report ? run.report.results : null;
  const tasks = site?.tasks ?? [];
  const fixAvailable = fixer.canFix && (ready?.mode ?? "live") === "live";

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <div className="w-[640px] shrink-0">
          {site && <SitePreview key={site.id} site={site} frameRef={frameRef} />}
        </div>
        <div className="min-w-[16rem] flex-1 space-y-2 text-sm">
          <p data-testid="dev-status">
            {error ? `Error: ${error}` : step}
            {site ? ` · ${site.name} · ${site.tasks.length} tasks` : ""}
          </p>
          <p className="text-muted">
            Fix run: {run ? run.status : "not started"} · wording edits: {wording.length} · re-checks done: {doneNote}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={!outcome || !repairSettled || run?.status === "running"} onClick={() => void fix()}>
              Run the fix (dev)
            </button>
            <button type="button" className="btn btn-sm" disabled={!run?.ids.length} onClick={() => setSelected(run?.ids[0] ?? null)}>
              Open the first change (dev)
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div data-testid="fix-box" className="grid" style={{ width: box.width, height: box.height, gridTemplateRows: "minmax(0,1fr)" }}>
          <FixPanel
            headingRef={fixHeading}
            available={fixAvailable}
            outcome={outcome}
            run={run}
            page={ready?.page ?? null}
            tasks={tasks}
            meta={meta}
            onFixAgain={() => void fix()}
            onView={setSelected}
          />
        </div>
        <div data-testid="recheck-box" className="grid" style={{ width: box.width, height: box.height, gridTemplateRows: "minmax(0,1fr)" }}>
          <RecheckPanel
            headingRef={recheckHeading}
            tasks={tasks}
            before={ready?.results ?? []}
            after={after}
            predicted={outcome?.results ?? null}
            taskId={taskId || tasks[0]?.id || ""}
            onTask={setTaskId}
            runKey={fixer.doneKey}
            hideInsight={() => false}
          />
        </div>
      </div>

      <ChangeDrawer
        open={selected !== null && (!!selFix || !!selWording)}
        onClose={closeDrawer}
        fix={selFix}
        wording={selWording}
        outcome={selected ? run?.outcomes[selected] : undefined}
        page={ready?.page ?? null}
      />
    </div>
  );
}
