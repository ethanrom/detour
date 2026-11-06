// HTML sequential focus navigation: which elements are Tab stops, and in what order.

import { isNativelyDisabled } from "./roles";

/** Value of the tabindex attribute when it parses as an integer, else null. */
export function tabIndexAttr(el: Element): number | null {
  const v = el.getAttribute("tabindex");
  if (v === null) return null;
  const t = v.trim();
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
}

/** Natively focusable per the HTML spec (ignoring tabindex and disabled state). */
function nativelyFocusable(el: Element): boolean {
  const tag = el.localName;
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href");
    case "button":
    case "select":
    case "textarea":
      return true;
    case "input":
      return (el.getAttribute("type") ?? "").toLowerCase() !== "hidden";
    case "summary":
      return el.parentElement?.localName === "details" && Array.from(el.parentElement.children).find((c) => c.localName === "summary") === el;
    case "iframe":
      return true;
    case "audio":
    case "video":
      return el.hasAttribute("controls");
  }
  const ce = el.getAttribute("contenteditable");
  return ce !== null && ce.toLowerCase() !== "false";
}

/** True when Tab can reach `el`: native or tabindex >= 0, never disabled, never tabindex < 0. */
export function isTabStop(el: Element): boolean {
  if (isNativelyDisabled(el)) return false;
  const ti = tabIndexAttr(el);
  if (ti !== null) return ti >= 0;
  return nativelyFocusable(el);
}

/** Positive tabindex ascending (DOM order breaks ties), then everything else in DOM order. */
export function orderFocus<T extends { id: string; tabIndex: number | null }>(stops: T[]): string[] {
  const positive = stops
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.tabIndex ?? 0) > 0)
    .sort((a, b) => a.s.tabIndex! - b.s.tabIndex! || a.i - b.i)
    .map(({ s }) => s.id);
  const rest = stops.filter((s) => (s.tabIndex ?? 0) <= 0).map((s) => s.id);
  return [...positive, ...rest];
}
