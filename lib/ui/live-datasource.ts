// The live DataSource: the real pipeline, in the browser.
//
//   same-origin iframe -> extractPage (real layout, so Fitts's law uses true geometry)
//     -> evaluate (Monte Carlo) + information-scent search      [Web Worker]
//     -> planFixes -> applyFixes -> evaluate again               [Web Worker]
//   optional LLM paths: POST /api/ground (custom tasks), POST /api/repair (heading suggestions).
//
// If the iframe cannot be read, `analyze` falls back to the sample data source and says so.

import { extractPage } from "@/lib/extract";
import type { PageModel, Task } from "@/lib/contracts";
import { SITES } from "@/fixtures/tasks";
import { LlmUnavailableError, type Analysis, type DataSource, type PlanOutcome, type RepairReport, type SiteInfo } from "./datasource";
import { createEngineClient, type EngineClient } from "./engine-client";

const FRAME_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One animation frame, but never hang in a background tab where rAF is paused. */
function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    win.requestAnimationFrame(() => win.requestAnimationFrame(finish));
    setTimeout(finish, 250);
  });
}

/** Resolve with the iframe's document once `path` has loaded (readyState "complete") and had a frame to lay out. */
export async function waitForFrameDocument(frame: HTMLIFrameElement | null, path: string, timeoutMs = FRAME_TIMEOUT_MS): Promise<Document> {
  if (!frame) throw new Error("The page preview is not on screen.");
  const want = new URL(path, window.location.href).href;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      throw new Error("The page preview is not same-origin, so it cannot be read.");
    }
    // A fresh iframe briefly holds a complete about:blank document, so check the URL too.
    if (doc && doc.readyState === "complete" && doc.URL === want && doc.body) {
      const win = frame.contentWindow;
      if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, sleep(1500)]);
      await nextFrame(win ?? window);
      return doc;
    }
    if (Date.now() > deadline) throw new Error(`The page preview did not finish loading ${path}.`);
    await sleep(40);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; details?: string[] };
    return [body.error, ...(body.details ?? [])].filter(Boolean).join(": ");
  } catch {
    return `HTTP ${res.status}`;
  }
}

export interface LiveOptions {
  engine?: EngineClient;
  /** Used when the iframe cannot be read. Results are then labelled as sample data. */
  fallback?: DataSource;
  fetchImpl?: typeof fetch;
}

export function createLiveDataSource({ engine, fallback, fetchImpl }: LiveOptions = {}): DataSource {
  let client: EngineClient | undefined = engine;
  const eng = () => (client ??= createEngineClient());
  const doFetch: typeof fetch = (...args) => (fetchImpl ?? fetch)(...args);

  return {
    async listSites() {
      return SITES.map((s): SiteInfo => ({ ...s }));
    },

    async analyze(site, frame) {
      try {
        const doc = await waitForFrameDocument(frame, site.path);
        const page: PageModel = extractPage(doc, { url: site.path });
        const results = await eng().evaluate(page, site.tasks);
        return { page, results, mode: "live" } satisfies Analysis;
      } catch (e) {
        if (!fallback) throw e;
        const a = await fallback.analyze(site, frame);
        return { ...a, mode: "sample", fallbackReason: e instanceof Error ? e.message : String(e) };
      }
    },

    async plan(site, analysis, k) {
      if (analysis.mode === "sample" && fallback) return fallback.plan(site, analysis, k);
      const { plan, page, results } = await eng().plan(analysis.page, site.tasks, k);
      return { plan, page, results } satisfies PlanOutcome;
    },

    async addTask(site, analysis, task) {
      const [result] = await eng().evaluate(analysis.page, [task]);
      return { ...analysis, results: [...analysis.results.filter((r) => r.taskId !== task.id), result] };
    },

    async groundTask(site, analysis, text): Promise<Task> {
      const res = await doFetch("/api/ground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: site.id, page: analysis.page, text }),
      });
      if (res.status === 503) throw new LlmUnavailableError();
      if (!res.ok) {
        const why = await readError(res);
        if (res.status === 422) throw new Error(`Claude could not match that to elements on this page (${why}). Try describing the steps differently.`);
        throw new Error(`Could not ground the task (${why}).`);
      }
      const body = (await res.json()) as { task: Task };
      return body.task;
    },

    async suggestRepairs(site, analysis): Promise<RepairReport | null> {
      if (analysis.mode === "sample") return null;
      let res: Response;
      try {
        res = await doFetch("/api/repair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteId: site.id, page: analysis.page, tasks: site.tasks }),
        });
      } catch {
        return null;
      }
      // 404: the route is not deployed. 501/503: no LLM. Either way the panel simply stays hidden.
      if (!res.ok) return null;
      const body = (await res.json()) as RepairReport;
      return Array.isArray(body.headings) ? body : null;
    },
  };
}
