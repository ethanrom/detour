// Heuristic hints that drive the fix generator: heading-looking text, fake buttons, unlabeled controls.

import type { NodeHints } from "@/lib/contracts";
import { type Env, fontPx, fontWeightOf, isElement, norm, TEXT_NODE } from "./dom";
import { tabIndexAttr } from "./focus";

const MAX_HEADING_CHARS = 80;

/** Descendants that make an element a real structure/control rather than a click target. */
const SEMANTIC_DESCENDANTS = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
  '[contenteditable]:not([contenteditable="false"])',
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "table",
  "nav",
  "main",
  "aside",
  "header",
  "footer",
  "form",
  '[role]:not([role="img"]):not([role="presentation"]):not([role="none"])',
].join(",");

const NEVER_FAKE_TAGS = new Set(["label", "option", "optgroup", "html", "body", "summary", "svg", "button", "input", "select", "textarea"]);

/** The element carrying the visible text style: follow a chain of single inline children. */
export function styleSourceOf(el: Element): Element {
  let cur = el;
  for (;;) {
    let only: Element | null = null;
    let extra = false;
    for (const c of Array.from(cur.childNodes)) {
      if (isElement(c)) {
        if (only) extra = true;
        else only = c;
      } else if (c.nodeType === TEXT_NODE && /\S/.test((c as Text).data)) {
        extra = true;
      }
    }
    if (!only || extra) return cur;
    cur = only;
  }
}

export function levelForRatio(ratio: number): 1 | 2 | 3 | 4 {
  return ratio >= 2 ? 1 : ratio >= 1.5 ? 2 : ratio >= 1.25 ? 3 : 4;
}

/**
 * Prose-like text: not a price, rating, statistic or other figure. Rejects text that starts with a digit or
 * currency symbol, has fewer than 2 letters, or where letters are under half of the non-space characters.
 */
export function isHeadingText(text: string): boolean {
  if (/^[\p{N}\p{Sc}]/u.test(text)) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 2) return false;
  const nonSpace = text.replace(/\s/g, "").length;
  return letters / nonSpace >= 0.5;
}

/** Visual-style signature for grouping nodes that come from one component: tag, sorted classes, size, weight. */
export function styleKeyOf(el: Element, env: Env, fromTextSource: boolean): string {
  const src = fromTextSource ? styleSourceOf(el) : el;
  const classes = Array.from(el.classList).sort();
  const head = classes.length ? `${el.localName}.${classes.join(".")}` : el.localName;
  return `${head}|${Math.round(fontPx(src, env))}|${fontWeightOf(src, env)}`;
}

/** Large and/or bold short text that is not exposed as a heading. `text` is the element's whole text. */
export function looksLikeHeadingHint(el: Element, text: string, env: Env): NodeHints["looksLikeHeading"] | undefined {
  if (!text || text.length > MAX_HEADING_CHARS || !isHeadingText(text)) return undefined;
  const src = styleSourceOf(el);
  const body = env.doc.body;
  const bodyPx = body ? fontPx(body, env) : 16;
  const ratio = fontPx(src, env) / (bodyPx || 16);
  const weight = fontWeightOf(src, env);
  if (!(ratio >= 1.25 || (weight >= 600 && ratio >= 1.1))) return undefined;
  return {
    fontSizeRatio: Math.round(ratio * 100) / 100,
    fontWeight: weight,
    suggestedLevel: levelForRatio(ratio),
  };
}

/** Role-less, tabindex-less element that behaves like a control: pointer cursor starting here, or onclick. */
export function isClickTarget(el: Element, env: Env): boolean {
  if (NEVER_FAKE_TAGS.has(el.localName)) return false;
  const ti = tabIndexAttr(el);
  if (ti !== null && ti >= 0) return false;
  const html = el as HTMLElement;
  if (el.hasAttribute("onclick") || typeof html.onclick === "function") return true;
  if (env.style(el).cursor !== "pointer") return false;
  const parent = el.parentElement;
  return !(parent && env.style(parent).cursor === "pointer");
}

/** A click target that contains controls/headings/lists is a layout wrapper, not a fake button. */
export function hasSemanticDescendants(el: Element): boolean {
  try {
    return el.querySelector(SEMANTIC_DESCENDANTS) !== null;
  } catch {
    return false;
  }
}

const ICON_PREFIX = /^(?:icon|ico|i|fa|fas|far|fab|fal|fad|bi|mdi|glyphicon|lucide|feather|ti|ri|ion|iconoir|material-icons?)[-_](.+)$/i;
const ICON_SUFFIX = /^(.+)[-_]icon$/i;
const ICON_IGNORE = new Set([
  "",
  "solid",
  "regular",
  "light",
  "thin",
  "duotone",
  "brands",
  "fw",
  "lg",
  "sm",
  "xs",
  "2x",
  "3x",
  "4x",
  "5x",
  "spin",
  "pulse",
  "outlined",
  "filled",
  "round",
  "rounded",
  "sharp",
  "button",
  "btn",
  "wrapper",
  "wrap",
  "container",
  "base",
  "small",
  "large",
  "medium",
]);
const GENERIC_FILE_NAMES = new Set(["icon", "img", "image", "pic", "picture", "sprite", "asset", "logo-placeholder", "placeholder"]);

function humanize(s: string): string {
  return norm(
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\s+(outline|outlined|fill|filled|solid|regular|line|sharp|rounded|\d+px|\d+)$/i, "")
      .toLowerCase(),
  );
}

function iconNameFromClasses(el: Element): string {
  for (const token of Array.from(el.classList)) {
    const m = ICON_PREFIX.exec(token) ?? ICON_SUFFIX.exec(token);
    if (!m) continue;
    const name = humanize(m[1]);
    if (!ICON_IGNORE.has(name)) return name;
  }
  return "";
}

/** Tags never accepted as a text label (controls, graphics, non-rendered). */
const NON_LABEL_TAGS = new Set(["script", "style", "svg", "a", "button", "input", "select", "textarea", "img"]);

/**
 * Text of a sibling if it looks like a label: a text node, or an element with at most one child element.
 * Returns "" to keep scanning (controls, hidden nodes, whitespace) and null to stop (complex structure).
 */
function labelText(n: Node): string | null {
  if (n.nodeType === TEXT_NODE) return norm((n as Text).data);
  if (!isElement(n)) return "";
  if (NON_LABEL_TAGS.has(n.localName)) return "";
  if (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true") return "";
  if (n.children.length > 1) return null;
  return norm(n.textContent ?? "");
}

/** Label-like text among the siblings of `el` (same parent only). */
function nearbyText(el: Element, direction: "previous" | "next"): string {
  for (let sib: Node | null = direction === "previous" ? el.previousSibling : el.nextSibling; sib; sib = direction === "previous" ? sib.previousSibling : sib.nextSibling) {
    const t = labelText(sib);
    if (t === null) return "";
    if (t) return t.length <= 60 ? t : "";
  }
  return "";
}

/** data-* attributes that hold a human-readable name (data-colour="Ember", data-network="instagram"). */
const DATA_NAME = /colou?r|name|label|value|network|view/i;

function dataAttrLabel(el: Element): string {
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith("data-") || !DATA_NAME.test(attr.name)) continue;
    const v = norm(attr.value);
    if (v.length <= 40 && (v.match(/\p{L}/gu) ?? []).length >= 2) return v;
  }
  return "";
}

export interface VisualLabel {
  text: string;
  /** True when the text is only the nearest label-like sibling text, which siblings may share. */
  weak: boolean;
}

/**
 * Best visible or contextual text for a control whose accessible name is empty. Sources, strongest first:
 * title, svg <title>, data-* names, data-icon, icon class tokens, svg <use>/img file name, field name, nearby text.
 * The text may be "".
 */
export function visualLabelFor(el: Element): VisualLabel {
  const strong = (text: string): VisualLabel => ({ text, weak: false });

  const title = norm(el.getAttribute("title") ?? "");
  if (title) return strong(title);

  const svgTitle = norm(el.querySelector("svg title")?.textContent ?? "");
  if (svgTitle) return strong(svgTitle);

  const data = dataAttrLabel(el);
  if (data) return strong(data);

  const dataIcon = el.getAttribute("data-icon") ?? el.querySelector("[data-icon]")?.getAttribute("data-icon") ?? "";
  if (dataIcon.trim()) return strong(humanize(dataIcon.trim()));

  const carriers: Element[] = [el, ...Array.from(el.querySelectorAll("*")).slice(0, 12)];
  for (const c of carriers) {
    const n = iconNameFromClasses(c);
    if (n) return strong(n);
  }

  const use = el.querySelector("svg use");
  const href = use?.getAttribute("href") ?? use?.getAttribute("xlink:href") ?? "";
  const frag = href.includes("#") ? href.slice(href.lastIndexOf("#") + 1) : "";
  if (frag) {
    const m = ICON_PREFIX.exec(frag) ?? ICON_SUFFIX.exec(frag);
    const n = humanize(m ? m[1] : frag);
    if (n && !ICON_IGNORE.has(n)) return strong(n);
  }

  const src = el.querySelector("img")?.getAttribute("src") ?? "";
  if (src) {
    const file = src.split(/[?#]/)[0].split("/").pop() ?? "";
    const base = humanize(file.replace(/\.[a-z0-9]+$/i, ""));
    if (base && !GENERIC_FILE_NAMES.has(base)) return strong(base);
  }

  const tag = el.localName;
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const nm = el.getAttribute("name");
    if (nm && /[a-z]/i.test(nm)) return strong(humanize(nm));
  }

  const type = el.getAttribute("type")?.toLowerCase();
  const before = nearbyText(el, "previous");
  if (before) return { text: before, weak: true };
  if (type === "checkbox" || type === "radio") {
    const after = nearbyText(el, "next");
    if (after) return { text: after, weak: true };
  }
  return strong("");
}
