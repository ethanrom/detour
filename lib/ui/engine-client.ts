// Runs the pipeline in a Web Worker when the browser has one, and on the main thread otherwise
// (yielding with setTimeout first so React can paint a "Planning…" state).

import type { PageModel, Task, TaskResult } from "@/lib/contracts";
import { evaluateAll, planAll, scanBarriers, type PlanResult } from "./pipeline";

export type EngineRequest =
  | { id: number; type: "evaluate"; page: PageModel; tasks: Task[] }
  | { id: number; type: "plan"; page: PageModel; tasks: Task[]; k: number }
  | { id: number; type: "scan"; page: PageModel; siteId: string };

type EngineValue = TaskResult[] | PlanResult | Task[];

export type EngineResponse = { id: number; ok: true; value: EngineValue } | { id: number; ok: false; error: string };

export interface EngineClient {
  evaluate(page: PageModel, tasks: Task[]): Promise<TaskResult[]>;
  plan(page: PageModel, tasks: Task[], k: number): Promise<PlanResult>;
  /** Suggested tasks: controls some people cannot use (see scanBarriers). */
  scan(page: PageModel, siteId: string): Promise<Task[]>;
  /** Where the work last ran. "worker" unless the worker could not start. */
  readonly where: "worker" | "main";
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 30));

const WORKER_FAILED = "worker-failed";

/** Same work on the main thread. */
export function createMainThreadEngine(): EngineClient {
  return {
    where: "main",
    async evaluate(page, tasks) {
      await yieldToUi();
      return evaluateAll(page, tasks);
    },
    async plan(page, tasks, k) {
      await yieldToUi();
      return planAll(page, tasks, k);
    },
    async scan(page, siteId) {
      await yieldToUi();
      return scanBarriers(page, siteId);
    },
  };
}

export function createEngineClient(): EngineClient {
  if (typeof Worker === "undefined") return createMainThreadEngine();
  const fallback = createMainThreadEngine();
  let worker: Worker | null = null;
  let dead = false;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: EngineValue) => void; reject: (e: Error) => void }>();

  const start = (): Worker | null => {
    if (dead) return null;
    if (worker) return worker;
    try {
      const w = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<EngineResponse>) => {
        const msg = e.data;
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error));
      };
      w.onerror = () => {
        // The worker failed to load or crashed: stop using it and let callers retry on the main thread.
        dead = true;
        worker = null;
        w.terminate();
        for (const p of pending.values()) p.reject(new Error(WORKER_FAILED));
        pending.clear();
      };
      worker = w;
      return w;
    } catch {
      dead = true;
      return null;
    }
  };

  function call<T extends EngineValue>(req: (id: number) => EngineRequest, retry: () => Promise<T>): Promise<T> {
    const w = start();
    if (!w) return retry();
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: EngineValue) => void, reject });
      w.postMessage(req(id));
    }).catch((e: Error) => (e.message === WORKER_FAILED ? retry() : Promise.reject(e)));
  }

  return {
    get where() {
      return dead ? "main" : "worker";
    },
    evaluate: (page, tasks) => call((id) => ({ id, type: "evaluate", page, tasks }), () => fallback.evaluate(page, tasks)),
    plan: (page, tasks, k) => call((id) => ({ id, type: "plan", page, tasks, k }), () => fallback.plan(page, tasks, k)),
    scan: (page, siteId) => call((id) => ({ id, type: "scan", page, siteId }), () => fallback.scan(page, siteId)),
  };
}
