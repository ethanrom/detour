// Web Worker: runs evaluate and planFixes off the main thread so the page stays responsive while
// the optimiser makes its few hundred model runs. The PageModel and tasks are plain JSON.

import { evaluateAll, planAll, scanBarriers } from "./pipeline";
import type { EngineRequest, EngineResponse } from "./engine-client";

interface WorkerScope {
  onmessage: ((e: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.type === "evaluate") scope.postMessage({ id: req.id, ok: true, value: evaluateAll(req.page, req.tasks, req.samples) });
    else if (req.type === "scan") scope.postMessage({ id: req.id, ok: true, value: scanBarriers(req.page, req.siteId) });
    else scope.postMessage({ id: req.id, ok: true, value: planAll(req.page, req.tasks, req.k) });
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
