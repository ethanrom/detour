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
  /** Where the numbers came from. Absent means the data source's own mode. */
  mode?: DataSourceMode;
  /** Why the live pipeline was not used (set together with mode "sample"). */
  fallbackReason?: string;
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
  /** Optional: ground a free-text task to page elements (LLM, validated). Rejects with
   *  `LlmUnavailableError` when the server has no LLM credentials. */
  groundTask?(site: SiteInfo, analysis: Analysis, text: string): Promise<Task>;
  /** Optional: evaluate one more task (for example a grounded custom task) on an existing analysis.
   *  Returns the analysis with that task's result appended. */
  addTask?(site: SiteInfo, analysis: Analysis, task: Task): Promise<Analysis>;
  /** Optional: LLM-proposed, scent-verified heading and label suggestions. Resolves to null when the
   *  server does not offer them. `site.tasks` are the tasks the suggestions are verified against. */
  suggestRepairs?(site: SiteInfo, analysis: Analysis): Promise<RepairReport | null>;
}

/** The LLM proposes, the scent model verifies. Mirrors the response of POST /api/repair. */
export interface RepairReport {
  /** True when at least one heading rename was accepted and applied to the page used for the verdict. */
  promoted: boolean;
  headings: Array<{
    nodeId: string;
    original: string;
    proposed: string;
    source: "llm" | "fallback";
    /** Realistic-search seconds before and after the rename. */
    before: number;
    after: number;
    savedSeconds: number;
    accepted: boolean;
  }>;
  labels: Array<{ nodeId: string; proposed: string; source: "llm" | "fallback" }>;
}

/** Thrown by `groundTask` when the server has no LLM keys configured (HTTP 503). */
export class LlmUnavailableError extends Error {
  constructor() {
    super("Custom tasks need the LLM (Bedrock) configured.");
    this.name = "LlmUnavailableError";
  }
}

/** Shown in the UI so nobody mistakes fixture numbers for engine output. */
export type DataSourceMode = "sample" | "live";
