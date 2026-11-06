// Test helpers: build a Document from an HTML string with jsdom and extract it.

import { JSDOM } from "jsdom";
import type { A11yNode, PageModel } from "@/lib/contracts";
import { extractPage } from "./index";

export function docFrom(html: string): Document {
  return new JSDOM(`<!doctype html><html><head><title>Test page</title></head><body>${html}</body></html>`).window.document;
}

export function docFromFull(html: string): Document {
  return new JSDOM(html).window.document;
}

export function pageFrom(html: string): PageModel {
  return extractPage(docFrom(html));
}

/** Node whose data-detour-id is `id`. */
export function byId(page: PageModel, id: string): A11yNode {
  const n = page.nodes[id];
  if (!n) throw new Error(`no node ${id}; have ${Object.keys(page.nodes).join(", ")}`);
  return n;
}

/** Compact dump of the reading order for assertions: "role:name". */
export function stops(page: PageModel): string[] {
  return page.readingOrder.map((id) => `${page.nodes[id].role}:${page.nodes[id].name}`);
}
