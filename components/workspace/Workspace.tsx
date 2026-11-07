"use client";

// The Analyze workspace: a top bar and two columns that fit the window. Left: the live page (the preview keeps the
// 1280 × 800 frame the engine measures, scaled to the column) above the tasks for that page. Centre: the step rail and
// the active step's panel. The document itself never scrolls from 1024 px wide up; each panel scrolls inside. Under
// 1024 px it is one column and the page scrolls normally. Spec: internal/ui-v2-spec.md §3 (revised to two columns).

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StepId } from "./contract";
import { PagePanel } from "./PagePanel";
import { ChangeDrawer, FixPanel, PlanPanel, RacePanel, RecheckPanel } from "./panels";
import { StepRail, panelId, tabId } from "./StepRail";
import { TasksPanel } from "./TasksPanel";
import { TopBar } from "./TopBar";
import { useWorkbench, type WorkbenchApi } from "./useWorkbench";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

const STEP_IDS: readonly StepId[] = ["race", "plan", "fix", "recheck"];

/** `?site=<id>` selects a demo page and `?url=<address>` analyses that address, once the list of pages is there. */
function DeepLinks({ wb, onAddressError }: { wb: WorkbenchApi; onAddressError: () => void }) {
  const params = useSearchParams();
  const siteParam = params.get("site");
  const urlParam = params.get("url");
  const handled = useRef("");
  const { sites, chooseSite, submitAddress } = wb;

  useEffect(() => {
    if (!sites) return;
    const key = `${siteParam ?? ""}\n${urlParam ?? ""}`;
    if (key === "\n" || handled.current === key) return;
    handled.current = key;
    if (urlParam) void submitAddress(urlParam).then((ok) => !ok && onAddressError());
    else if (siteParam && sites.some((s) => s.id === siteParam)) chooseSite(siteParam);
  }, [sites, siteParam, urlParam, chooseSite, submitAddress, onAddressError]);

  return null;
}

export function Workspace() {
  const wb = useWorkbench();
  const [menu, setMenu] = useState<{ open: boolean; focus: "pages" | "field" }>({ open: false, focus: "pages" });
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const onMenu = useCallback((open: boolean, restoreFocus?: boolean) => {
    setMenu({ open, focus: "pages" });
    if (!open && restoreFocus) menuButtonRef.current?.focus();
  }, []);
  const openAddressField = useCallback(() => setMenu({ open: true, focus: "field" }), []);

  // `#url` (the link from Home) opens the menu with the address field ready.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#url") openAddressField();
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openAddressField]);

  // While picking a target on a typed-in page, the page widens over the centre column.
  const overlay = wb.pick.active && wb.isUrl;
  const panels: Record<StepId, ReactNode> = {
    race: <RacePanel headingRef={wb.headingRefs.race} {...wb.racePanel} />,
    plan: <PlanPanel headingRef={wb.headingRefs.plan} {...wb.planPanel} />,
    fix: <FixPanel headingRef={wb.headingRefs.fix} {...wb.fixPanel} />,
    recheck: <RecheckPanel headingRef={wb.headingRefs.recheck} {...wb.recheckPanel} />,
  };

  return (
    <div className="flex min-h-dvh flex-col gap-3 p-3 lg:grid lg:h-dvh lg:min-h-0 lg:grid-rows-[52px_minmax(0,1fr)]">
      <TopBar
        wb={wb}
        menu={menu}
        onMenu={onMenu}
        menuButtonRef={menuButtonRef}
      />

      <main
        id="main"
        tabIndex={-1}
        className="relative grid min-h-0 gap-3 outline-none lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] min-[1440px]:grid-cols-[360px_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col gap-3">
          <div
            id="page-column"
            className={cx("shrink-0", overlay && "lg:absolute lg:inset-y-0 lg:left-0 lg:z-30 lg:w-[70vw]")}
          >
            <PagePanel wb={wb} fill={overlay} className={overlay ? "lg:h-full lg:shadow-xl" : ""} />
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] [&>*]:min-h-0">
            <TasksPanel wb={wb} />
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <StepRail steps={wb.steps} step={wb.step} onStep={wb.go} primary={wb.primary} />
          <div className="min-h-0 flex-1">
            {STEP_IDS.map((id) => (
              <div
                key={id}
                role="tabpanel"
                id={panelId(id)}
                aria-labelledby={tabId(id)}
                hidden={wb.step !== id}
                className="grid h-full grid-rows-[minmax(0,1fr)] [&>*]:min-h-0"
              >
                {panels[id]}
              </div>
            ))}
          </div>
        </div>

      </main>

      <ChangeDrawer {...wb.drawer} />

      <Suspense fallback={null}>
        <DeepLinks wb={wb} onAddressError={openAddressField} />
      </Suspense>
    </div>
  );
}
