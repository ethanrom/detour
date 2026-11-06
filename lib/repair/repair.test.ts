import { beforeAll, describe, expect, it } from "vitest";
import { SITES } from "@/fixtures/tasks";
import type { PageModel } from "@/lib/contracts";
import { TEST_ENV } from "@/lib/llm/testing";
import { repairPage, type RepairReport } from "./index";
import { handleRepairRequest } from "./route";
import { fakeBedrock, loadSite } from "./testing";

let riverside: PageModel;
const tasks = SITES.find((s) => s.id === "riverside")!.tasks;

beforeAll(async () => {
  riverside = await loadSite("riverside");
}, 60_000);

describe("repairPage on riverside", () => {
  it("promotes the fake headings, then accepts only renames the scent model confirms", async () => {
    const { send } = fakeBedrock({
      "More information": "Income limits by household size",
      Residency: "Live in Riverside County", // plausible but irrelevant to every task
    });
    const report = await repairPage(riverside, tasks, { send, env: TEST_ENV });
    expect(report.promoted).toBe(true);

    const income = report.headings.find((h) => h.nodeId === "income-title")!;
    expect(income).toMatchObject({ original: "More information", proposed: "Income limits by household size", source: "llm", accepted: true });
    expect(income.savedSeconds).toBeGreaterThan(30);
    expect(income.after).toBeCloseTo(income.before - income.savedSeconds, 9);

    const residency = report.headings.find((h) => h.original === "Residency");
    expect(residency?.accepted).toBe(false);
    expect(report.headings.every((h) => h.accepted === h.savedSeconds > 0.5)).toBe(true);

    expect(report.labels).toEqual([{ nodeId: "n82", proposed: "Label for n82", source: "llm" }]);
  });

  it("works offline: every proposal is a fallback and the income heading is still fixed", async () => {
    const report = await repairPage(riverside, tasks, { env: {} });
    expect(report.headings.length).toBeGreaterThan(0);
    expect(report.headings.every((h) => h.source === "fallback")).toBe(true);
    expect(report.headings.find((h) => h.nodeId === "income-title")).toMatchObject({ accepted: true });
  });
});

describe("POST /api/repair handler", () => {
  const post = (body: unknown) => new Request("http://localhost/api/repair", { method: "POST", body: JSON.stringify(body) });

  it("returns 200 with fallback proposals when no LLM is configured, and 400 on bad input", async () => {
    const ok = await handleRepairRequest(post({ siteId: "not-a-demo-site", page: riverside, tasks }), { env: {} });
    expect(ok.status).toBe(200);
    const report = (await ok.json()) as RepairReport;
    expect(report.promoted).toBe(true);
    expect(report.headings.find((h) => h.nodeId === "income-title")).toMatchObject({ source: "fallback", accepted: true });

    expect((await handleRepairRequest(post({ siteId: "riverside", tasks }), { env: {} })).status).toBe(400);
    expect((await handleRepairRequest(new Request("http://localhost/api/repair", { method: "POST", body: "{nope" }), { env: {} })).status).toBe(400);
  });
});
