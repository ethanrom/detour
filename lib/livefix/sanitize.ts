// Browser-side sanitiser for agent edits. The server validates too; this is the last line before markup
// reaches the live copy of the page, so it assumes nothing. Works on any Document (browser, iframe, jsdom)
// and avoids instanceof, so it is realm-safe.

import { MAX_EDIT_CSS, MAX_EDIT_HTML } from "./types";

export interface SanitizeError {
  error: string;
}

/** True for the error arm of sanitizeFragment / sanitizeCss. */
export function isSanitizeError(x: unknown): x is SanitizeError {
  return typeof x === "object" && x !== null && "error" in x;
}

/** Elements that can run code, load another browsing context, restyle the page or change how URLs resolve. */
const DROP_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "style",
  "base",
  "template",
  "noscript",
  // SVG animation can set an href to a script URL after the attribute check has passed.
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
]);

/** Attributes whose value is a URL that could carry a script. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background"]);

/** Browsers ignore leading control/space characters and tabs/newlines inside the scheme, so do we.
 *  (Same rule as lib/proxy/rewrite.ts isDangerousUrl, copied so this module stays free of the proxy's
 *  parse5 dependency in the browser bundle.) */
const URL_NOISE = new RegExp("[" + [[0, 0x20], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]", "g");

export function isDangerousUrl(value: string): boolean {
  const v = value.replace(URL_NOISE, "").toLowerCase();
  return v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html") || v.startsWith("data:application/xhtml");
}

/** CSS text that can fetch a resource, run script or load behaviour. Comments and escapes are stripped first
 *  so `u\72l(` and `ur/**\/l(` do not slip through. */
export function cssIsUnsafe(css: string): boolean {
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16) || 0x20, 0x10ffff)))
    .replace(/\\/g, "")
    .toLowerCase();
  return /url\s*\(|@import|expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding|<\//.test(flat);
}

/** Returns the css when it is safe to inject, otherwise the reason it was rejected. */
export function sanitizeCss(css: string): { css: string } | SanitizeError {
  if (css.length > MAX_EDIT_CSS) return { error: `CSS is longer than ${MAX_EDIT_CSS} characters.` };
  if (cssIsUnsafe(css)) return { error: "CSS may not load resources, import files or run code (url(, @import, expression(, javascript:, behavior:)." };
  return { css };
}

const ARIA = /^aria-[a-z][a-z-]*$/;
const ALWAYS_ALLOWED = new Set(["role", "type", "id", "class", "lang", "data-detour-id"]);

/**
 * Allow-list for attributes an edit may set or remove: aria-*, role, tabindex (an integer, at most 0), type, id,
 * class, lang, data-detour-id, and href only when it points inside the page ("#..."). Pass `value` when setting;
 * leave it out when removing, so `tabindex` can be removed whatever it holds.
 */
export function isAllowedAttribute(name: string, value?: string): boolean {
  const n = name.toLowerCase();
  if (ARIA.test(n) || ALWAYS_ALLOWED.has(n)) return true;
  if (n === "tabindex") return value === undefined || (/^\s*-?\d+\s*$/.test(value) && parseInt(value, 10) <= 0);
  if (n === "href") return value === undefined || value.startsWith("#");
  return false;
}

/** True for a name setAttribute will accept. */
export function isSafeAttributeName(name: string): boolean {
  return /^[a-z][a-z0-9_:.-]*$/i.test(name);
}

function cleanElement(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || name === "srcdoc") {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) {
      el.removeAttribute(attr.name);
    } else if (name === "style" && cssIsUnsafe(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

/**
 * Parse `html` in an inert <template> and strip everything that can run code or fetch by itself. Returns the
 * cleaned nodes adopted into `doc` (ready to insert) or the reason the markup was refused. Nothing in the
 * template runs or loads while it is being cleaned.
 */
export function sanitizeFragment(doc: Document, html: string): DocumentFragment | SanitizeError {
  if (typeof html !== "string" || html.trim() === "") return { error: "The new HTML is empty." };
  if (html.length > MAX_EDIT_HTML) return { error: `The new HTML is longer than ${MAX_EDIT_HTML} characters.` };
  const template = doc.createElement("template");
  template.innerHTML = html;
  const content = template.content;
  for (const el of Array.from(content.querySelectorAll("*"))) {
    if (DROP_TAGS.has(el.localName.toLowerCase())) el.remove();
    else cleanElement(el);
  }
  if (content.childNodes.length === 0) return { error: "The new HTML had nothing left after cleaning." };
  return doc.importNode(content, true);
}
