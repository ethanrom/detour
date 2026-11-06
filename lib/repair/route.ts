// Request handler behind POST /api/repair. Kept out of app/api/repair/route.ts because a Next.js route
// module may only export HTTP methods and route config, and tests need to inject `send`/`env`.

import { isLlmConfigured } from "@/lib/llm/bedrock";
import { checkLlmGuard, MAX_PAGE_NODES, pageNodeCount, pageTooLargeResponse, readJsonBody } from "@/lib/llm/guard";
import { cachedRepairReport } from "./cache";
import { repairPage } from "./index";
import { repairRequestSchema } from "./schemas";
import type { LlmOptions, RepairReport } from "./types";

export interface RepairRouteDeps extends LlmOptions {
  /** Test seam: replaces Date.now() for the rate limiter. */
  now?: number;
  /** Test seam: replaces the recorded demo reports. */
  demoReports?: Record<string, RepairReport>;
}

/**
 * POST { siteId, page, tasks } -> 200 RepairReport
 *   413 { error: "payload-too-large" }     body over 1.5 MB or page over 4,000 nodes
 *   400 { error: "bad-request", details }  body failed validation (at most 6 tasks)
 * Always 200 for a valid body, even with no LLM configured, the kill switch on, a spent daily cap or a
 * failing LLM: proposals then carry `source: "fallback"`, so the page never breaks. Over the per-IP rate
 * limit the answer is the same fallback report plus `limited: true`. A demo site's page is answered from its
 * recorded Claude report (`cached: true`) without any model call. Never logs request bodies or secrets.
 */
export async function handleRepairRequest(req: Request, deps: RepairRouteDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const body = await readJsonBody(req);
  if (!body.ok) return Response.json({ error: body.error, details: body.details }, { status: body.status });
  if (pageNodeCount(body.json) > MAX_PAGE_NODES) return pageTooLargeResponse();
  const parsed = repairRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return Response.json({ error: "bad-request", details }, { status: 400 });
  }
  const { siteId, page, tasks } = parsed.data;

  const recorded = cachedRepairReport(siteId, page, deps.demoReports);
  if (recorded) return Response.json({ ...recorded, cached: true });

  // Offline (nothing configured) needs no guard: it makes no model call. Otherwise the guard decides; when it
  // refuses, run repairPage with an empty environment, which is the deterministic offline path.
  let opts: LlmOptions = { send: deps.send, env: deps.env };
  let limited = false;
  if (isLlmConfigured(env)) {
    const verdict = checkLlmGuard(req, { env, now: deps.now });
    if (!verdict.allowed) {
      opts = { env: {} };
      limited = verdict.reason === "rate-limited";
    }
  }
  try {
    const report = await repairPage(page, tasks, opts);
    return Response.json(limited ? { ...report, limited: true } : report);
  } catch {
    console.error("[repair] unexpected error");
    return Response.json({ error: "internal-error" }, { status: 500 });
  }
}
