import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { miniShop } from "@/fixtures/pagemodels/mini-shop";
import { converseTool } from "./bedrock";
import { GROUND_TOOL_NAME } from "./ground";
import { handleGroundRequest } from "./groundRoute";
import { checkLlmGuard, clientIp, IP_WINDOW_MS, llmGuardStats, MAX_BODY_BYTES, MAX_PAGE_NODES, resetLlmGuard } from "./guard";
import { scriptedSend, TEST_ENV, toolUseOutput } from "./testing";

const GOOD = { steps: [{ target: "size-m", action: "select" }, { target: "add-to-cart", action: "activate" }] };
const valid = { siteId: "mini-shop", page: miniShop, text: "Add the Trail Jacket in size M to the cart" };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ground", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const from = (ip: string) => new Request("http://localhost/api/ground", { method: "POST", headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

beforeEach(() => {
  resetLlmGuard();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("kill switch", () => {
  it("LLM_DISABLED=1 answers /api/ground like an unconfigured LLM and never calls Bedrock", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const res = await handleGroundRequest(post(valid), { env: { ...TEST_ENV, LLM_DISABLED: "1" }, send });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "llm-unavailable" });
    expect(calls).toHaveLength(0);
    // Any other value leaves the LLM on.
    const on = await handleGroundRequest(post(valid), { env: { ...TEST_ENV, LLM_DISABLED: "0" }, send });
    expect(on.status).toBe(200);
  });
});

describe("per-IP sliding window", () => {
  it("allows 10 calls per 10 minutes per IP, frees them as the window slides, and keeps IPs apart", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(checkLlmGuard(from("1.2.3.4"), { env: {}, now: t0 + i * 1000 })).toEqual({ allowed: true });
    const blocked = checkLlmGuard(from("1.2.3.4"), { env: {}, now: t0 + 10_000 });
    expect(blocked).toMatchObject({ allowed: false, reason: "rate-limited" });
    expect(checkLlmGuard(from("5.6.7.8"), { env: {}, now: t0 + 10_000 })).toEqual({ allowed: true });
    // The first call leaves the window after 10 minutes: exactly one slot frees up.
    expect(checkLlmGuard(from("1.2.3.4"), { env: {}, now: t0 + IP_WINDOW_MS + 1 })).toEqual({ allowed: true });
    expect(checkLlmGuard(from("1.2.3.4"), { env: {}, now: t0 + IP_WINDOW_MS + 2 })).toMatchObject({ allowed: false, reason: "rate-limited" });
  });

  it("reads the client from x-forwarded-for (first entry), then x-real-ip", () => {
    expect(clientIp(from("9.9.9.9"))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("answers /api/ground with 429 rate-limited, without a Bedrock call", async () => {
    const env = { ...TEST_ENV, LLM_RATE_LIMIT: "1" };
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    expect((await handleGroundRequest(post(valid), { env, send })).status).toBe(200);
    const res = await handleGroundRequest(post(valid), { env, send });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate-limited" });
    expect(calls).toHaveLength(1);
  });
});

describe("daily cap", () => {
  it("behaves like the kill switch once LLM_DAILY_CAP calls are spent, for every IP, until the next UTC day", async () => {
    const env = { LLM_DAILY_CAP: "3" };
    const t0 = Date.UTC(2026, 9, 18, 12);
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) expect(checkLlmGuard(from(ip), { env, now: t0 })).toEqual({ allowed: true });
    expect(checkLlmGuard(from("4.4.4.4"), { env, now: t0 + 1 })).toMatchObject({ allowed: false, reason: "daily-cap" });
    expect(llmGuardStats().callsToday).toBe(3);
    expect(checkLlmGuard(from("1.1.1.1"), { env, now: t0 + 86_400_000 })).toEqual({ allowed: true });

    // Through the route: a spent cap is a 503 llm-unavailable and no call is made.
    resetLlmGuard();
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const capped = { ...TEST_ENV, LLM_DAILY_CAP: "0" };
    const res = await handleGroundRequest(post(valid), { env: capped, send });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe("input limits", () => {
  it("rejects an oversized body or an oversized page with 413, and over-long text with 400, before any model call", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const deps = { env: TEST_ENV, send };

    const huge = await handleGroundRequest(post({ ...valid, pad: "x".repeat(MAX_BODY_BYTES + 1) }), deps);
    expect(huge.status).toBe(413);
    const declared = await handleGroundRequest(post(valid, { "content-length": String(MAX_BODY_BYTES + 1) }), deps);
    expect(declared.status).toBe(413);

    const nodes = Object.fromEntries(Array.from({ length: MAX_PAGE_NODES + 1 }, (_, i) => [`n${i}`, 0]));
    const wide = await handleGroundRequest(post({ ...valid, page: { ...miniShop, nodes } }), deps);
    expect(wide.status).toBe(413);

    const long = await handleGroundRequest(post({ ...valid, text: "x".repeat(201) }), deps);
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("bad-request");
    expect(calls).toHaveLength(0);

    const edge = await handleGroundRequest(post({ ...valid, text: "x".repeat(200) }), deps);
    expect(edge.status).toBe(200);
  });
});

describe("output cap", () => {
  it("sets inferenceConfig.maxTokens on every Converse call, even when the caller asks for none or too much", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    await handleGroundRequest(post(valid), { env: TEST_ENV, send });
    expect(calls[0].inferenceConfig?.maxTokens).toBe(400);

    const opts = { tier: "fast" as const, system: "s", user: "u", toolName: GROUND_TOOL_NAME, description: "d", inputSchema: {}, parse: (x: unknown) => x, env: TEST_ENV, send };
    await converseTool(opts);
    await converseTool({ ...opts, maxTokens: 100_000 });
    expect(calls[1].inferenceConfig?.maxTokens).toBe(512);
    expect(calls[2].inferenceConfig?.maxTokens).toBeLessThanOrEqual(1024);
  });
});
