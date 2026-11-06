// @vitest-environment jsdom
// Regression tests on the real demo sites (public/sites), loaded with their linked CSS.
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { extractPage } from "./index";

async function load(site: string): Promise<PageModel> {
  const file = path.join(process.cwd(), "public", "sites", site, "index.html");
  const dom = await JSDOM.fromFile(file, { resources: "usable", pretendToBeVisual: true });
  const doc = dom.window.document;
  if (doc.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return extractPage(doc);
}

const withHint = (p: PageModel, hint: "looksLikeHeading" | "fakeButton" | "unlabeled") => Object.values(p.nodes).filter((n) => n.hints[hint]);

let northwind: PageModel;
let riverside: PageModel;
let alpine: PageModel;

beforeAll(async () => {
  [northwind, riverside, alpine] = await Promise.all([load("northwind"), load("riverside"), load("alpine")]);
}, 60000);

describe("alpine (accessible control page)", () => {
  it("has no looksLikeHeading hints and no unlabeled controls", () => {
    expect(withHint(alpine, "looksLikeHeading").map((n) => n.name)).toEqual([]);
    expect(withHint(alpine, "unlabeled").map((n) => n.id)).toEqual([]);
    expect(withHint(alpine, "fakeButton").map((n) => n.id)).toEqual([]);
  });
});

describe("northwind", () => {
  it("flags the four section titles but not the price or rating", () => {
    const ids = new Set(withHint(northwind, "looksLikeHeading").map((n) => n.id));
    for (const id of ["details-title", "reviews-title", "returns-title", "related-title"]) expect(ids.has(id), id).toBe(true);
    expect(ids.has("price")).toBe(false);
    const names = withHint(northwind, "looksLikeHeading").map((n) => n.name);
    for (const figure of ["$189.00", "4.7"]) expect(names).not.toContain(figure);
  });

  it("gives the four section titles one styleKey and the same class", () => {
    const keys = ["details-title", "reviews-title", "returns-title", "related-title"].map((id) => northwind.nodes[id].hints.styleKey);
    expect(keys[0]).toMatch(/^div\.section-title\|\d+\|\d+$/);
    expect(new Set(keys).size).toBe(1);
    expect(northwind.nodes["details-title"].hints.className).toBe("section-title");
  });

  it("does not give the colour swatches one shared visualLabel", () => {
    const swatches = ["forest", "ember", "glacier", "charcoal", "sand"].map((c) => northwind.nodes[`swatch-${c}`]);
    for (const s of swatches) expect(s.hints).toMatchObject({ fakeButton: true, unlabeled: true });
    const labels = swatches.map((s) => s.hints.visualLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Colour: Forest");
  });

  it("does not label the wishlist heart with the size options or the social icons with 'Follow us'", () => {
    expect(northwind.nodes["wish-toggle"].hints.visualLabel ?? "").not.toMatch(/XS|XL/);
    const social = withHint(northwind, "unlabeled").filter((n) => n.tag === "a");
    expect(social.length).toBeGreaterThanOrEqual(4);
    for (const n of social) expect(n.hints.visualLabel).not.toBe("Follow us");
  });

  it("sets className and styleKey on every hinted node", () => {
    for (const hint of ["looksLikeHeading", "fakeButton", "unlabeled"] as const) {
      for (const n of withHint(northwind, hint)) {
        expect(typeof n.hints.className, n.id).toBe("string");
        expect(n.hints.styleKey, n.id).toMatch(/\|\d+\|\d+$/);
      }
    }
  });
});

describe("alpine labels", () => {
  it("reads a radio and its label as one stop, with no separate 'M' stop", () => {
    expect(alpine.nodes["size-m"].announcement).toBe("radio button, not checked, M");
    const stopsNamedM = alpine.readingOrder.map((id) => alpine.nodes[id]).filter((n) => n.name === "M");
    expect(stopsNamedM.map((n) => n.id)).toEqual(["size-m"]);
  });
});

describe("riverside", () => {
  it("excludes the statistics from looksLikeHeading but keeps the section titles", () => {
    const names = withHint(riverside, "looksLikeHeading").map((n) => n.name);
    for (const stat of ["42,300", "$238", "3 days"]) expect(names).not.toContain(stat);
    const ids = new Set(withHint(riverside, "looksLikeHeading").map((n) => n.id));
    for (const id of ["how-title", "who-title", "faq-title"]) expect(ids.has(id), id).toBe(true);
  });
});
