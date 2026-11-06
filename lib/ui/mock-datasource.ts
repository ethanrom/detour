// A DataSource backed by hand-calibrated JSON in fixtures/results/ (see generate.mjs there).
// It lets the whole product be built, tested and demoed without the extractor, engine or optimiser.
// The numbers are NOT engine output; the UI labels them "Sample data" while this source is active.

import type { FixGain, FixPlan, FixSpec, PageModel, Task, TaskResult } from "@/lib/contracts";
import { miniShop } from "@/fixtures/pagemodels/mini-shop";
import type { Analysis, DataSource, PlanOutcome, SiteInfo } from "./datasource";
import sitesIndex from "@/fixtures/results/sites.json";

export interface PlanScenario {
  chosen: string[];
  plannedObjective: number;
  method: "greedy" | "greedy+exhaustive";
  exhaustiveObjective?: number;
  optimalityGap?: number;
  evaluations: number;
  gains: FixGain[];
  results: TaskResult[];
}

export interface SiteFixture {
  site: Omit<SiteInfo, "tasks">;
  tasks: Task[];
  baseline: TaskResult[];
  baselineObjective: number;
  candidates: FixSpec[];
  /** Greedy pick order of candidate ids. Empty when nothing is worth fixing. */
  order: string[];
  /** Scenario after applying the first k picks, keyed by k ("1".."5"). */
  byK: Record<string, PlanScenario>;
}

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  northwind: () => import("@/fixtures/results/northwind.json"),
  riverside: () => import("@/fixtures/results/riverside.json"),
  alpine: () => import("@/fixtures/results/alpine.json"),
};

const cache = new Map<string, Promise<SiteFixture>>();

export function loadFixture(siteId: string): Promise<SiteFixture> {
  let p = cache.get(siteId);
  if (!p) {
    const load = loaders[siteId];
    if (!load) return Promise.reject(new Error(`No sample data for site "${siteId}".`));
    p = load().then((m) => m.default as SiteFixture);
    cache.set(siteId, p);
  }
  return p;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The page model the mock returns. Only the fields the UI touches matter; this is the mini-shop fixture. */
function pageFor(site: SiteInfo): PageModel {
  return { ...miniShop, url: site.path, title: site.name };
}

/** A very small stand-in for applyFix, so `PlanOutcome.page` differs from the original. */
function patchPage(page: PageModel, chosen: readonly FixSpec[]): PageModel {
  const nodes = { ...page.nodes };
  for (const fix of chosen) {
    for (const id of fix.targets) {
      const n = nodes[id];
      if (!n) continue;
      if (fix.kind === "real-button") {
        nodes[id] = { ...n, role: "button", focusable: true, hints: { ...n.hints, fakeButton: false }, announcement: `button, ${n.name}` };
      } else if (fix.kind === "add-label") {
        nodes[id] = { ...n, name: String(fix.params.name ?? n.name), hints: { ...n.hints, unlabeled: false }, announcement: `button, ${String(fix.params.name ?? n.name)}` };
      } else if (fix.kind === "promote-heading") {
        nodes[id] = { ...n, role: "heading", level: Number(fix.params.level ?? 2), hints: { ...n.hints, looksLikeHeading: undefined }, announcement: `heading, level ${Number(fix.params.level ?? 2)}, ${n.name}` };
      }
    }
  }
  return { ...page, nodes };
}

export interface MockOptions {
  /** Simulated latency in ms (set to 0 in tests). */
  latencyMs?: number;
}

export function createMockDataSource({ latencyMs = 700 }: MockOptions = {}): DataSource {
  return {
    async listSites() {
      return sitesIndex as unknown as SiteInfo[];
    },

    async analyze(site) {
      const fx = await loadFixture(site.id);
      await sleep(latencyMs);
      const analysis: Analysis = { page: pageFor(site), results: fx.baseline };
      return analysis;
    },

    async plan(site, analysis, k) {
      const fx = await loadFixture(site.id);
      await sleep(Math.round(latencyMs * 0.7));
      const want = Math.max(1, Math.min(5, Math.round(k)));
      const kk = Math.min(want, fx.order.length);
      if (kk === 0) {
        const plan: FixPlan = {
          candidates: fx.candidates,
          chosen: [],
          gains: [],
          baselineObjective: fx.baselineObjective,
          plannedObjective: fx.baselineObjective,
          k: want,
          method: "greedy+exhaustive",
          exhaustiveObjective: fx.baselineObjective,
          optimalityGap: 0,
          evaluations: fx.candidates.length + 1,
        };
        return { plan, page: analysis.page, results: fx.baseline } satisfies PlanOutcome;
      }
      const sc = fx.byK[String(kk)];
      const chosen = sc.chosen.map((id) => fx.candidates.find((c) => c.id === id)).filter((c): c is FixSpec => !!c);
      const plan: FixPlan = {
        candidates: fx.candidates,
        chosen,
        gains: sc.gains,
        baselineObjective: fx.baselineObjective,
        plannedObjective: sc.plannedObjective,
        k: want,
        method: sc.method,
        ...(sc.exhaustiveObjective !== undefined ? { exhaustiveObjective: sc.exhaustiveObjective } : {}),
        ...(sc.optimalityGap !== undefined ? { optimalityGap: sc.optimalityGap } : {}),
        evaluations: sc.evaluations,
      };
      return { plan, page: patchPage(analysis.page, chosen), results: sc.results } satisfies PlanOutcome;
    },
  };
}

export const mockDataSource: DataSource = createMockDataSource();
