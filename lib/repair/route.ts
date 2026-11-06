// Request handler behind POST /api/repair. Kept out of app/api/repair/route.ts because a Next.js route
// module may only export HTTP methods and route config, and tests need to inject `send`/`env`.

import { repairPage } from "./index";
import { repairRequestSchema } from "./schemas";
import type { LlmOptions } from "./types";

/**
 * POST { siteId, page, tasks } -> 200 RepairReport
 *   400 { error: "bad-request", details }  body failed validation
 * Always 200 for a valid body, even with no LLM configured or a failing one: proposals then carry
 * `source: "fallback"`, so the demo works offline. Never logs request bodies or secrets.
 */
export async function handleRepairRequest(req: Request, deps: LlmOptions = {}): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "bad-request", details: ["Body must be valid JSON."] }, { status: 400 });
  }
  const parsed = repairRequestSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return Response.json({ error: "bad-request", details }, { status: 400 });
  }
  try {
    const report = await repairPage(parsed.data.page, parsed.data.tasks, deps);
    return Response.json(report);
  } catch {
    console.error("[repair] unexpected error");
    return Response.json({ error: "internal-error" }, { status: 500 });
  }
}
