// Abuse protection for the two routes that call Bedrock (/api/ground and /api/repair).
//
// The app is public and the Bedrock key is the owner's, so every route that can reach the model first
// passes through here:
//   * kill switch        LLM_DISABLED=1            -> behave as if no LLM is configured
//   * daily cap          LLM_DAILY_CAP (300)       -> past it, behave like the kill switch until the next UTC day
//   * per-IP limit       LLM_RATE_LIMIT (10) calls per 10 minutes, sliding window
//   * input limits       body size, page node count, text length, task count (see the constants below)
//   * output cap         every Converse call sets inferenceConfig.maxTokens (see bedrock.ts)
// Counters live in this instance's memory: they bound each warm serverless instance, not the whole fleet.
// A scoped IAM key and an AWS Budgets action are the real backstop (docs/OPERATIONS.md).
// Logs carry counts only: never bodies, client addresses or secrets.

import type { Env } from "./bedrock";

export const DEFAULT_DAILY_CAP = 300;
export const DEFAULT_IP_LIMIT = 10;
export const IP_WINDOW_MS = 10 * 60_000;

/** Largest accepted JSON request body, in bytes. Larger bodies are answered with 413. */
export const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
/** Largest accepted page model, in nodes. Larger pages are answered with 413. */
export const MAX_PAGE_NODES = 4000;
/** Longest accepted task description for /api/ground, in characters. */
export const MAX_GROUND_TEXT = 200;
/** Most tasks accepted by /api/repair. */
export const MAX_REPAIR_TASKS = 6;

/** Output caps for Converse calls (inferenceConfig.maxTokens). */
export const GROUND_MAX_TOKENS = 400;
export const REPAIR_MAX_TOKENS = 512;

const MAX_TRACKED_IPS = 5000;
const DAY_MS = 86_400_000;
const LOG_EVERY_MS = 60_000;

export type GuardReason = "disabled" | "daily-cap" | "rate-limited";
export type GuardDecision = { allowed: true } | { allowed: false; reason: GuardReason; retryAfterSec?: number };

function intFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return raw?.trim() && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** True when the owner has switched the LLM off (LLM_DISABLED=1). */
export function isLlmDisabled(env: Env = process.env): boolean {
  return env.LLM_DISABLED?.trim() === "1";
}

/** Client address from x-forwarded-for (first entry) or x-real-ip; "unknown" when neither is present. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, 64) : "unknown";
}

// --- state (per instance) ---------------------------------------------------------------------------

const hits = new Map<string, number[]>(); // ip -> timestamps (ms) of counted calls, ascending
let dayIndex = -1;
let dayCount = 0;
const lastLogged = new Map<GuardReason, number>();

/** Clears every counter. Tests only. */
export function resetLlmGuard(): void {
  hits.clear();
  dayIndex = -1;
  dayCount = 0;
  lastLogged.clear();
}

/** Counts only, for logs and tests. */
export function llmGuardStats(): { callsToday: number; trackedClients: number } {
  return { callsToday: dayCount, trackedClients: hits.size };
}

function prune(now: number): void {
  for (const [ip, stamps] of hits) {
    if (stamps.length === 0 || stamps[stamps.length - 1] <= now - IP_WINDOW_MS) hits.delete(ip);
  }
  // Still too many distinct addresses: forget the oldest (Map keeps insertion order).
  for (const ip of hits.keys()) {
    if (hits.size <= MAX_TRACKED_IPS) break;
    hits.delete(ip);
  }
}

function blocked(reason: GuardReason, cap: number, now: number, retryAfterSec?: number): GuardDecision {
  if (now - (lastLogged.get(reason) ?? -Infinity) >= LOG_EVERY_MS) {
    lastLogged.set(reason, now);
    console.warn(`[llm-guard] blocked (${reason}); calls today ${dayCount}/${cap}, clients tracked ${hits.size}`);
  }
  return { allowed: false, reason, retryAfterSec };
}

/**
 * Decides whether this request may reach Bedrock, and counts it when it may. Call it once per request,
 * after the request has been validated and immediately before the model call. Order: kill switch,
 * daily cap, then the per-IP sliding window (a call refused for the window is not counted toward the day).
 */
export function checkLlmGuard(req: Request, opts: { env?: Env; now?: number } = {}): GuardDecision {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const cap = intFrom(env.LLM_DAILY_CAP, DEFAULT_DAILY_CAP);
  const limit = intFrom(env.LLM_RATE_LIMIT, DEFAULT_IP_LIMIT);

  if (isLlmDisabled(env)) return blocked("disabled", cap, now);

  const today = Math.floor(now / DAY_MS);
  if (today !== dayIndex) {
    dayIndex = today;
    dayCount = 0;
  }
  if (dayCount >= cap) return blocked("daily-cap", cap, now);

  const ip = clientIp(req);
  const stamps = (hits.get(ip) ?? []).filter((t) => t > now - IP_WINDOW_MS);
  if (stamps.length >= limit) {
    if (stamps.length) hits.set(ip, stamps);
    const retry = stamps.length ? Math.ceil((stamps[0] + IP_WINDOW_MS - now) / 1000) : Math.ceil(IP_WINDOW_MS / 1000);
    return blocked("rate-limited", cap, now, Math.max(1, retry));
  }
  stamps.push(now);
  hits.delete(ip); // re-insert so Map order tracks recency
  hits.set(ip, stamps);
  dayCount++;
  if (hits.size > MAX_TRACKED_IPS) prune(now);
  return { allowed: true };
}

// --- request bodies ---------------------------------------------------------------------------------

export type BodyResult =
  | { ok: true; json: unknown }
  | { ok: false; status: 400 | 413; error: "bad-request" | "payload-too-large"; details: string[] };

const tooLarge = (): BodyResult => ({
  ok: false,
  status: 413,
  error: "payload-too-large",
  details: [`The request body is larger than ${Math.round(MAX_BODY_BYTES / 1024)} KB.`],
});

/** Reads and parses a JSON body without ever holding more than `maxBytes` of it: 413 past the limit, 400 when malformed. */
export async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, json: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400, error: "bad-request", details: ["Body must be valid JSON."] };
  }
}

/** Number of nodes in `body.page.nodes`, or 0 when the body does not have that shape (zod then rejects it). */
export function pageNodeCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const page = (body as { page?: unknown }).page;
  if (!page || typeof page !== "object") return 0;
  const nodes = (page as { nodes?: unknown }).nodes;
  return nodes && typeof nodes === "object" ? Object.keys(nodes).length : 0;
}

/** The 413 response for a page model over MAX_PAGE_NODES. */
export function pageTooLargeResponse(): Response {
  return Response.json({ error: "payload-too-large", details: [`The page has more than ${MAX_PAGE_NODES} nodes.`] }, { status: 413 });
}
