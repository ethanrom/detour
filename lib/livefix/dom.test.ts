// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { extractPage } from "@/lib/extract";
import { applyEdits, collectContext, measureLayout, pinLayout, restore, stampIds } from "./dom";
import type { EditOp, FixEdits } from "./types";

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const edits = (ops: EditOp[], css?: string): FixEdits => ({ fixId: "f1", edits: ops, css, note: "test", source: "fallback" });

describe("applyEdits", () => {
  it("wrapChildren keeps the original element, so a click on the new button reaches its listener", () => {
    const doc = page(`<div id="row"><div class="size-opt" data-detour-id="s">M</div></div>`);
    const div = doc.querySelector(".size-opt") as HTMLElement;
    const clicked = vi.fn();
    div.addEventListener("click", clicked);

    const r = applyEdits(doc, edits([{ op: "wrapChildren", selector: '[data-detour-id="s"]', tag: "button", attributes: { class: "reset", onclick: "x()" } }], ".reset{all:unset}"));

    expect(doc.querySelector(".size-opt")).toBe(div);
    const button = div.querySelector("button");
    expect(button?.textContent).toBe("M");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.hasAttribute("onclick")).toBe(false);
    button?.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(1);
    expect(r.errors.join(" ")).toMatch(/onclick/);
    expect(doc.head.querySelector('style[data-detour-fix="f1"]')?.textContent).toBe(".reset{all:unset}");
    expect(r.applied['[data-detour-id="s"]']).toContain("<button");
  });

  it("skips an op whose selector does not match exactly one element", () => {
    const doc = page(`<p class="a">x</p><p class="a">y</p>`);
    const r = applyEdits(doc, edits([{ op: "setText", selector: ".a", text: "z" }, { op: "setText", selector: ".none", text: "z" }]));
    expect(r.ok).toBe(0);
    expect(r.errors).toHaveLength(2);
    expect(doc.body.textContent).toBe("xy");
  });

  it("restore puts the original back and removes the fix's style", () => {
    const doc = page(`<div class="size-opt" data-detour-id="s">M</div><a data-detour-id="l" href="#" tabindex="3">L</a>`);
    const div = doc.querySelector(".size-opt") as HTMLElement;
    const before = doc.body.innerHTML;
    const r = applyEdits(
      doc,
      edits(
        [
          { op: "wrapChildren", selector: '[data-detour-id="s"]', tag: "button", attributes: {} },
          { op: "removeAttributes", selector: '[data-detour-id="l"]', names: ["tabindex"] },
          { op: "insert", selector: "body", position: "afterbegin", html: '<a href="#s">Skip</a>' },
        ],
        "button{margin:0}",
      ),
    );
    expect(r.ok).toBe(3);
    expect(doc.body.innerHTML).not.toBe(before);
    expect(r.originals.body).not.toContain("size-opt"); // an insert records a summary, not the whole page
    restore(doc, r.originals, "f1");
    expect(doc.body.innerHTML).toBe(before);
    expect(doc.querySelector(".size-opt")).toBe(div);
    expect(doc.head.querySelector("style[data-detour-fix]")).toBeNull();
  });

  it("replace keeps the old data-detour-id and drops scripts", () => {
    const doc = page(`<div data-detour-id="t">Reviews</div>`);
    const r = applyEdits(doc, edits([{ op: "replace", selector: '[data-detour-id="t"]', html: '<h2 onclick="x()">Reviews</h2><script>1</script>' }]));
    const h = doc.querySelector("h2");
    expect(h?.getAttribute("data-detour-id")).toBe("t");
    expect(h?.hasAttribute("onclick")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
    expect(r.ok).toBe(1);
  });
});

describe("measureLayout", () => {
  it("reports a pinned element that moved and leaves edited subtrees alone", () => {
    const doc = page(`<div id="a">a</div><div id="b">b</div><div id="c">c</div>`);
    const box = (top: number, h = 20) => () => ({ left: 0, top, width: 100, height: h, right: 100, bottom: top + h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const a = doc.getElementById("a") as HTMLElement;
    const b = doc.getElementById("b") as HTMLElement;
    const c = doc.getElementById("c") as HTMLElement;
    a.getBoundingClientRect = box(0);
    b.getBoundingClientRect = box(20);
    c.getBoundingClientRect = box(40);

    const pins = pinLayout(doc);
    expect(Object.keys(pins.rects)).toHaveLength(3);

    b.getBoundingClientRect = box(32); // moved by 12
    c.getBoundingClientRect = box(60); // moved too, but it is the edited one
    const report = measureLayout(doc, pins, ["#c"]);
    expect(report.checked).toBe(2);
    expect(report.moved).toHaveLength(1);
    expect(report.moved[0]).toMatchObject({ dx: 0, dy: 12 });
  });

  it("checks nothing without layout", () => {
    const doc = page(`<p>x</p>`);
    const report = measureLayout(doc, pinLayout(doc), []);
    expect(report.checked).toBe(0);
    expect(report.moved).toEqual([]);
  });
});

describe("stampIds and collectContext", () => {
  it("stamps generated ids so they survive an inserted element, and collects context for an agent", () => {
    const doc = page(`<nav><a href="#">One</a></nav><main><p>Intro text.</p><button>Buy</button></main>`);
    const model = extractPage(doc);
    const buy = Object.values(model.nodes).find((n) => n.role === "button");
    expect(buy).toBeDefined();
    const stamped = stampIds(doc, model);
    expect(stamped).toBeGreaterThan(0);
    expect(stampIds(doc, model)).toBe(0);

    const ctx = collectContext(doc, model, buy!.id);
    expect(ctx.selector).toBe(`[data-detour-id="${buy!.id}"]`);
    expect(ctx.outerHTML).toContain("Buy");
    expect(ctx.parentHTML).toContain("<!-- target -->");
    expect(ctx.parentHTML).not.toContain("<button");
    expect(ctx.nearbyText.length).toBeGreaterThan(0);
    expect(ctx.nearbyText.length).toBeLessThanOrEqual(4);

    doc.body.insertAdjacentHTML("afterbegin", '<a href="#main-content">Skip</a>');
    const again = extractPage(doc);
    expect(again.nodes[buy!.id]?.role).toBe("button");
  });
});
