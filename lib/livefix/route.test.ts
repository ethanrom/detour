import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/fix/route";
import type { ConverseSend } from "@/lib/llm/bedrock";
import { resetLlmGuard } from "@/lib/llm/guard";
import { TEST_ENV, toolUseOutput, userTextOf } from "@/lib/llm/testing";
import { FIX_TOOL_NAME } from "./agent";
import { recordedEdits, recordEdits } from "./recorded";
import { handleFixRequest } from "./route";
import type { FixEdits, FixRequestItem, FixRunEvent, FixRunRequest, FixTargetContext } from "./types";

function target(nodeId: string, selector: string): FixTargetContext {
  return {
    nodeId,
    selector,
    outerHTML: `<div id="${nodeId}">x</div>`,
    parentHTML: "<div><!-- target --></div>",
    nearbyText: ["Home"],
    style: { display: "block", fontSize: "", fontWeight: "", color: "", background: "", border: "", padding: "", margin: "", cursor: "" },
  };
}

function fix(id: string, kind: FixRequestItem["kind"], params: FixRequestItem["params"], selector: string): FixRequestItem {
  return { fixId: id, kind, title: id, params, wcag: [], targets: [target(id, selector)] };
}

const body: FixRunRequest = {
  siteId: "mini-shop",
  pageTitle: "Mini shop",
  fixes: [fix("slow", "promote-heading", { level: 2, text: "A", count: 1 }, "#slow"), fix("quick", "remove-positive-tabindex", { count: 1, maxTabIndex: 3 }, "#quick")],
};

function post(json: unknown, raw = false): Request {
  return new Request("http://localhost/api/fix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (json as string) : JSON.stringify(json),
  });
}

async function lines(res: Response): Promise<FixRunEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FixRunEvent);
}

/** A model that answers each fix with a role="button" on the fix's own selector; the first fix is slower. */
function fakeSend(delays: Record<string, number> = {}) {
  const calls: string[] = [];
  const send: ConverseSend = async (input) => {
    const text = userTextOf(input);
    const selector = JSON.parse(/selector: ("[^"]*")/.exec(text)![1]) as string;
    calls.push(selector);
    const wait = delays[selector] ?? 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return toolUseOutput(FIX_TOOL_NAME, {
      edits: [{ op: "setAttributes", selector, attributes: { role: "button", tabindex: 0 } }],
      note: "Set the role in the component that renders this element.",
    });
  };
  return { send, calls };
}

beforeEach(() => {
  resetLlmGuard();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/fix", () => {
  it("streams one edits line per fix as each settles, then done", async () => {
    const { send, calls } = fakeSend({ "#slow": 40 });
    const res = await handleFixRequest(post(body), { env: TEST_ENV, send });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const events = await lines(res);
    expect(events.map((e) => e.type)).toEqual(["edits", "edits", "done"]);
    const ids = events.flatMap((e) => (e.type === "edits" ? [e.result.fixId] : []));
    expect(ids).toEqual(["quick", "slow"]); // settle order, not request order
    for (const e of events) {
      if (e.type === "edits") {
        expect(e.result.source).toBe("agent");
        expect(e.result.edits[0]).toMatchObject({ op: "setAttributes", attributes: { role: "button", tabindex: "0" } });
      }
    }
    expect(calls).toHaveLength(2);
  });

  it("answers with source fallback and no model call when no LLM is configured", async () => {
    const { send, calls } = fakeSend();
    const events = await lines(await handleFixRequest(post(body), { env: {}, send }));
    expect(events.map((e) => e.type)).toEqual(["edits", "edits", "done"]);
    expect(events.every((e) => e.type !== "edits" || e.result.source === "fallback")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("falls back for the kill switch and when the agent fails", async () => {
    const { send, calls } = fakeSend();
    const off = await lines(await handleFixRequest(post(body), { env: { ...TEST_ENV, LLM_DISABLED: "1" }, send }));
    expect(off.every((e) => e.type !== "edits" || e.result.source === "fallback")).toBe(true);
    expect(calls).toHaveLength(0);

    const failing: ConverseSend = async () => {
      throw new Error("boom");
    };
    const failed = await lines(await handleFixRequest(post(body), { env: TEST_ENV, send: failing }));
    expect(failed.map((e) => e.type)).toEqual(["edits", "edits", "done"]);
    expect(failed.every((e) => e.type !== "edits" || e.result.source === "fallback")).toBe(true);
    expect(console.error).toHaveBeenCalledWith("[fix] agent failed (promote-heading)");
  });

  it("retries once with the validator's reasons, then falls back", async () => {
    const calls: string[] = [];
    const send: ConverseSend = async (input) => {
      calls.push(userTextOf(input));
      return toolUseOutput(FIX_TOOL_NAME, { edits: [{ op: "setAttributes", selector: "#other", attributes: { role: "button" } }], note: "Fix it in the component." });
    };
    const one: FixRunRequest = { ...body, fixes: [body.fixes[0]] };
    const events = await lines(await handleFixRequest(post(one), { env: TEST_ENV, send }));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("rejected for these reasons");
    expect(events[0]).toMatchObject({ type: "edits", result: { source: "fallback" } });
  });

  it("rejects a bad body with 400 and answers a route POST", async () => {
    expect((await handleFixRequest(post("{nope", true), { env: {} })).status).toBe(400);
    for (const bad of [{}, { ...body, fixes: [] }, { ...body, fixes: Array(6).fill(body.fixes[0]) }, { ...body, siteId: "" }]) {
      const res = await handleFixRequest(post(bad), { env: {} });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad-request");
    }
    const tooMany = { ...body, fixes: [{ ...body.fixes[0], targets: Array(31).fill(body.fixes[0].targets[0]) }] };
    expect((await handleFixRequest(post(tooMany), { env: {} })).status).toBe(400);
    expect((await POST(post(body))).status).toBe(200);
  });
});

describe("recorded edits", () => {
  const item = fix("rec", "remove-positive-tabindex", { count: 1, maxTabIndex: 3 }, "#rec");
  const result: FixEdits = {
    fixId: "rec",
    edits: [{ op: "setAttributes", selector: "#rec", attributes: { tabindex: "0" } }],
    note: "Remove the positive tabindex in the component.",
    source: "agent",
    ms: 900,
  };
  const recordings = { northwind: { fixes: [{ fixId: "rec", outerHTML: [item.targets[0].outerHTML], result }] } };

  it("serves a recording only for the same fix and the same target HTML", () => {
    expect(recordedEdits("northwind", item, recordings)).toMatchObject({ fixId: "rec", source: "recorded", edits: result.edits });
    expect(recordedEdits("northwind", item, recordings)).not.toHaveProperty("ms");
    expect(recordedEdits("mini-shop", item, recordings)).toBeNull();
    expect(recordedEdits("northwind", { ...item, fixId: "other" }, recordings)).toBeNull();
    const changed = { ...item, targets: [{ ...item.targets[0], outerHTML: "<div id=\"rec\">changed</div>" }] };
    expect(recordedEdits("northwind", changed, recordings)).toBeNull();
  });

  it("records agent results only in recording mode, merged by fix id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "livefix-"));
    try {
      await recordEdits("northwind", item, result, { env: { NODE_ENV: "development" }, dir });
      await expect(readFile(path.join(dir, "northwind.json"), "utf8")).rejects.toThrow(); // not enabled
      const env = { LIVEFIX_RECORD: "1", NODE_ENV: "development" };
      await Promise.all([recordEdits("northwind", item, result, { env, dir }), recordEdits("northwind", { ...item, fixId: "b" }, { ...result, fixId: "b" }, { env, dir }), recordEdits("mini-shop", item, result, { env, dir })]);
      await recordEdits("northwind", item, { ...result, ms: 1 }, { env, dir });
      const saved = JSON.parse(await readFile(path.join(dir, "northwind.json"), "utf8")) as { fixes: Array<{ fixId: string; result: FixEdits }> };
      expect(saved.fixes.map((f) => f.fixId).sort()).toEqual(["b", "rec"]);
      expect(saved.fixes.find((f) => f.fixId === "rec")?.result.ms).toBe(1);
      await expect(readFile(path.join(dir, "mini-shop.json"), "utf8")).rejects.toThrow(); // not a demo site
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
