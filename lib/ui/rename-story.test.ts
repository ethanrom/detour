// @vitest-environment jsdom
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { PageModel, SearchEstimate } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { SITES } from "@/fixtures/tasks";
import type { RepairReport } from "@/lib/repair/types";
import { buildRenameStory, hideSearchInsight } from "./rename-story";

async function load(id: string): Promise<PageModel> {
  const dom = await JSDOM.fromFile(path.resolve(__dirname, "../../public/sites", id, "index.html"), { resources: "usable", pretendToBeVisual: true });
  const { document } = dom.window;
  if (document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return extractPage(document);
}

const page = await load("riverside");
const tasks = SITES.find((s) => s.id === "riverside")!.tasks;

const report: RepairReport = {
  promoted: true,
  labels: [],
  headings: [
    { nodeId: "income-title", original: "More information", proposed: "Monthly income limits by household size", source: "llm", before: 0, after: 0, savedSeconds: 0, accepted: true },
    { nodeId: "income-title", original: "x", proposed: "y", source: "llm", before: 0, after: 0, savedSeconds: 0, accepted: false },
  ],
};

describe("rename story", () => {
  const story = buildRenameStory(page, tasks, report);

  it("gives per-task numbers for accepted renames only, with the best case below the realistic time", () => {
    expect(story).toHaveLength(1);
    const income = story[0].lines.find((l) => l.taskId === "income-3")!;
    expect(income.before).toBeGreaterThan(income.after + 5);
    expect(income.best).toBeLessThan(income.after);
    // A task that does not depend on that heading is unchanged.
    const spanish = story[0].lines.find((l) => l.taskId === "spanish");
    if (spanish) expect(Math.abs(spanish.before - spanish.after)).toBeLessThan(0.5);
  });

  it("hides the separate search panel when a rename covers the task or the heading differs", () => {
    const search = (answer: string): SearchEstimate => ({
      seconds: 100,
      shortestSeconds: 10,
      pFoundFirstPass: 0.03,
      expectedWrongSections: 2,
      perHeading: [{ nodeId: answer, label: "x", scent: 0, pEnter: 0.03, expectedVisits: 1, containsTarget: true }],
    });
    // Covered task.
    expect(hideSearchInsight({ loading: false, story, taskId: "income-3", search: search("income-title") })).toBe(true);
    // Not covered, and its answer heading is not the renamed one.
    expect(hideSearchInsight({ loading: false, story, taskId: "apply", search: search("other") })).toBe(true);
    // No renames: nothing to contradict. Still loading: hold back.
    expect(hideSearchInsight({ loading: false, story: [], taskId: "apply", search: search("other") })).toBe(false);
    expect(hideSearchInsight({ loading: true, story: [], taskId: "apply", search: search("other") })).toBe(true);
  });
});
