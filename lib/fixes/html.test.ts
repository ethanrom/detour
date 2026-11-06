import { describe, expect, it } from "vitest";
import type { A11yNode } from "@/lib/contracts";
import { abbreviate, parseSelector, renderElement } from "./html";

const node = (over: Partial<A11yNode>): A11yNode => ({
  id: "n",
  role: "generic",
  name: "",
  states: [],
  focusable: false,
  tabIndex: null,
  actionable: false,
  rect: null,
  parentId: null,
  children: [],
  announcement: "",
  selector: "div",
  tag: "div",
  hints: {},
  ...over,
});

describe("parseSelector", () => {
  it("reads id, classes and attributes of the last compound and drops data-detour-id", () => {
    expect(parseSelector('main > div.product:nth-child(2) > h3.title.big#hero[data-x="a b"][hidden]')).toEqual({
      id: "hero",
      classes: ["title", "big"],
      attrs: [
        ["data-x", "a b"],
        ["hidden", null],
      ],
    });
    expect(parseSelector('[data-detour-id="size-m"]')).toEqual({ classes: [], attrs: [] });
  });

  it("ignores selectors inside pseudo-classes and unescapes class names", () => {
    expect(parseSelector("li.item:not(.active):hover")).toEqual({ classes: ["item"], attrs: [] });
    expect(parseSelector("div.md\\:flex.w-1\\/2").classes).toEqual(["md:flex", "w-1/2"]);
    expect(parseSelector("ul li > a[href='/x > y']").attrs).toEqual([["href", "/x > y"]]);
  });
});

describe("renderElement", () => {
  it("renders attributes in a stable order with leading and trailing additions", () => {
    const n = node({ selector: "nav > button.icon#cart", tag: "button", name: "" });
    expect(renderElement(n, { inner: "…", trailing: ['aria-label="Cart"'] })).toBe('<button id="cart" class="icon" aria-label="Cart">…</button>');
    expect(renderElement(n, { tag: "a", leading: ['href="/"'], inner: "Go" })).toBe('<a href="/" id="cart" class="icon">Go</a>');
    expect(renderElement(n, { omit: ["id"], inner: "x" })).toBe('<button class="icon">x</button>');
  });

  it("renders void elements without a closing tag and abbreviates long text", () => {
    expect(renderElement(node({ tag: "input", selector: "input.q" }), { trailing: ['aria-label="Search"'] })).toBe('<input class="q" aria-label="Search">');
    expect(renderElement(node({ name: "x".repeat(100) })).length).toBeLessThan(60);
    expect(abbreviate("  a   b  ", 40)).toBe("a b");
    expect(abbreviate("abcdefghij", 5)).toBe("abcd…");
  });
});
