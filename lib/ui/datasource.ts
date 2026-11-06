// The seam between the UI and everything that produces numbers.
//
// The UI only ever talks to a DataSource. `lib/ui/mock-datasource.ts` implements it from hand-written
// fixtures so the whole product can be built and demoed without the engine. The integrator swaps in a
// live implementation (extract -> ground -> evaluate -> planFixes) by changing one line in
// `components/DataSourceProvider.tsx`.

import type { FixPlan, PageModel, Task, TaskResult } from "@/lib/contracts";

export interface SiteInfo {
  id: string;
  name: string;
  tagline: string;
  /** Same-origin URL of the page, e.g. "/sites/northwind/index.html". */
  path: string;
  /** "control" is a well-built page that shows Detour does not cry wolf. */
  kind: "demo" | "control";
  tasks: Task[];
}

export interface Analysis {
  page: PageModel;
  /** One TaskResult per task of the site, in task order. */
  results: TaskResult[];
}

/** `page` and `results` are AFTER applying `plan.chosen`. */
export interface PlanOutcome {
  plan: FixPlan;
  page: PageModel;
  results: TaskResult[];
}

export interface DataSource {
  listSites(): Promise<SiteInfo[]>;
  /** Extract the page (from `frame` when it is loaded and same-origin) and evaluate every task of the site. */
  analyze(site: SiteInfo, frame: HTMLIFrameElement | null): Promise<Analysis>;
  /** Choose up to `k` fixes and evaluate the patched page. */
  plan(site: SiteInfo, analysis: Analysis, k: number): Promise<PlanOutcome>;
  /** Optional: ground a free-text task to page elements (LLM, validated). */
  groundTask?(site: SiteInfo, analysis: Analysis, text: string): Promise<Task>;
}

/** Shown in the UI so nobody mistakes fixture numbers for engine output. */
export type DataSourceMode = "sample" | "live";
