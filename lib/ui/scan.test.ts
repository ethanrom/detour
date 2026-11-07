// @vitest-environment jsdom
// Suggested tasks on the real Northwind page: the controls some people cannot use.
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { scanBarriers } from "./pipeline";

let northwind: PageModel;

beforeAll(async () => {
  const file = path.join(process.cwd(), "public", "sites", "northwind", "index.html");
  const dom = await JSDOM.fromFile(file, { resources: "usable", pretendToBeVisual: true });
  if (dom.window.document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  northwind = extractPage(dom.window.document);
}, 60000);

describe("scanBarriers", () => {
  it("puts the worst barriers first and stays within the limit", () => {
    const tasks = scanBarriers(northwind, "northwind");

    expect(tasks).toHaveLength(5);
    // Unreachable by keyboard and unnamed for a screen reader comes first: the thumbnails and colour swatches.
    expect(tasks[0].steps[0].target).toMatch(/^thumb-/);
    expect(tasks.some((t) => t.steps[0].target.startsWith("swatch-"))).toBe(true);
    expect(tasks.filter((t) => t.steps[0].target.startsWith("swatch-"))).toHaveLength(1);
    expect(tasks[1].label).toMatch(/^Reach and activate the unnamed control/);
  });

  it("offers the size picker once and the unnamed cart button", () => {
    const tasks = scanBarriers(northwind, "northwind", 10);
    const targets = tasks.map((t) => t.steps[0].target);
    expect(targets.some((id) => /^size-(xs|s|m|l|xl)$/.test(id))).toBe(true);
    expect(targets.filter((id) => /^size-(xs|s|m|l|xl)$/.test(id))).toHaveLength(1);
    expect(targets).toContain("cart-button");
    const cart = tasks.find((t) => t.steps[0].target === "cart-button");
    expect(cart?.label).toMatch(/^Reach and activate the unnamed button/);
    expect(cart?.steps[0].action).toBe("activate");
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  it("fills up to the limit with slow screen-reader tasks when there are few barriers", () => {
    expect(scanBarriers(northwind, "northwind", 12)).toHaveLength(12);
  });
});
