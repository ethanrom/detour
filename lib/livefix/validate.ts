// Server-side validation of the edits an agent (or a recording, or the fallback) proposes for one fix.
// Pure: it never throws for bad input; it returns the reasons, worded so they can be fed back to the model.
//
// The browser applies these edits to a live copy of the page, so the rules keep the edit small and inert:
//   * selectors only reach the fix's own targets (plus the fix's extraSelectors);
//   * HTML fragments are parsed with parse5 and may not carry scripts, handlers or script URLs;
//   * setAttributes / wrapChildren / removeAttributes work from allow-lists;
//   * CSS cannot fetch anything or carry markup.

import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { isDangerousUrl } from "@/lib/proxy/rewrite";
import { checkLabel } from "@/lib/repair/labels";
import { MAX_EDIT_CSS, MAX_EDIT_HTML, MAX_EDITS_PER_FIX, type EditOp, type FixEdits, type FixRequestItem, type InsertPosition } from "./types";

export const MAX_NOTE_CHARS = 300;
export const MAX_SET_TEXT_CHARS = 200;
const MAX_ATTRIBUTE_VALUE = 300;
const MAX_ERRORS = 12;

export type ValidatedEdits = Omit<FixEdits, "source" | "ms">;
export type ValidateResult = { ok: ValidatedEdits } | { errors: string[] };

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const FORBIDDEN_TAGS = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "style", "base", "template", "noscript",
  // SVG elements that can rewrite an attribute (for example an href) after the markup was checked.
  "animate", "set", "animatemotion", "animatetransform", "foreignobject",
]);

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "background"]);

const FIXED_ATTRIBUTES = new Set(["role", "tabindex", "type", "id", "class", "lang", "data-detour-id", "href"]);
const REMOVABLE_ATTRIBUTES = new Set(["tabindex", "role", "aria-hidden", "aria-label", "aria-labelledby"]);
const POSITIONS = new Set<InsertPosition>(["beforebegin", "afterbegin", "beforeend", "afterend"]);

const WORD_ONLY = /^[a-z][a-z-]*( [a-z][a-z-]*)*$/i;
const ID_VALUE = /^[^\s"'<>&=`]{1,100}$/;

// ---------------------------------------------------------------------------------------------------------
// Selectors

function allowedSelectors(item: FixRequestItem): Set<string> {
  const set = new Set<string>(item.targets.map((t) => t.selector));
  for (const s of item.extraSelectors ?? []) set.add(s);
  // A skip link is inserted into the body; the request always names it, but the fallback must not depend on that.
  if (item.kind === "skip-link") set.add("body");
  return set;
}

// ---------------------------------------------------------------------------------------------------------
// CSS

const CSS_BANS: Array<[RegExp, string]> = [
  [/url\s*\(/, "url("],
  [/@import/, "@import"],
  [/expression\s*\(/, "expression("],
  [/javascript:/, "javascript:"],
  [/<\//, "</"],
  [/behavior\s*:/, "behavior:"],
  [/-moz-binding/, "-moz-binding"],
  [/image-set\s*\(/, "image-set("],
  [/\bsrc\s*\(/, "src("],
  [/\\/, "a backslash escape"],
];

function bannedCss(css: string): string[] {
  const lower = css.toLowerCase();
  const noComments = lower.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  for (const [re, label] of CSS_BANS) if (re.test(lower) || re.test(noComments)) found.add(label);
  return [...found];
}

const KEYFRAME_STEPS = /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/i;

/** Rule selectors that name no class (so they would restyle every element of a tag). */
function unscopedSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith("@") || KEYFRAME_STEPS.test(prelude)) continue;
    for (const sel of prelude.split(",")) {
      if (!/\.[A-Za-z_-]/.test(sel) && !sel.includes("[data-detour-id")) out.push(sel.trim());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Attributes

function badStyleValue(value: string): boolean {
  const v = value.toLowerCase().replace(/\/\*[\s\S]*?\*\//g, "");
  return /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding|image-set\s*\(|\\/.test(v);
}

/** The name of an attribute allowed by setAttributes / wrapChildren, or an error. */
function checkSettable(name: string, value: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return `"${name}" is not a valid attribute name (use lower case)`;
  const isAria = /^aria-[a-z]+$/.test(name);
  if (!isAria && !FIXED_ATTRIBUTES.has(name)) {
    return `attribute "${name}" is not allowed (allowed: aria-*, role, tabindex <= 0, type, id, class, lang, data-detour-id, href starting with #)`;
  }
  if (value.length > MAX_ATTRIBUTE_VALUE) return `the value of "${name}" is longer than ${MAX_ATTRIBUTE_VALUE} characters`;
  if (name === "tabindex" && !(/^-?\d+$/.test(value) && Number(value) <= 0)) return `tabindex must be an integer of 0 or less, not "${value}"`;
  if (name === "href" && !value.startsWith("#")) return `href may only point inside the page (start it with #), not "${value.slice(0, 40)}"`;
  if (name === "role" && !WORD_ONLY.test(value)) return `role "${value.slice(0, 40)}" is not a valid role name`;
  if (name === "id" && !ID_VALUE.test(value)) return `id "${value.slice(0, 40)}" must be one token without spaces or quotes`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// HTML fragments

function isElement(n: Node): n is Element {
  return "tagName" in n;
}

function childrenOf(n: Node): Node[] {
  const out: Node[] = [];
  if ("childNodes" in n) out.push(...n.childNodes);
  if ("content" in n) out.push(...n.content.childNodes);
  return out;
}

interface FragmentCheck {
  errors: string[];
  /** Number of root elements. */
  roots: number;
  /** aria-label values found anywhere in the fragment. */
  labels: string[];
}

function checkFragment(html: string): FragmentCheck {
  const errors: string[] = [];
  const labels: string[] = [];
  const doc = parseFragment(html);
  let roots = 0;
  const walk = (n: Node, depth: number): void => {
    if (depth > 60) {
      if (!errors.includes("the HTML is nested too deeply")) errors.push("the HTML is nested too deeply");
      return;
    }
    if (isElement(n)) {
      const tag = n.tagName.toLowerCase();
      if (FORBIDDEN_TAGS.has(tag)) errors.push(`<${tag}> is not allowed in HTML`);
      for (const a of n.attrs) {
        const name = ((a.prefix ? `${a.prefix}:` : "") + a.name).toLowerCase();
        if (name.startsWith("on")) errors.push(`event handler attribute "${name}" is not allowed`);
        else if (name === "srcdoc") errors.push(`attribute "srcdoc" is not allowed`);
        else if (URL_ATTRIBUTES.has(name) && isDangerousUrl(a.value)) errors.push(`${name} must not be a script URL`);
        else if (name === "style" && badStyleValue(a.value)) errors.push("the style attribute must not use url(, expression(, @import or escapes");
        if (name === "aria-label") labels.push(a.value);
      }
    }
    for (const c of childrenOf(n)) walk(c, depth + 1);
  };
  for (const c of doc.childNodes) {
    if (isElement(c)) roots++;
    walk(c, 0);
  }
  return { errors: [...new Set(errors)], roots, labels };
}

// ---------------------------------------------------------------------------------------------------------
// The validator

/** Checks an edit set for one fix. Returns it normalised (label wording cleaned, note cut to one sentence,
 *  empty CSS dropped) or every reason it was refused. */
export function validateEdits(item: FixRequestItem, raw: { edits: EditOp[]; css?: string; note: string }): ValidateResult {
  const errors: string[] = [];
  const err = (message: string): void => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };
  const selectors = allowedSelectors(item);
  const checkLabels = item.kind === "add-label";

  const rawEdits = Array.isArray(raw.edits) ? raw.edits : [];
  if (rawEdits.length === 0) err("no edits were given");
  if (rawEdits.length > MAX_EDITS_PER_FIX) err(`${rawEdits.length} edits is too many (at most ${MAX_EDITS_PER_FIX})`);

  const label = (value: string, where: string): string => {
    const checked = checkLabel(value);
    if ("error" in checked) {
      err(`${where}: ${checked.error}`);
      return value;
    }
    return checked.ok;
  };

  const attributeMap = (attrs: Record<string, string>, where: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const entries = Object.entries(attrs ?? {});
    if (entries.length === 0) err(`${where}: no attributes were given`);
    for (const [rawName, rawValue] of entries) {
      const name = rawName.trim().toLowerCase();
      const value = String(rawValue);
      const problem = checkSettable(name, value);
      if (problem) {
        err(`${where}: ${problem}`);
        continue;
      }
      out[name] = checkLabels && name === "aria-label" ? label(value, `${where} aria-label`) : value;
    }
    return out;
  };

  const html = (value: string, where: string, singleRoot: boolean): void => {
    if (typeof value !== "string" || value.trim() === "") return err(`${where}: html is empty`);
    if (value.length > MAX_EDIT_HTML) return err(`${where}: html is ${value.length} characters (at most ${MAX_EDIT_HTML})`);
    const check = checkFragment(value);
    for (const e of check.errors) err(`${where}: ${e}`);
    if (check.roots === 0) err(`${where}: html has no element`);
    else if (singleRoot && check.roots > 1) err(`${where}: html must have one root element, not ${check.roots}`);
    if (checkLabels) for (const l of check.labels) label(l, `${where} aria-label`);
  };

  const edits: EditOp[] = [];
  rawEdits.slice(0, MAX_EDITS_PER_FIX).forEach((edit, i) => {
    const where = `edits[${i}] (${String((edit as { op?: unknown }).op)})`;
    if (typeof edit.selector !== "string" || !selectors.has(edit.selector)) {
      err(`${where}: selector ${JSON.stringify(String(edit.selector).slice(0, 80))} is not one of the fix's selectors (${[...selectors].slice(0, 6).map((s) => JSON.stringify(s)).join(", ")})`);
      return;
    }
    switch (edit.op) {
      case "replace":
        html(edit.html, where, true);
        edits.push(edit);
        break;
      case "insert":
        if (!POSITIONS.has(edit.position)) err(`${where}: position must be beforebegin, afterbegin, beforeend or afterend`);
        else if (edit.selector === "body" && (edit.position === "beforebegin" || edit.position === "afterend")) err(`${where}: insert inside the body (afterbegin or beforeend)`);
        html(edit.html, where, false);
        edits.push(edit);
        break;
      case "setAttributes":
        edits.push({ ...edit, attributes: attributeMap(edit.attributes, where) });
        break;
      case "wrapChildren":
        if (edit.tag !== "button" && edit.tag !== "span") err(`${where}: tag must be "button" or "span"`);
        edits.push({ ...edit, attributes: attributeMap(edit.attributes, where) });
        break;
      case "removeAttributes": {
        const names = (Array.isArray(edit.names) ? edit.names : []).map((n) => String(n).trim().toLowerCase());
        if (names.length === 0) err(`${where}: no attribute names were given`);
        for (const n of names) if (!REMOVABLE_ATTRIBUTES.has(n)) err(`${where}: attribute "${n}" cannot be removed (allowed: ${[...REMOVABLE_ATTRIBUTES].join(", ")})`);
        edits.push({ ...edit, names });
        break;
      }
      case "setText":
        if (typeof edit.text !== "string" || edit.text.trim() === "") err(`${where}: text is empty`);
        else if (edit.text.length > MAX_SET_TEXT_CHARS) err(`${where}: text is ${edit.text.length} characters (at most ${MAX_SET_TEXT_CHARS})`);
        edits.push(edit);
        break;
      default:
        err(`${where}: unknown op`);
    }
  });

  let css: string | undefined;
  if (raw.css !== undefined && raw.css.trim() !== "") {
    css = raw.css.trim();
    if (css.length > MAX_EDIT_CSS) err(`css is ${css.length} characters (at most ${MAX_EDIT_CSS})`);
    const banned = bannedCss(css);
    if (banned.length) err(`css must not contain ${banned.join(", ")}`);
    const bare = unscopedSelectors(css);
    if (bare.length) err(`css rules must be scoped to a class you add (for example .detour-fix-btn); no class in ${bare.slice(0, 3).map((s) => JSON.stringify(s)).join(", ")}`);
  }

  // One sentence: whitespace collapsed, anything after the first sentence end dropped.
  const collapsed = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  const note = collapsed.split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? "";
  if (!note) err("the note is empty");
  else if (note.length > MAX_NOTE_CHARS) err(`the note is ${note.length} characters (at most ${MAX_NOTE_CHARS}, one sentence)`);

  if (errors.length) return { errors };
  return { ok: { fixId: item.fixId, edits, ...(css ? { css } : {}), note } };
}
