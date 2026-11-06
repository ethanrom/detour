// @vitest-environment jsdom
// The scent model on the real demo pages: extracted from the HTML in jsdom, headings promoted by the fixes layer.
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { SITES } from "@/fixtures/tasks";
import { applyFixes, generateCandidates } from "@/lib/fixes";
import { compareRename, lexicalScorer, searchTask } from "./index";

async function load(id: string): Promise<PageModel> {
  const dom = await JSDOM.fromFile(path.resolve(__dirname, "../../public/sites", id, "index.html"), { resources: "usable", pretendToBeVisual: true });
  const { document } = dom.window;
  if (document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return extractPage(document);
}

/** The page after every promote-heading candidate is applied (what the repair agent starts from). */
async function withPromotedHeadings(id: string): Promise<{ page: PageModel; tasks: (typeof SITES)[number]["tasks"] }> {
  const raw = await load(id);
  const tasks = SITES.find((s) => s.id === id)!.tasks;
  const fixes = generateCandidates(raw, tasks).filter((c) => c.kind === "promote-heading");
  return { page: applyFixes(raw, fixes), tasks };
}

const riverside = await withPromotedHeadings("riverside");
const northwind = await withPromotedHeadings("northwind");

describe("preamble targets are arrow walks, not heading searches", () => {
  it.each([
    ["riverside", riverside, "spanish"],
    ["northwind", northwind, "open-cart"],
  ])("%s %s", (_site, { page, tasks }, taskId) => {
    const r = searchTask(page, tasks.find((t) => t.id === taskId)!, lexicalScorer);
    expect(r.steps[0].mode).toBe("local");
    expect(r.seconds).toBeCloseTo(r.steps[0].shortestSeconds, 9);
    expect(r.seconds).toBeLessThan(15);
    if (process.env.SCENT_VERBOSE) console.log(_site, taskId, r.seconds.toFixed(1), "s");
  });
});

describe("compareRename on riverside income-3", () => {
  it("renaming 'More information' to 'Income limits' collapses the search time", () => {
    const task = riverside.tasks.find((t) => t.id === "income-3")!;
    expect(riverside.page.nodes["income-title"].role).toBe("heading");
    const c = compareRename(riverside.page, task, "income-title", "Income limits", lexicalScorer);
    expect(c.before).toBe(c.beforeResult.seconds);
    expect(c.after).toBe(c.afterResult.seconds);
    expect(c.after).toBeLessThan(0.5 * c.before);
    expect(c.afterResult.steps[0].shortestSeconds).toBeCloseTo(c.beforeResult.steps[0].shortestSeconds, 0);
    expect(riverside.page.nodes["income-title"].name).toBe("More information"); // input untouched
    if (process.env.SCENT_VERBOSE) console.log("income-3", c.before.toFixed(1), "->", c.after.toFixed(1), "shortest", c.beforeResult.steps[0].shortestSeconds.toFixed(1), c.afterResult.steps[0].shortestSeconds.toFixed(1));
  });
});
