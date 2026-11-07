"use client";

// The Analyze workspace: a top bar and three panels that fit the window. Tasks on the left, the step rail and the
// active step's panel in the middle, the live page on the right. The document itself never scrolls from 1280 × 800 up;
// each panel scrolls inside. Under 1280 px the page becomes a drawer (opened from the top bar); under 1024 px it is one
// column and the page scrolls normally. Spec: internal/ui-v2-spec.md §3.

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
  const [pageOpen, setPageOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pageButtonRef = useRef<HTMLButtonElement>(null);
  const focusPage = useRef(false);

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

  // Under 1280 px the page is a drawer. It opens from the top bar, and by itself while picking a target on it.
  const picking = wb.pick.active;
  useEffect(() => setPageOpen(picking), [picking]);
  const closePage = useCallback(() => {
    setPageOpen(false);
    pageButtonRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!pageOpen) return;
    if (focusPage.current) document.getElementById("page-close")?.focus();
    focusPage.current = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.matchMedia("(max-width: 1279.98px)").matches) closePage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageOpen, closePage]);

  const overlay = picking && wb.isUrl;
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
        pageOpen={pageOpen}
        onTogglePage={() => {
          focusPage.current = !pageOpen;
          setPageOpen(!pageOpen);
        }}
        pageButtonRef={pageButtonRef}
      />

      <main
        id="main"
        tabIndex={-1}
        className="relative grid min-h-0 gap-3 outline-none lg:grid-cols-[256px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[256px_minmax(0,1fr)_340px] min-[1440px]:grid-cols-[272px_minmax(0,1fr)_400px]"
      >
        <TasksPanel wb={wb} />

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

        {pageOpen && <div className="fixed inset-0 z-30 bg-ink/30 xl:hidden" aria-hidden="true" onClick={closePage} />}
        <div
          id="page-column"
          className={cx(
            "min-h-0",
            // Under 1280 px: a drawer on the right.
            "max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:w-[min(30rem,100vw)] max-xl:bg-paper max-xl:p-3 max-xl:shadow-xl",
            !pageOpen && "max-xl:invisible max-xl:translate-x-full",
            // While picking a target on a typed-in page: wider, over the middle column.
            overlay ? "xl:absolute xl:inset-y-0 xl:right-0 xl:z-30 xl:w-[70vw]" : "xl:self-start",
          )}
        >
          <PagePanel wb={wb} fill={overlay} className={overlay ? "xl:shadow-xl" : ""} onClose={closePage} />
        </div>
      </main>

      <ChangeDrawer {...wb.drawer} />

      <Suspense fallback={null}>
        <DeepLinks wb={wb} onAddressError={openAddressField} />
      </Suspense>
    </div>
  );
}
