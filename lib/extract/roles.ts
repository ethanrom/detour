// Role resolution on top of dom-accessibility-api, landmark rules, interactive-ness and ARIA-style states.

import { computeAccessibleName, getRole } from "dom-accessibility-api";
import type { LandmarkRole } from "@/lib/contracts";

const LANDMARKS = new Set<string>(["banner", "navigation", "main", "complementary", "contentinfo", "search", "form", "region"]);

/** Roles whose elements are operated by the user: each is its own reading stop and (usually) a tab stop. */
const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "switch",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "slider",
  "spinbutton",
  "treeitem",
]);

/** Structural roles kept as container nodes whenever they hold at least one retained child. */
export const CONTAINER_ROLES = new Set([
  ...LANDMARKS,
  "list",
  "listitem",
  "table",
  "rowgroup",
  "row",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "grid",
  "treegrid",
  "tree",
  "tablist",
  "tabpanel",
  "menu",
  "menubar",
  "toolbar",
  "radiogroup",
  "listbox",
  "group",
  "article",
  "figure",
  "dialog",
  "alertdialog",
]);

/** Container roles that may not be turned into fake buttons. */
const NOT_FAKE_ROLES = new Set([...CONTAINER_ROLES].filter((r) => !["listitem", "cell", "gridcell", "columnheader", "rowheader"].includes(r)));
export function canBeFakeButtonRole(role: string | null): boolean {
  return !role || !NOT_FAKE_ROLES.has(role);
}

/** Roles a text-only element keeps on its own node (otherwise paragraph for <p>, generic for the rest). */
const TEXT_ROLES = new Set(["listitem", "cell", "gridcell", "columnheader", "rowheader", "term", "definition", "legend", "caption", "status", "alert", "note"]);

const SECTIONING_TAGS = new Set(["article", "aside", "main", "nav", "section"]);
const SECTIONING_ROLES = new Set(["article", "complementary", "main", "navigation", "region"]);

const CHECKABLE_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);

export function safeName(el: Element): string {
  try {
    return computeAccessibleName(el).replace(/\s+/g, " ").trim();
  } catch {
    return (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
  }
}

function insideSectioning(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (SECTIONING_TAGS.has(p.localName)) return true;
    const r = (p.getAttribute("role") ?? "").trim().split(/\s+/)[0];
    if (r && SECTIONING_ROLES.has(r)) return true;
  }
  return false;
}

function hasExplicitRole(el: Element): boolean {
  return (el.getAttribute("role") ?? "").trim().length > 0;
}

/** Effective ARIA role of `el` (explicit or implicit), or null when it has none (generic). */
export function roleOf(el: Element): string | null {
  const tag = el.localName;
  let role: string | null = null;
  try {
    role = getRole(el);
  } catch {
    role = null;
  }
  if (tag === "search" && !hasExplicitRole(el)) return "search";
  if (role === "presentation" || role === "none") return null;
  const explicit = hasExplicitRole(el);

  if (tag === "input" && !explicit) {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (role === null) {
      if (type === "file" || type === "color") return "button";
      return "textbox";
    }
    return role;
  }
  if (!explicit && (tag === "header" || tag === "footer")) return insideSectioning(el) ? null : role;
  if (role === "form" || role === "region") return safeName(el) ? role : null;
  if (role === "generic") return null;
  return role;
}

export function landmarkOf(role: string | null): LandmarkRole | undefined {
  return role && LANDMARKS.has(role) ? (role as LandmarkRole) : undefined;
}

export function interactiveRoleOf(el: Element, role: string | null): string | null {
  const tag = el.localName;
  if (tag === "select") return role === "listbox" ? "listbox" : "combobox";
  if (role && INTERACTIVE_ROLES.has(role)) return role;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce.toLowerCase() !== "false") return "textbox";
  return null;
}

export function isTextRole(role: string | null): boolean {
  return !!role && TEXT_ROLES.has(role);
}

/** Role a text-only element carries on its own node. */
export function textRoleOf(el: Element, role: string | null): string {
  if (role && TEXT_ROLES.has(role)) return role;
  return el.localName === "p" ? "paragraph" : "generic";
}

/** Role a retained container carries. */
export function containerRoleOf(el: Element, role: string | null): string {
  if (role && CONTAINER_ROLES.has(role)) return role;
  return el.localName === "p" ? "paragraph" : "generic";
}

export function headingLevelOf(el: Element): number {
  const m = /^h([1-6])$/.exec(el.localName);
  const aria = parseInt(el.getAttribute("aria-level") ?? "", 10);
  if (Number.isFinite(aria) && aria >= 1) return Math.min(6, aria);
  return m ? parseInt(m[1], 10) : 2;
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  try {
    return el.matches(":disabled");
  } catch {
    return el.hasAttribute("disabled");
  }
}

export function isNativelyDisabled(el: Element): boolean {
  try {
    return el.matches(":disabled");
  } catch {
    return el.hasAttribute("disabled");
  }
}

/** ARIA-style states in a fixed order: checked, pressed, expanded, selected, required, invalid, disabled. */
export function statesOf(el: Element, role: string | null): string[] {
  const out: string[] = [];
  const attr = (n: string) => el.getAttribute(n);
  const tag = el.localName;

  if (role && CHECKABLE_ROLES.has(role)) {
    const native = tag === "input" && ["checkbox", "radio"].includes((attr("type") ?? "").toLowerCase());
    if (native) {
      const input = el as HTMLInputElement;
      out.push(input.indeterminate && input.type === "checkbox" ? "half checked" : input.checked ? "checked" : "not checked");
    } else {
      const ac = attr("aria-checked");
      out.push(ac === "true" ? "checked" : ac === "mixed" ? "half checked" : "not checked");
    }
  }
  if (attr("aria-pressed") === "true") out.push("pressed");

  const expanded = attr("aria-expanded");
  if (expanded === "true") out.push("expanded");
  else if (expanded === "false") out.push("collapsed");
  else if (tag === "summary" && el.parentElement?.localName === "details") {
    out.push(el.parentElement.hasAttribute("open") ? "expanded" : "collapsed");
  }

  if (attr("aria-selected") === "true" || (tag === "option" && (el as HTMLOptionElement).selected)) out.push("selected");
  if (el.hasAttribute("required") || attr("aria-required") === "true") out.push("required");
  const invalid = attr("aria-invalid");
  if (invalid && invalid !== "false") out.push("invalid");
  if (isDisabled(el)) out.push("disabled");
  return out;
}
