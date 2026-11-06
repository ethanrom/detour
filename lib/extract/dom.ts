// Low-level DOM helpers shared by the extractor: environment, visibility, text and style parsing.
// Everything here avoids `instanceof` and global DOM constants so it works across realms (jsdom, iframes).

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

/** Tags whose subtrees never contribute to the accessibility tree. */
const SKIP_TAGS = new Set([
  "head",
  "script",
  "style",
  "template",
  "noscript",
  "meta",
  "link",
  "title",
  "base",
  "datalist",
  "canvas",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "map",
  "area",
  "param",
  "source",
  "track",
  "slot",
]);

/** Tags that are interactive or void, whose children are never walked for text. */
export const NO_WALK_TAGS = new Set(["select", "textarea", "option", "optgroup", "svg", "math"]);

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "big",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
  "picture",
  "img",
  "br",
]);

export interface Env {
  doc: Document;
  win: (Window & typeof globalThis) | null;
  idAttr: string;
  /** True when the document has real layout (getBoundingClientRect returns non-zero boxes). */
  layout: boolean;
  style(el: Element): CSSStyleDeclaration;
  /** Element -> preorder index among all elements under (and including) body. */
  index: Map<Element, number>;
  /** Effective (inherited) `visibility: visible` for elements that were visited. */
  visible: WeakMap<Element, boolean>;
}

const EMPTY_STYLE = new Proxy({} as CSSStyleDeclaration, {
  get: (_t, prop) => (prop === "getPropertyValue" ? () => "" : ""),
});

export function createEnv(doc: Document, idAttr: string): Env {
  const win = (doc.defaultView as (Window & typeof globalThis) | null) ?? null;
  const cache = new WeakMap<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    if (!win) return EMPTY_STYLE;
    let s = cache.get(el);
    if (!s) {
      try {
        s = win.getComputedStyle(el);
      } catch {
        s = EMPTY_STYLE;
      }
      cache.set(el, s);
    }
    return s;
  };
  let layout = false;
  try {
    layout = doc.documentElement.getBoundingClientRect().width > 0;
  } catch {
    layout = false;
  }
  const index = new Map<Element, number>();
  const body = doc.body;
  if (body) {
    index.set(body, 0);
    let i = 1;
    for (const el of Array.from(body.querySelectorAll("*"))) index.set(el, i++);
  }
  return { doc, win, idAttr, layout, style, index, visible: new WeakMap() };
}

/** Collapse whitespace (including nbsp) and strip zero-width characters. */
export function norm(s: string): string {
  return s.replace(/[\u200b-\u200d\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

export function isElement(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === ELEMENT_NODE;
}

export function isSkippedTag(el: Element): boolean {
  const tag = el.localName;
  if (SKIP_TAGS.has(tag)) return true;
  if (tag === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden") return true;
  return false;
}

/** Subtree removed from the accessibility tree entirely. */
export function isHiddenSubtree(el: Element, env: Env): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.hasAttribute("inert")) return true;
  if (el.localName === "dialog" && !el.hasAttribute("open")) return true;
  if (env.style(el).display === "none") return true;
  return false;
}

/** Effective visibility of `el` (inherits from its parent when the style does not say). */
export function computeVisible(el: Element, env: Env): boolean {
  const v = env.style(el).visibility;
  if (v === "hidden" || v === "collapse") return false;
  if (v === "visible") return true;
  const parent = el.parentElement;
  return parent ? (env.visible.get(parent) ?? true) : true;
}

export function isInline(el: Element, env: Env): boolean {
  const d = env.style(el).display;
  if (d) return d.startsWith("inline") || d === "contents" || d === "ruby";
  return INLINE_TAGS.has(el.localName);
}

/** Visible text of `el`, honouring hidden subtrees, visibility and image alt text. */
export function visibleText(el: Element, env: Env): string {
  const parts: string[] = [];
  const rec = (node: Element, vis: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        if (vis) parts.push((child as Text).data);
      } else if (isElement(child)) {
        if (isSkippedTag(child) || isHiddenSubtree(child, env)) continue;
        const v = env.style(child).visibility;
        const childVis = v === "hidden" || v === "collapse" ? false : v === "visible" ? true : vis;
        const tag = child.localName;
        if (tag === "img") {
          if (childVis) parts.push(` ${child.getAttribute("alt") ?? ""} `);
        } else if (tag === "br") {
          parts.push(" ");
        } else if (tag === "svg" || tag === "select" || tag === "textarea") {
          continue;
        } else {
          rec(child, childVis);
        }
      }
    }
  };
  rec(el, env.visible.get(el) ?? true);
  return norm(parts.join(""));
}

const FONT_KEYWORDS: Record<string, number> = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};

/** Computed font size in px. Handles non-px values and missing inheritance (e.g. no layout engine). */
export function fontPx(el: Element, env: Env): number {
  const raw = env.style(el).fontSize.trim().toLowerCase();
  const parent = el.parentElement;
  const parentPx = () => (parent ? fontPx(parent, env) : 16);
  if (!raw || raw === "inherit") return parentPx();
  const m = /^(-?\d*\.?\d+)(px|em|rem|%|pt)?$/.exec(raw);
  if (m) {
    const v = parseFloat(m[1]);
    switch (m[2]) {
      case "em":
        return v * parentPx();
      case "%":
        return (v / 100) * parentPx();
      case "rem":
        return v * 16;
      case "pt":
        return (v * 4) / 3;
      default:
        return v;
    }
  }
  if (raw in FONT_KEYWORDS) return FONT_KEYWORDS[raw];
  if (raw === "larger") return parentPx() * 1.2;
  if (raw === "smaller") return parentPx() / 1.2;
  return parentPx();
}

/** Computed numeric font weight (400 normal, 700 bold). */
export function fontWeightOf(el: Element, env: Env): number {
  const raw = env.style(el).fontWeight.trim().toLowerCase();
  const parent = el.parentElement;
  const parentW = () => (parent ? fontWeightOf(parent, env) : 400);
  if (!raw || raw === "inherit") {
    const tag = el.localName;
    return tag === "b" || tag === "strong" || tag === "th" ? Math.max(700, parentW()) : parentW();
  }
  if (raw === "normal") return 400;
  if (raw === "bold") return 700;
  if (raw === "bolder") return Math.max(700, parentW());
  if (raw === "lighter") return 300;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : parentW();
}
