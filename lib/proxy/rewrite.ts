// Makes a fetched page safe to serve from our own origin. Parsing uses parse5 (the HTML5 spec parser
// that jsdom itself is built on), never regexes, so markup like `<scr<script>ipt>` cannot sneak through.
// The response CSP (`script-src 'none'`, see handler.ts) is the second line of defence.

import { parse, serialize, type DefaultTreeAdapterTypes as T } from "parse5";
import { ProxyError } from "./errors";

type Element = T.Element;
type ParentNode = T.ParentNode;
type ChildNode = T.ChildNode;

export interface RewrittenPage {
  html: string;
  title: string;
}

const MAX_DEPTH = 1500;

/** Elements that can run code, load another browsing context or change how URLs resolve. */
const REMOVE_TAGS = new Set(["script", "iframe", "frame", "object", "embed", "applet", "base", "portal", "fencedframe"]);

const REMOVED_HTTP_EQUIV = new Set([
  "refresh",
  "content-security-policy",
  "content-security-policy-report-only",
  "set-cookie",
  "content-type", // we re-declare UTF-8 ourselves
]);

/** Attributes whose value is a URL that could carry a script. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "data", "poster", "background", "codebase", "xlink:href"]);

/** Browsers ignore leading control/space characters and tabs/newlines inside the scheme, so do we. */
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;

export function isDangerousUrl(value: string): boolean {
  const v = value.replace(URL_NOISE, "").toLowerCase();
  return (
    v.startsWith("javascript:") ||
    v.startsWith("vbscript:") ||
    v.startsWith("data:text/html") ||
    v.startsWith("data:application/xhtml")
  );
}

function isElement(node: ChildNode | ParentNode): node is Element {
  return "tagName" in node;
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function setAttr(el: Element, name: string, value: string): void {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else el.attrs.push({ name, value });
}

function relTokens(el: Element): string[] {
  return (attr(el, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when the element must be dropped. May also tidy the element in place (loadCSS pattern). */
function shouldDrop(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (REMOVE_TAGS.has(tag)) return true;

  if (tag === "meta") {
    const equiv = (attr(el, "http-equiv") ?? "").trim().toLowerCase();
    if (REMOVED_HTTP_EQUIV.has(equiv)) return true;
    if (el.attrs.some((a) => a.name === "charset")) return true;
    if ((attr(el, "name") ?? "").trim().toLowerCase() === "referrer") return true; // ours is injected first
    return false;
  }

  if (tag === "link") {
    const rel = relTokens(el);
    if (rel.includes("modulepreload") || rel.includes("import")) return true;
    if (rel.includes("preload") || rel.includes("prefetch") || rel.includes("prerender")) {
      const as = (attr(el, "as") ?? "").toLowerCase();
      const href = (attr(el, "href") ?? "").split(/[?#]/)[0].toLowerCase();
      if (as === "script" || as === "worker" || /\.(m?js|cjs)$/.test(href)) return true;
      // <link rel=preload as=style onload="this.rel='stylesheet'"> is how pages load CSS without
      // blocking render. Without scripts the swap never happens, so apply the stylesheet directly.
      if (rel.includes("preload") && as === "style" && /stylesheet/i.test(attr(el, "onload") ?? "")) {
        setAttr(el, "rel", "stylesheet");
        el.attrs = el.attrs.filter((a) => a.name !== "as");
      }
    }
    return false;
  }

  // SMIL could animate an href to a javascript: URL.
  if ((tag === "animate" || tag === "set") && /href$/i.test(attr(el, "attributename") ?? "")) return true;

  return false;
}

function sanitizeAttributes(el: Element): void {
  el.attrs = el.attrs.filter((a) => {
    const name = a.name.toLowerCase();
    if (name.startsWith("on")) return false; // onclick, onload, onerror, ...
    if (name === "srcdoc" || name === "ping") return false;
    return true;
  });
  for (const a of el.attrs) {
    const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
    if (URL_ATTRS.has(name.toLowerCase()) && isDangerousUrl(a.value)) a.value = "#";
  }
}

function sanitizeChildren(parent: ParentNode, depth: number): void {
  if (depth > MAX_DEPTH) throw new ProxyError("fetch-failed", "That page is nested too deeply to analyse.");
  const kids = parent.childNodes as ChildNode[];
  for (let i = 0; i < kids.length; ) {
    const node = kids[i];
    if (!isElement(node)) {
      i++;
      continue;
    }
    if (shouldDrop(node)) {
      kids.splice(i, 1);
      continue;
    }
    if (node.tagName.toLowerCase() === "noscript") {
      // Scripting is off for the parse, so the children are real elements: what a no-JS browser shows.
      // Splice them in and re-examine them from the same index (they are not yet sanitised).
      const inner = node.childNodes as ChildNode[];
      for (const child of inner) (child as { parentNode: ParentNode | null }).parentNode = parent;
      kids.splice(i, 1, ...inner);
      continue;
    }
    sanitizeAttributes(node);
    sanitizeChildren(node, depth + 1);
    if ("content" in node) sanitizeChildren((node as T.Template).content, depth + 1);
    i++;
  }
}

function findElement(parent: ParentNode, tag: string, depth = 0): Element | null {
  if (depth > 6) return null;
  for (const child of parent.childNodes as ChildNode[]) {
    if (!isElement(child)) continue;
    if (child.tagName === tag) return child;
    if (tag === "head" || tag === "body") {
      if (child.tagName === "html") {
        const found = findElement(child, tag, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

function makeElement(tagName: string, attrs: Array<{ name: string; value: string }>, parent: ParentNode): Element {
  return {
    nodeName: tagName,
    tagName,
    attrs,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [],
    parentNode: parent,
  } as unknown as Element;
}

function textOf(el: Element): string {
  let out = "";
  for (const child of el.childNodes as ChildNode[]) if ("value" in child && child.nodeName === "#text") out += child.value;
  return out.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Parse `html`, neutralise active content, inject `<base href=finalUrl>` and the no-referrer meta as the
 * first children of `<head>`, and serialise back to HTML.
 */
export function rewriteHtml(html: string, finalUrl: string): RewrittenPage {
  let document: T.Document;
  try {
    // scriptingEnabled:false makes <noscript> children parse as elements, as in a browser without JS.
    document = parse(html, { scriptingEnabled: false });
    sanitizeChildren(document, 0);
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new ProxyError("fetch-failed", "That page could not be read.");
  }

  const head = findElement(document, "head");
  if (!head) throw new ProxyError("fetch-failed", "That page could not be read.");
  const headKids = head.childNodes as ChildNode[];
  headKids.unshift(
    makeElement("base", [{ name: "href", value: finalUrl }], head),
    makeElement("meta", [{ name: "name", value: "referrer" }, { name: "content", value: "no-referrer" }], head),
    makeElement("meta", [{ name: "charset", value: "utf-8" }], head),
  );

  const titleEl = headKids.find((n): n is Element => isElement(n) && n.tagName === "title");
  let out: string;
  try {
    out = serialize(document);
  } catch {
    throw new ProxyError("fetch-failed", "That page is nested too deeply to analyse.");
  }
  return { html: out, title: titleEl ? textOf(titleEl) : "" };
}
