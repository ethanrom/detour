// Live Bedrock test. Skipped unless CLAUDE_AWS_* are present (in the environment or in the shared .env
// of the main checkout). Makes real, billable calls; prints the proposed text, never environment values.

import { describe, expect, it } from "vitest";
import { SITES } from "@/fixtures/tasks";
import { isLlmConfigured } from "@/lib/llm/bedrock";
import { proposeHeading } from "./headings";
import { repairPage } from "./index";
import { loadSite, promoteAll } from "./testing";
import { isAccepted, verifyRename } from "./verify";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env there: rely on the ambient environment.
}

const tasks = SITES.find((s) => s.id === "riverside")!.tasks;

describe.skipIf(!isLlmConfigured())("live Bedrock repair", () => {
  it("proposes a valid heading for riverside's income section, and the scent model accepts it", async () => {
    const page = promoteAll(await loadSite("riverside"));
    const p = await proposeHeading(page, "income-title");
    const v = verifyRename(page, tasks, "income-title", p.text);
    console.log(`[live] income-title: ${JSON.stringify(p.text)} (${p.source}), search ${v.before.toFixed(1)}s -> ${v.after.toFixed(1)}s, saved ${v.savedSeconds.toFixed(1)}s`);
    expect(p.source).toBe("llm");
    expect(p.text.split(" ").length).toBeLessThanOrEqual(6);
    expect(p.text.toLowerCase()).not.toBe("more information");
    expect(isAccepted(v)).toBe(true);
  }, 60_000);

  it("repairs the whole page: every LLM proposal is verified before it is accepted", async () => {
    const report = await repairPage(await loadSite("riverside"), tasks);
    for (const h of report.headings) console.log(`[live] ${h.nodeId}: ${JSON.stringify(h.original)} -> ${JSON.stringify(h.proposed)} (${h.source}) saved ${h.savedSeconds.toFixed(1)}s accepted=${h.accepted}`);
    for (const l of report.labels) console.log(`[live] label ${l.nodeId}: ${JSON.stringify(l.proposed)} (${l.source})`);
    expect(report.promoted).toBe(true);
    expect(report.headings.find((h) => h.nodeId === "income-title")?.accepted).toBe(true);
    expect(report.headings.every((h) => h.accepted === h.savedSeconds > 0.5)).toBe(true);
  }, 120_000);
});
