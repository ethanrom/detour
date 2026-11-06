import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SITES } from "@/fixtures/tasks";
import { DEMO_REPAIR_REPORTS } from "@/fixtures/repair";
import type { PageModel } from "@/lib/contracts";
import type { ConverseSend } from "@/lib/llm/bedrock";
import { resetLlmGuard } from "@/lib/llm/guard";
import { TEST_ENV, toolUseOutput, userTextOf } from "@/lib/llm/testing";
import { handleRepairRequest } from "./route";
import { loadSite } from "./testing";
import type { RepairReport } from "./types";

let riverside: PageModel;
const tasks = SITES.find((s) => s.id === "riverside")!.tasks;

beforeAll(async () => {
  riverside = await loadSite("riverside");
}, 60_000);
beforeEach(() => {
  resetLlmGuard();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/repair", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const body = (siteId: string, over: Record<string, unknown> = {}) => ({ siteId, page: riverside, tasks, ...over });

/** A Converse stand-in that records every request and proposes "Better <n>" headings and labels. */
function recordingSend(): { send: ConverseSend; calls: ConverseCommandInput[] } {
  const calls: ConverseCommandInput[] = [];
  const send: ConverseSend = async (input) => {
    calls.push(input);
    const user = userTextOf(input);
    if (input.toolConfig?.tools?.[0]?.toolSpec?.name === "submit_labels") {
      return toolUseOutput("submit_labels", { labels: [...user.matchAll(/^id: (.+)$/gm)].map((m) => ({ id: m[1], label: "Search the site" })) });
    }
    return toolUseOutput("submit_heading", { heading: `Better heading ${calls.length}` });
  };
  return { send, calls };
}

describe("POST /api/repair guard", () => {
  it("serves the recorded Claude report for a demo site without calling the model", async () => {
    const { send, calls } = recordingSend();
    const res = await handleRepairRequest(post(body("riverside")), { env: TEST_ENV, send });
    expect(res.status).toBe(200);
    const report = (await res.json()) as RepairReport;
    expect(report.cached).toBe(true);
    expect(calls).toHaveLength(0);

    const { cached, ...rest } = report;
    expect(cached).toBe(true);
    expect(rest).toEqual(DEMO_REPAIR_REPORTS.riverside);
    const income = report.headings.find((h) => h.nodeId === "income-title")!;
    expect(income).toMatchObject({ original: "More information", proposed: "Monthly income limits by household size", source: "llm", accepted: true });
    // The same shape as a live report, so the UI recomputes its per-task numbers from it unchanged.
    expect(Object.keys(income).sort()).toEqual(["accepted", "after", "before", "nodeId", "original", "proposed", "savedSeconds", "source"]);

    // Not a demo id, or not that site's page: nothing is served from the recording.
    const other = await handleRepairRequest(post(body("somewhere-else")), { env: TEST_ENV, send });
    expect(((await other.json()) as RepairReport).cached).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("kill switch and spent daily cap return the offline fallback in the same shape, with no model call", async () => {
    for (const extra of [{ LLM_DISABLED: "1" }, { LLM_DAILY_CAP: "0" }]) {
      const { send, calls } = recordingSend();
      const res = await handleRepairRequest(post(body("somewhere-else")), { env: { ...TEST_ENV, ...extra }, send });
      expect(res.status).toBe(200);
      const report = (await res.json()) as RepairReport;
      expect(report.headings.length).toBeGreaterThan(0);
      expect(report.headings.every((h) => h.source === "fallback")).toBe(true);
      expect(report.limited).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
  });

  it("over the per-IP limit it returns the fallback report with limited: true, never an error", async () => {
    const env = { ...TEST_ENV, LLM_RATE_LIMIT: "1" };
    const { send, calls } = recordingSend();
    const headers = { "x-forwarded-for": "7.7.7.7" };
    const first = (await (await handleRepairRequest(post(body("somewhere-else"), headers), { env, send })).json()) as RepairReport;
    expect(first.limited).toBeUndefined();
    const used = calls.length;
    expect(used).toBeGreaterThan(0);

    const res = await handleRepairRequest(post(body("somewhere-else"), headers), { env, send });
    expect(res.status).toBe(200);
    const second = (await res.json()) as RepairReport;
    expect(second.limited).toBe(true);
    expect(second.headings.every((h) => h.source === "fallback")).toBe(true);
    expect(calls).toHaveLength(used);
  });

  it("rejects more than 6 tasks with 400 and an oversized body with 413, and caps every call's output tokens", async () => {
    const { send, calls } = recordingSend();
    const deps = { env: TEST_ENV, send };
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...tasks[0], id: `t${i}` }));
    expect((await handleRepairRequest(post(body("somewhere-else", { tasks: seven })), deps)).status).toBe(400);
    expect((await handleRepairRequest(post(body("somewhere-else", { pad: "x".repeat(1.6 * 1024 * 1024) })), deps)).status).toBe(413);
    expect(calls).toHaveLength(0);

    await handleRepairRequest(post(body("somewhere-else")), deps);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.inferenceConfig?.maxTokens).toBeLessThanOrEqual(512);
  });
});
