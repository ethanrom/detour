// Request handler behind POST /api/ground. Kept out of app/api/ground/route.ts because a Next.js
// route module may only export HTTP methods and route config, and tests need to inject `send`/`env`.

import { GroundingError, groundTask } from "./ground";
import { isLlmConfigured, LlmError, LlmNotConfiguredError, type ConverseSend, type Env } from "./bedrock";
import { checkLlmGuard, isLlmDisabled, MAX_PAGE_NODES, pageNodeCount, pageTooLargeResponse, readJsonBody } from "./guard";
import { groundRequestSchema } from "./schemas";

export interface GroundRouteDeps {
  send?: ConverseSend;
  env?: Env;
  /** Test seam: replaces Date.now() for the rate limiter. */
  now?: number;
}

/**
 * POST { siteId, page, text } -> 200 { task }
 *   503 { error: "llm-unavailable" }            Bedrock not configured, LLM_DISABLED=1, or LLM_DAILY_CAP reached
 *                                               (the UI falls back to fixtures)
 *   429 { error: "rate-limited" }               too many calls from this IP (Retry-After says when to retry)
 *   413 { error: "payload-too-large" }          body over 1.5 MB or page over 4,000 nodes
 *   400 { error: "bad-request", details }       body failed validation (text is at most 200 characters)
 *   422 { error: "grounding-failed", details }  the model could not produce valid steps
 *   502 { error: "llm-request-failed" }         Bedrock call failed (network, auth, throttling)
 * Never logs request bodies or secrets.
 */
export async function handleGroundRequest(req: Request, deps: GroundRouteDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  if (isLlmDisabled(env) || !isLlmConfigured(env)) return Response.json({ error: "llm-unavailable" }, { status: 503 });

  const body = await readJsonBody(req);
  if (!body.ok) return Response.json({ error: body.error, details: body.details }, { status: body.status });
  if (pageNodeCount(body.json) > MAX_PAGE_NODES) return pageTooLargeResponse();
  const parsed = groundRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return Response.json({ error: "bad-request", details }, { status: 400 });
  }

  const verdict = checkLlmGuard(req, { env, now: deps.now });
  if (!verdict.allowed) {
    if (verdict.reason === "rate-limited") {
      return Response.json({ error: "rate-limited" }, { status: 429, headers: { "retry-after": String(verdict.retryAfterSec ?? 60) } });
    }
    return Response.json({ error: "llm-unavailable" }, { status: 503 });
  }

  const { siteId, page, text } = parsed.data;
  try {
    const task = await groundTask(page, text, { siteId, send: deps.send, env });
    return Response.json({ task });
  } catch (err) {
    if (err instanceof GroundingError) {
      return Response.json({ error: "grounding-failed", details: err.details }, { status: 422 });
    }
    if (err instanceof LlmNotConfiguredError) return Response.json({ error: "llm-unavailable" }, { status: 503 });
    if (err instanceof LlmError) {
      console.error(`[ground] LLM request failed (${err.code})`);
      return Response.json({ error: "llm-request-failed" }, { status: 502 });
    }
    console.error("[ground] unexpected error");
    return Response.json({ error: "internal-error" }, { status: 500 });
  }
}
