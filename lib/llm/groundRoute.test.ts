import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ground/route";
import { miniShop } from "@/fixtures/pagemodels/mini-shop";
import { GROUND_TOOL_NAME } from "./ground";
import { handleGroundRequest } from "./groundRoute";
import { scriptedSend, TEST_ENV, toolUseOutput } from "./testing";

const GOOD = { steps: [{ target: "size-m", action: "select" }, { target: "add-to-cart", action: "activate" }] };
const BAD = { steps: [{ target: "nope", action: "select" }] };

function post(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/ground", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const valid = { siteId: "mini-shop", page: miniShop, text: "Add the Trail Jacket in size M to the cart" };

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ground", () => {
  it("returns 503 llm-unavailable when the environment is absent", async () => {
    for (const k of Object.keys(TEST_ENV)) vi.stubEnv(k, "");
    const res = await POST(post(valid));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "llm-unavailable" });
  });

  it("returns 503 for an injected empty env, even with a valid body", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const res = await handleGroundRequest(post(valid), { env: {}, send });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("returns 200 { task } when grounding succeeds", async () => {
    const { send } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const res = await handleGroundRequest(post(valid), { env: TEST_ENV, send });
    expect(res.status).toBe(200);
    const { task } = await res.json();
    expect(task).toMatchObject({ siteId: "mini-shop", label: valid.text, grounding: "llm" });
    expect(task.id).toMatch(/^custom-/);
    expect(task.steps.map((s: { target: string }) => s.target)).toEqual(["size-m", "add-to-cart"]);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await handleGroundRequest(post("{not json", true), { env: TEST_ENV });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad-request");
  });

  it.each([
    ["missing text", { siteId: "s", page: miniShop }],
    ["empty text", { ...valid, text: "   " }],
    ["over-long text", { ...valid, text: "x".repeat(501) }],
    ["missing siteId", { page: miniShop, text: "t" }],
    ["page of the wrong shape", { ...valid, page: { version: 1 } }],
    ["page with the wrong version", { ...valid, page: { ...miniShop, version: 2 } }],
    ["a non-object body", "hello"],
  ])("returns 400 for %s", async (_name, body) => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const res = await handleGroundRequest(post(body), { env: TEST_ENV, send });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad-request");
    expect(Array.isArray(json.details)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("returns 422 with details when grounding fails validation twice", async () => {
    const { send } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, BAD));
    const res = await handleGroundRequest(post(valid), { env: TEST_ENV, send });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("grounding-failed");
    expect(json.details[0]).toContain('unknown id "nope"');
  });

  it("returns 502 without leaking secrets when Bedrock itself fails", async () => {
    const { send } = scriptedSend(new Error(`bad credentials ${TEST_ENV.CLAUDE_AWS_SECRET_KEY}`));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleGroundRequest(post(valid), { env: TEST_ENV, send });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(TEST_ENV.CLAUDE_AWS_SECRET_KEY);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TEST_ENV.CLAUDE_AWS_SECRET_KEY);
    spy.mockRestore();
  });
});
