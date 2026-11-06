// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPage } from "./index";
import { byId, docFrom, docFromFull, pageFrom } from "./testing";

const HTML = `
  <header><a href="#main" data-detour-id="skip">Skip</a><nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav></header>
  <main id="main"><h1>Title</h1><p>Hello <a href="/x">link</a> world</p><button>Go</button></main>`;

describe("ids and selectors", () => {
  it("uses data-detour-id as id and attribute selector, otherwise preorder ids and a CSS path", () => {
    const doc = docFrom(`<div><a href="/a" data-detour-id="first">A</a></div><div><span>x</span><a href="/b">B</a></div>`);
    const p = extractPage(doc);
    expect(byId(p, "first").selector).toBe('[data-detour-id="first"]');
    const b = p.nodes[p.readingOrder[p.readingOrder.length - 1]];
    expect(b.id).toMatch(/^n\d+$/);
    expect(b.selector).toBe("body > div:nth-of-type(2) > a:nth-of-type(1)");
    expect(b.tag).toBe("a");
    expect(p.root).toBe("n0");
    expect(p.nodes[p.root]).toMatchObject({ tag: "body", selector: "body", role: "document", parentId: null });
  });

  it("produces selectors that resolve to exactly the source element", () => {
    const doc = docFrom(HTML + `<ul><li>One</li><li>Two</li></ul><div data-detour-id="q&quot;x">odd id</div>`);
    const p = extractPage(doc);
    for (const n of Object.values(p.nodes)) {
      const hits = doc.querySelectorAll(n.selector);
      expect(hits, n.selector).toHaveLength(1);
      expect(hits[0].localName).toBe(n.tag);
    }
  });

  it("is deterministic across runs and across fresh documents", () => {
    const doc = docFrom(HTML);
    const a = extractPage(doc);
    const b = extractPage(doc);
    const c = extractPage(docFrom(HTML));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it("keeps ids unique when author ids repeat or collide with generated ones", () => {
    const p = pageFrom(`<a href="/1" data-detour-id="dup">One</a><a href="/2" data-detour-id="dup">Two</a><a href="/3" data-detour-id="n3">Three</a><a href="/4">Four</a>`);
    const ids = Object.keys(p.nodes);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p.nodes.dup.name).toBe("One");
    expect(p.nodes.n3.name).toBe("Three");
    const dupTwo = Object.values(p.nodes).find((n) => n.name === "Two")!;
    expect(dupTwo.id).not.toBe("dup");
  });

  it("supports a custom id attribute", () => {
    const doc = docFrom(`<button data-qa="buy">Buy</button><a href="/x" data-detour-id="ignored">X</a>`);
    const p = extractPage(doc, { idAttr: "data-qa" });
    expect(byId(p, "buy").selector).toBe('[data-qa="buy"]');
    expect(p.nodes.ignored).toBeUndefined();
  });
});

describe("tree consistency", () => {
  it("links every node to its parent and children, reachable from the root, preorder = document order", () => {
    const p = pageFrom(HTML);
    const seen: string[] = [];
    const walk = (id: string, parent: string | null) => {
      const n = p.nodes[id];
      expect(n.parentId).toBe(parent);
      seen.push(id);
      n.children.forEach((c) => walk(c, id));
    };
    walk(p.root, null);
    expect(new Set(seen)).toEqual(new Set(Object.keys(p.nodes)));
    expect(seen).toHaveLength(Object.keys(p.nodes).length);
    // every reading stop and focus stop is a node, and reading order follows tree preorder
    expect(p.readingOrder.every((id) => p.nodes[id])).toBe(true);
    expect(p.readingOrder).toEqual(seen.filter((id) => p.readingOrder.includes(id)));
    expect(p.focusOrder.every((id) => p.nodes[id].focusable)).toBe(true);
  });
});

describe("page metadata and geometry", () => {
  it("fills title, url, version and defaults without layout", () => {
    const doc = docFromFull(`<!doctype html><title>My page</title><body><p>Hi</p></body>`);
    const p = extractPage(doc, { url: "https://example.com/x" });
    expect(p).toMatchObject({ version: 1, title: "My page", url: "https://example.com/x", docHeight: 0 });
    expect(p.viewport.w).toBeGreaterThan(0);
    expect(p.viewport.h).toBeGreaterThan(0);
    expect(Object.values(p.nodes).every((n) => n.rect === null)).toBe(true);
    expect(extractPage(doc).url).toBe("about:blank");
  });

  it("copes with an empty body", () => {
    const p = extractPage(docFromFull(`<!doctype html><title>Empty</title><body></body>`));
    expect(Object.keys(p.nodes)).toEqual([p.root]);
    expect(p.readingOrder).toEqual([]);
    expect(p.focusOrder).toEqual([]);
  });

  it("reports document-coordinate rects when layout exists", () => {
    const doc = docFrom(`<h1 data-detour-id="h">Hello</h1><a href="/x" data-detour-id="l">Go</a>`);
    const win = doc.defaultView!;
    const proto = win.Element.prototype;
    proto.getBoundingClientRect = function (this: Element) {
      const top = this.localName === "a" ? 100 : 20;
      return { x: 10, y: top, left: 10, top, right: 110, bottom: top + 30, width: 100, height: 30, toJSON: () => ({}) } as DOMRect;
    };
    Object.defineProperty(win, "scrollY", { value: 500, configurable: true });
    Object.defineProperty(win, "scrollX", { value: 5, configurable: true });
    Object.defineProperty(doc.documentElement, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(win, "innerWidth", { value: 0, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 0, configurable: true });
    const p = extractPage(doc);
    expect(byId(p, "h").rect).toEqual({ x: 15, y: 520, w: 100, h: 30 });
    expect(byId(p, "l").rect).toEqual({ x: 15, y: 600, w: 100, h: 30 });
    expect(p.docHeight).toBe(3000);
    expect(p.viewport).toEqual({ w: 1280, h: 800 });
  });
});
