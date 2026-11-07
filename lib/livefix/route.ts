// Request handler behind POST /api/fix. Kept out of app/api/fix/route.ts because a Next.js route module may only
// export HTTP methods and route config, and tests need to inject `send`/`env`.

import { isLlmConfigured, type ConverseSend, type Env } from "@/lib/llm/bedrock";
import { checkLlmGuard, readJsonBody } from "@/lib/llm/guard";
import { writeEdits } from "./agent";
import { fallbackEdits } from "./fallback";
import { recordedEdits, recordEdits } from "./recorded";
import { fixRunRequestSchema } from "./schemas";
import type { FixEdits, FixRequestItem, FixRunEvent } from "./types";
import { validateEdits } from "./validate";

export interface FixRouteDeps {
  /** Test seam: replaces the real Bedrock client (also pass `env` so the tier resolves). */
  send?: ConverseSend;
  /** Test seam: replaces process.env. */
  env?: Env;
  /** Test seam: replaces Date.now() for the rate limiter. */
  now?: number;
  /** Test seam: directory that recording mode writes to (default fixtures/fix). */
  recordDir?: string;
}

export const NDJSON_TYPE = "application/x-ndjson";

/**
 * POST { siteId, pageTitle, fixes } -> 200 application/x-ndjson, one line per fix as it settles, then done:
 *   {"type":"edits","result":FixEdits}   {"type":"error","fixId","reason"}   {"type":"done"}
 *   413 { error: "payload-too-large" }     body over 1.5 MB
 *   400 { error: "bad-request", details }  body failed validation (at most 5 fixes, 30 targets each)
 * Always 200 for a valid body. Each fix is answered from, in order: a recording (demo sites), the agent (when
 * the LLM is configured, the kill switch is off and the guard allows this run, which is checked once per run),
 * or the deterministic fallback. Never logs request bodies or secrets: one line per fix with kind, source, ms.
 */
export async function handleFixRequest(req: Request, deps: FixRouteDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const body = await readJsonBody(req);
  if (!body.ok) return Response.json({ error: body.error, details: body.details }, { status: body.status });
  const parsed = fixRunRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return Response.json({ error: "bad-request", details }, { status: 400 });
  }
  const { siteId, pageTitle, fixes } = parsed.data;

  // Recordings need no model and no guard. The guard counts one call per run, and only when a model may be used.
  const recorded = new Map<string, FixEdits>();
  for (const item of fixes) {
    const hit = recordedEdits(siteId, item);
    if (hit) recorded.set(item.fixId, hit);
  }
  const agentAllowed = recorded.size < fixes.length && isLlmConfigured(env) && checkLlmGuard(req, { env, now: deps.now }).allowed;

  async function settle(item: FixRequestItem): Promise<FixRunEvent> {
    const started = performance.now();
    const done = (result: FixEdits): FixRunEvent => {
      console.info(`[fix] ${item.kind} ${result.source} ${result.ms ?? Math.round(performance.now() - started)}ms`);
      return { type: "edits", result };
    };
    try {
      const hit = recorded.get(item.fixId);
      if (hit) return done(hit);
      if (agentAllowed) {
        try {
          const result = await writeEdits(item, { send: deps.send, env: deps.env, pageTitle });
          await recordEdits(siteId, item, result, { env, dir: deps.recordDir });
          return done(result);
        } catch {
          console.error(`[fix] agent failed (${item.kind})`);
        }
      }
      const fallback = fallbackEdits(item);
      const checked = validateEdits(item, fallback);
      if (!("ok" in checked)) {
        console.error(`[fix] no safe edit for ${item.kind}`);
        return { type: "error", fixId: item.fixId, reason: "No safe edit could be written for this fix." };
      }
      return done({ ...checked.ok, source: "fallback" });
    } catch {
      console.error(`[fix] unexpected error (${item.kind})`);
      return { type: "error", fixId: item.fixId, reason: "The fix could not be written." };
    }
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: FixRunEvent): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client went away
        }
      };
      try {
        await Promise.all(fixes.map(async (item) => write(await settle(item))));
        write({ type: "done" });
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": NDJSON_TYPE, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
