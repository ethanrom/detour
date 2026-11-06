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
  const compound = selector.slice(start);

  const out: SelectorParts = { classes: [], attrs: [] };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  for (const m of compound.matchAll(re)) {
    if (m[1]) out.id = m[1];
    else if (m[2]) out.classes.push(m[2]);
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

/** Attributes from the selector in a stable order: id, class, then the rest. */
function selectorAttrs(node: A11yNode): string[] {
  const p = parseSelector(node.selector);
  const attrs: string[] = [];
  if (p.id) attrs.push(`id="${esc(p.id)}"`);
  if (p.classes.length) attrs.push(`class="${esc(p.classes.join(" "))}"`);
  for (const [k, v] of p.attrs) attrs.push(v === null ? k : `${k}="${esc(v)}"`);
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
}

/** `<tag attrs>inner</tag>` for a node; void elements render without a closing tag. */
export function renderElement(node: A11yNode, o: ElementOptions = {}): string {
  const tag = o.tag ?? node.tag;
  const omit = new Set(o.omit ?? []);
  const own = selectorAttrs(node).filter((a) => !omit.has(a.split("=")[0]));
  const attrs = [...(o.leading ?? []), ...own, ...(o.trailing ?? [])];
  const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  if (VOID_TAGS.has(tag)) return open;
  const inner = o.inner ?? (node.name.trim() ? abbreviate(node.name) : node.children.length ? "…" : "");
  return `${open}${inner}</${tag}>`;
}
