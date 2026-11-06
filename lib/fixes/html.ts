// Tiny helpers that render abbreviated before/after HTML for HtmlPatch from a node's tag and selector.

import type { A11yNode } from "@/lib/contracts";

const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link", "source", "area", "col", "embed", "track", "wbr"]);

export interface SelectorParts {
  id?: string;
  classes: string[];
  attrs: Array<[string, string | null]>;
}

/** Last compound of a CSS selector split into #id, .classes and [attrs]. data-detour-id is dropped
 *  (it is our own extraction marker, not part of the author's HTML). */
export function parseSelector(selector: string): SelectorParts {
  // Find the last compound selector: split at top-level whitespace and combinators.
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  // Pseudo-classes carry no attributes (and may hold selectors of their own, e.g. :not(.x)).
  const compound = selector.slice(start).replace(/(?<!\\):[\w-]+(?:\([^)]*\))?/g, "");

  const out: SelectorParts = { classes: [], attrs: [] };
  const name = String.raw`((?:\\.|[\w-])+)`;
  const re = new RegExp(String.raw`#${name}|\.${name}|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]`, "g");
  const unescape = (s: string) => s.replace(/\\(.)/g, "$1");
  for (const m of compound.matchAll(re)) {
    if (m[1]) out.id = unescape(m[1]);
    else if (m[2]) out.classes.push(unescape(m[2]));
    else if (m[3] && m[3] !== "data-detour-id") out.attrs.push([m[3], m[4] ?? m[5] ?? m[6] ?? null]);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Collapse whitespace and cut to `max` characters with an ellipsis. */
export function abbreviate(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Attributes from the selector in a stable order: id, class, then the rest. `className` (the source
 *  element's class attribute) replaces the selector's classes when known; `bare` keeps only the class,
 *  for patches that describe a whole component rather than one element. */
function selectorAttrs(node: A11yNode, className: string | undefined, bare: boolean): string[] {
  const p = parseSelector(node.selector);
  const classes = className !== undefined ? className.split(/\s+/).filter(Boolean) : p.classes;
  const attrs: string[] = [];
  if (p.id && !bare) attrs.push(`id="${esc(p.id)}"`);
  if (classes.length) attrs.push(`class="${esc(classes.join(" "))}"`);
  if (!bare) for (const [k, v] of p.attrs) attrs.push(v === null ? k : `${k}="${esc(v)}"`);
  return attrs;
}

export interface ElementOptions {
  tag?: string;
  /** Attributes placed first, before those recovered from the selector. */
  leading?: string[];
  /** Attributes placed after those recovered from the selector. */
  trailing?: string[];
  /** Selector attributes to drop (by name, e.g. "role" or "tabindex"). */
  omit?: string[];
  /** Inner HTML; defaults to the node's name (or an ellipsis when it has none). */
  inner?: string;
  /** The element's class attribute, when the extractor recorded it (hints.className). */
  className?: string;
  /** Describe the component, not one element: no id or other selector attributes. */
  bare?: boolean;
}

/** `<tag attrs>inner</tag>` for a node; void elements render without a closing tag. */
export function renderElement(node: A11yNode, o: ElementOptions = {}): string {
  const tag = o.tag ?? node.tag;
  const omit = new Set(o.omit ?? []);
  const own = selectorAttrs(node, o.className, o.bare ?? false).filter((a) => !omit.has(a.split("=")[0]));
  const attrs = [...(o.leading ?? []), ...own, ...(o.trailing ?? [])];
  const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  if (VOID_TAGS.has(tag)) return open;
  const inner = o.inner ?? (node.name.trim() ? abbreviate(node.name) : node.children.length ? "…" : "");
  return `${open}${inner}</${tag}>`;
}
