// @vitest-environment jsdom
// The whole client loop on the real Northwind page: plan, fake agent edits over NDJSON, apply, re-read, re-time.
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import type { PageModel, Task } from "@/lib/contracts";
import { SITES } from "@/fixtures/tasks";
import { extractPage } from "@/lib/extract";
import { evaluateAll, planAll, type PlanResult } from "@/lib/ui/pipeline";
import { patchText, reportMarkdown } from "./export";
import { runLiveFix } from "./run";
import type { EditOp, FixEdits, FixRequestItem, FixRunEvent, FixRunRequest, LiveFixEvent, LiveFixInput } from "./types";

const URL = "https://northwind.test/";
const FILE = path.join(process.cwd(), "public", "sites", "northwind", "index.html");
const tasks: Task[] = SITES.find((s) => s.id === "northwind")?.tasks ?? [];

async function load(): Promise<Document> {
  const dom = await JSDOM.fromFile(FILE, { resources: "usable", pretendToBeVisual: true });
  if (dom.window.document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return dom.window.document;
}

let page: PageModel;
let planned: PlanResult;

beforeAll(async () => {
  page = extractPage(await load(), { url: URL });
  planned = planAll(page, tasks, 3);
}, 60000);

/** What a competent agent would write for each kind of fix (the deterministic fallback's shape). */
function goodEdits(item: FixRequestItem): FixEdits {
  const edits: EditOp[] = [];
  let css: string | undefined;
  if (item.kind === "real-button") {
    for (const t of item.targets) edits.push({ op: "wrapChildren", selector: t.selector, tag: "button", attributes: { type: "button" } });
    css = "button{font:inherit;color:inherit;background:none;border:0;padding:0}";
  } else if (item.kind === "add-label") {
    for (const t of item.targets) edits.push({ op: "setAttributes", selector: t.selector, attributes: { "aria-label": String(item.params[`label:${t.nodeId}`] ?? item.params.label ?? "Control") } });
  } else if (item.kind === "skip-link") {
    edits.push({ op: "insert", selector: "body", position: "afterbegin", html: '<a class="skip-link" href="#main-content">Skip to main content</a>' });
    edits.push({ op: "setAttributes", selector: item.targets[0].selector, attributes: { id: "main-content" } });
  } else if (item.kind === "promote-heading") {
    for (const t of item.targets) edits.push({ op: "setAttributes", selector: t.selector, attributes: { role: "heading", "aria-level": String(item.params.level ?? 2) } });
  }
  return { fixId: item.fixId, edits, css, note: `Fixed ${item.title}.`, source: "fallback" };
}

type Fetch = typeof fetch;

/** A fetch that streams NDJSON: `answer` decides each request's events; lines are split mid-way to test buffering. */
function fakeFetch(answer: (req: FixRunRequest) => FixRunEvent[], seen: FixRunRequest[] = []): Fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as FixRunRequest;
    seen.push(req);
    const text = `${[...answer(req), { type: "done" } as FixRunEvent].map((e) => JSON.stringify(e)).join("\n")}\n`;
    const bytes = new TextEncoder().encode(text);
    const chunks = [bytes.slice(0, 40), bytes.slice(40, 200), bytes.slice(200)];
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() as Uint8Array } : { done: true, value: undefined }) }) },
    } as unknown as Response;
  }) as Fetch;
}

async function runWith(fetchImpl: Fetch, over: Partial<LiveFixInput> = {}) {
  const doc = await load();
  const events: LiveFixEvent[] = [];
  const report = await runLiveFix({
    frame: undefined as never,
    siteId: "northwind",
    url: URL,
    page,
    tasks,
    plan: planned.plan,
    before: evaluateAll(page, tasks),
    predicted: planned.results,
    engine: { evaluate: async (p, t) => evaluateAll(p, t) },
    doc,
    fetchImpl,
    onEvent: (e) => events.push(e),
    ...over,
  });
  return { report, events, doc };
}

const keyboardOn = (checks: { taskId: string; measured: { keyboard?: number | null } }[], taskId: string) => checks.find((c) => c.taskId === taskId)?.measured.keyboard;

describe("runLiveFix on Northwind", () => {
  it("applies each fix in plan order, re-checks the fixed page and proves the plan", async () => {
    // Deliver the answers in reverse order: they must still be applied in plan order.
    const { report, events, doc } = await runWith(fakeFetch((req) => [...req.fixes].reverse().map((f) => ({ type: "edits", result: goodEdits(f) }) as FixRunEvent)));

    const before = evaluateAll(page, tasks);
    expect(before.find((r) => r.taskId === "buy-m")?.personas.keyboard.blocked).toBeTruthy();
    expect(planned.plan.chosen.length).toBeGreaterThan(0);

    expect(report.fixes.map((f) => f.fixId)).toEqual(planned.plan.chosen.map((f) => f.id));
    expect(report.fixes.map((f) => [f.fixId, f.stage, f.reason])).toEqual(planned.plan.chosen.map((f) => [f.id, "proven", undefined]));
    expect(report.proven).toBe(report.total);
    expect(keyboardOn(report.checks, "buy-m")).not.toBeNull();
    expect(typeof keyboardOn(report.checks, "buy-m")).toBe("number");
    expect(report.results.find((r) => r.taskId === "buy-m")?.personas.keyboard.blocked).toBeUndefined();

    // Stage events: queued for all, then the first applied event belongs to the first planned fix.
    const stages = events.filter((e) => e.type === "stage").map((e) => (e.type === "stage" ? `${e.outcome.fixId}:${e.outcome.stage}` : ""));
    expect(stages.slice(0, planned.plan.chosen.length)).toEqual(planned.plan.chosen.map((f) => `${f.id}:queued`));
    expect(stages.find((s) => s.endsWith(":applied"))?.split(":applied")[0]).toBe(planned.plan.chosen[0].id);
    expect(stages.filter((s) => s.endsWith(":rereading"))).toHaveLength(planned.plan.chosen.length);
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some((e) => e.type === "layout")).toBe(true);
    expect(report.layout?.moved).toEqual([]);

    // The original size options are still there with their own listeners' place; the buttons live inside them.
    expect(doc.querySelector('[data-detour-id="size-m"] > button')?.textContent).toContain("M");
    for (const f of report.fixes) expect(f.ms).toBeGreaterThanOrEqual(0);

    // The exports read from the same report.
    const meta = { url: URL, title: "Trail Jacket", taskLabels: { "buy-m": "Add the Trail Jacket in size M to the cart" } };
    const patch = patchText(report, meta);
    expect(patch).toContain("--- before");
    expect(patch).toContain("+++ after");
    expect(patch).toContain("<button");
    expect(patch).not.toContain("data-detour-pin");
    const md = reportMarkdown(report, meta);
    expect(md).toContain(`${report.proven} of ${report.total} fixes proven`);
    expect(md).toContain("Add the Trail Jacket in size M to the cart");
    expect(md).toContain("can't finish"); // keyboard before the fix
    expect(md).toMatch(/re-checked on the fixed page/i);
    expect(md).not.toMatch(/measured/i);
  });

  it("sends the planned fixes with their targets, and a retry with the reason when a fix falls short", async () => {
    const seen: FixRunRequest[] = [];
    let firstTry = true;
    const { report } = await runWith(
      fakeFetch((req) => {
        return req.fixes.map((f) => {
          // The first answer for the size picker only adds a class: nothing becomes reachable.
          if (f.kind === "real-button" && firstTry) {
            firstTry = false;
            return { type: "edits", result: { fixId: f.fixId, edits: [{ op: "setAttributes", selector: f.targets[0].selector, attributes: { class: "size-opt x" } }], note: "weak", source: "agent" } } as FixRunEvent;
          }
          return { type: "edits", result: goodEdits(f) } as FixRunEvent;
        });
      }, seen),
    );

    expect(seen[0].siteId).toBe("northwind");
    expect(seen[0].fixes.map((f) => f.fixId)).toEqual(planned.plan.chosen.map((f) => f.id));
    expect(seen[0].fixes.every((f) => f.targets.length > 0 && f.targets.every((t) => t.selector.startsWith("[data-detour-id=")))).toBe(true);
    const skip = seen[0].fixes.find((f) => f.kind === "skip-link");
    if (skip) expect(skip.extraSelectors).toEqual(["body"]);

    const realButton = planned.plan.chosen.findIndex((f) => f.kind === "real-button");
    expect(realButton).toBeGreaterThanOrEqual(0);
    expect(seen).toHaveLength(2);
    expect(seen[1].fixes).toHaveLength(1);
    expect(seen[1].fixes[0].feedback).toMatch(/\S/);
    expect(report.fixes[realButton].attempts).toBe(2);
    expect(report.fixes[realButton].stage).toBe("proven");
  });

  it("marks the remaining fixes failed when the service can't be reached, and still finishes", async () => {
    const { report, events } = await runWith((async () => {
      throw new TypeError("network down");
    }) as Fetch);
    expect(report.fixes.every((f) => f.stage === "failed" && f.reason === "Couldn't reach the fixing service.")).toBe(true);
    expect(report.proven).toBe(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("applies verified wording as its own outcome", async () => {
    const { report, doc } = await runWith(fakeFetch((req) => req.fixes.map((f) => ({ type: "edits", result: goodEdits(f) }) as FixRunEvent)), {
      wording: [{ fixId: "wording:heading:reviews-title", nodeId: "reviews-title", kind: "heading", text: "Customer reviews and ratings", original: "Customer reviews" }],
    });
    const last = report.fixes.at(-1);
    expect(last?.fixId).toBe("wording:heading:reviews-title");
    expect(last?.edits?.source).toBe("wording");
    expect(["proven", "partial"]).toContain(last?.stage);
    expect(doc.querySelector('[data-detour-id="reviews-title"]')?.textContent).toBe("Customer reviews and ratings");
  });

  it("throws a clear error when there is no document to patch", async () => {
    const events: LiveFixEvent[] = [];
    await expect(
      runLiveFix({ frame: { contentDocument: null } as unknown as HTMLIFrameElement, siteId: "northwind", url: URL, page, tasks, plan: planned.plan, before: [], predicted: [], engine: { evaluate: async () => [] }, onEvent: (e) => events.push(e) }),
    ).rejects.toThrow(/document/i);
  });
});
