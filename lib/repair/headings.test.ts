import { beforeAll, describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { TEST_ENV, scriptedSend, toolUseOutput, userTextOf } from "@/lib/llm/testing";
import { fallbackHeading, findVagueHeadings, proposeHeading, sectionText } from "./headings";
import { loadSite, promoteAll } from "./testing";

let riverside: PageModel;

beforeAll(async () => {
  riverside = promoteAll(await loadSite("riverside"));
}, 60_000);

describe("vague headings and the deterministic fallback (riverside)", () => {
  it("flags 'More information' but not descriptive headings", () => {
    const vague = findVagueHeadings(riverside);
    expect(vague).toContain("income-title");
    for (const id of ["page-title", "faq-title", "who-title"]) expect(vague).not.toContain(id);
  });

  it("reads the income section and falls back to its most frequent content words", () => {
    const text = sectionText(riverside, "income-title");
    expect(text).toContain("3 people");
    expect(text).not.toContain("Frequently asked questions");
    const heading = fallbackHeading(riverside, "income-title");
    expect(heading).toMatch(/Income/);
    expect(heading).toMatch(/Limits?/);
    expect(heading.split(" ").length).toBeLessThanOrEqual(3);
    expect(heading).toBe(heading.replace(/\b\w/g, (c) => c.toUpperCase()));
  });
});

describe("proposeHeading", () => {
  it("uses the model's answer when valid, and retries once when it is rejected", async () => {
    const bad = toolUseOutput("submit_heading", { heading: "more information" }); // same as the original
    const good = toolUseOutput("submit_heading", { heading: '"Income limits by household size."' });
    const { send, calls } = scriptedSend(bad, good);
    const p = await proposeHeading(riverside, "income-title", { send, env: TEST_ENV });
    expect(p).toEqual({ text: "Income limits by household size", source: "llm" });
    expect(calls).toHaveLength(2);
    expect(userTextOf(calls[0])).toContain("3 people");
    expect(userTextOf(calls[1])).toContain("is the same as the current heading");
    expect(calls[0].modelId).toBe(TEST_ENV.CLAUDE_AWS_FAST_MODEL);
  });

  it("falls back after two invalid answers, when the request fails, and when no LLM is configured", async () => {
    const tooLong = toolUseOutput("submit_heading", { heading: "One two three four five six seven" });
    const twice = scriptedSend(tooLong);
    const a = await proposeHeading(riverside, "income-title", { send: twice.send, env: TEST_ENV });
    expect(a.source).toBe("fallback");
    expect(twice.calls).toHaveLength(2);

    const failing = scriptedSend(new Error("boom"));
    const b = await proposeHeading(riverside, "income-title", { send: failing.send, env: TEST_ENV });
    expect(b).toEqual(a);

    const none = scriptedSend(tooLong);
    const c = await proposeHeading(riverside, "income-title", { send: none.send, env: {} });
    expect(c).toEqual(a);
    expect(none.calls).toHaveLength(0);
  });
});
