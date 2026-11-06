// @vitest-environment jsdom
// Fix candidates on the real demo sites: loaded in jsdom, extracted, then fixed.
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { FixSpec, PageModel } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { SITES } from "@/fixtures/tasks";
import { applyFix, applyFixes, generateCandidates, validatePage } from "./index";

const SITES_DIR = path.resolve(__dirname, "../../public/sites");

async function load(id: string): Promise<PageModel> {
  const dom = await JSDOM.fromFile(path.join(SITES_DIR, id, "index.html"), { resources: "usable", pretendToBeVisual: true });
  const { document } = dom.window;
  if (document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return extractPage(document);
}

const pages = Object.fromEntries(await Promise.all(SITES.map(async (s) => [s.id, await load(s.id)] as const)));
const tasksOf = (id: string) => SITES.find((s) => s.id === id)?.tasks ?? [];
const candidatesOf = (id: string): FixSpec[] => generateCandidates(pages[id], tasksOf(id));

// Component grouping needs hints.styleKey from the extractor; the grouped assertions switch on once it is there.
const extractorGroups = Object.values(pages.northwind.nodes).some((n) => n.hints.styleKey);

/** The same page with the component hints removed: what the generator would offer without grouping. */
function withoutStyleKeys(page: PageModel): PageModel {
  const copy = structuredClone(page);
  for (const n of Object.values(copy.nodes)) {
    delete n.hints.styleKey;
    delete n.hints.className;
  }
  return copy;
}

describe("northwind", () => {
  const cands = candidatesOf("northwind");

  it("offers a skip link, the size picker as real buttons and a label for the cart", () => {
    expect(cands.some((c) => c.kind === "skip-link")).toBe(true);
    expect(cands.find((c) => c.kind === "real-button" && c.targets.includes("size-m"))?.targets).toEqual(["size-xs", "size-s", "size-m", "size-l", "size-xl"]);
    expect(cands.find((c) => c.kind === "add-label" && c.targets.includes("cart-button"))).toBeDefined();
  });

  it.skipIf(!extractorGroups)("groups candidates by component instead of one per node", () => {
    const titles = cands.find((c) => c.kind === "promote-heading" && c.targets.includes("details-title"));
    expect(titles?.targets.length).toBeGreaterThanOrEqual(4);
    expect(titles?.targets).toEqual(expect.arrayContaining(["details-title", "reviews-title", "returns-title", "related-title"]));
    expect(titles?.title).toMatch(/^Make the \d+ “section-title” blocks real <h2> headings$/);
    expect(cands.length).toBeLessThanOrEqual(20);
    expect(cands.length).toBeLessThan(generateCandidates(withoutStyleKeys(pages.northwind), tasksOf("northwind")).length / 2);
  });
});

describe("alpine (the accessible control)", () => {
  it("has nothing to fix", () => {
    expect(candidatesOf("alpine").map((c) => c.id)).toEqual([]);
  });
});

describe.each(SITES.map((s) => s.id))("%s: every fix applies cleanly", (id) => {
  it("each candidate alone, and all together, leave a valid page", () => {
    const page = pages[id];
    expect(validatePage(page)).toEqual([]);
    const cands = candidatesOf(id);
    for (const c of cands) expect(validatePage(applyFix(page, c)), c.id).toEqual([]);
    expect(validatePage(applyFixes(page, cands))).toEqual([]);
  });
});
