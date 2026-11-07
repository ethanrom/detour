// DOM side of the live fix: stamp stable ids, collect what an agent needs to see, apply its edits to the live
// copy of the page, undo them, and check that nothing else moved. Works on any Document (the preview iframe,
// jsdom). No instanceof: nodes may come from another realm.

import type { A11yNode, NodeId, PageModel, Rect } from "@/lib/contracts";
import { attrSelector } from "@/lib/extract/selector";
import { elementForNode } from "@/lib/ui/pick";
import { isAllowedAttribute, isSafeAttributeName, isSanitizeError, sanitizeCss, sanitizeFragment } from "./sanitize";
import {
  ID_ATTR,
  MAX_EDIT_HTML,
  MAX_EDITS_PER_FIX,
  MAX_OUTER_HTML,
  MAX_PARENT_HTML,
  type EditOp,
  type FixEdits,
  type FixTargetContext,
  type InsertPosition,
  type LayoutMove,
  type LayoutReport,
} from "./types";

export const PIN_ATTR = "data-detour-pin";
export const FIX_ATTR = "data-detour-fix";

/** Generated text-run ids ("n12t0", "n12t0-2"): they share their element with the parent node. */
const TEXT_RUN_ID = /t\d+(-\d+)?$/;
const MAX_RECORDED_HTML = 8000;

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`);
const stripPins = (html: string) => html.replace(/ data-detour-pin="[^"]*"/g, "");

// ---------------------------------------------------------------------------------------------------------
// Stable ids

/**
 * Give every element that stands for a node its node id as data-detour-id, when it has none. On a proxied
 * page the ids are generated from document order, so one inserted element (a skip link) would renumber
 * everything on the next extraction; once stamped, ids survive. Returns how many elements were stamped.
 */
export function stampIds(doc: Document, page: PageModel): number {
  let stamped = 0;
  for (const node of Object.values(page.nodes)) {
    if (TEXT_RUN_ID.test(node.id)) continue;
    const el = elementForNode(doc, node);
    if (!el || el.hasAttribute(ID_ATTR)) continue;
    el.setAttribute(ID_ATTR, node.id);
    stamped++;
  }
  return stamped;
}

/** Selector of a node's element once ids are stamped. */
export function selectorFor(node: Pick<A11yNode, "id">): string {
  return attrSelector(ID_ATTR, node.id);
}

function resolve(doc: Document, node: A11yNode): Element | null {
  try {
    const byId = doc.querySelector(selectorFor(node));
    if (byId) return byId;
  } catch {
    /* fall through to the recorded selector */
  }
  return elementForNode(doc, node);
}

// ---------------------------------------------------------------------------------------------------------
// Context for the agent

const STYLE_KEYS = ["display", "fontSize", "fontWeight", "color", "background", "border", "padding", "margin", "cursor"] as const;

function styleOf(doc: Document, el: Element): CSSStyleDeclaration | undefined {
  try {
    return doc.defaultView?.getComputedStyle(el);
  } catch {
    return undefined;
  }
}

function computed(doc: Document, el: Element): FixTargetContext["style"] {
  const out = Object.fromEntries(STYLE_KEYS.map((k) => [k, ""])) as FixTargetContext["style"];
  const cs = styleOf(doc, el);
  if (!cs) return out;
  const sides = (prop: string, parts: string[]) => {
    const whole = cs.getPropertyValue(prop).trim();
    if (whole) return whole;
    const vals = parts.map((p) => cs.getPropertyValue(p).trim());
    return vals.some(Boolean) ? vals.join(" ").trim() : "";
  };
  out.display = cs.display || "";
  out.fontSize = cs.fontSize || "";
  out.fontWeight = cs.fontWeight || "";
  out.color = cs.color || "";
  out.background = cs.backgroundColor || cs.getPropertyValue("background").trim();
  out.border = sides("border", ["border-top-width", "border-top-style", "border-top-color"]);
  out.padding = sides("padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]);
  out.margin = sides("margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]);
  out.cursor = cs.cursor || "";
  return out;
}

function serialize(n: Node): string {
  if (n.nodeType === 1) return (n as Element).outerHTML;
  if (n.nodeType === 8) return `<!--${(n as Comment).data}-->`;
  return (n.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** The parent's markup with the target replaced by a marker: its neighbours, so an agent sees the pattern. */
function parentContext(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return "";
  const shell = (parent.cloneNode(false) as Element).outerHTML;
  const open = shell.slice(0, shell.lastIndexOf("</"));
  const kids = Array.from(parent.childNodes);
  const at = kids.indexOf(el);
  const from = Math.max(0, at - 4);
  const to = Math.min(kids.length, at + 5);
  const parts = kids.slice(from, to).map((k) => (k === el ? "<!-- target -->" : clip(serialize(k), 200)));
  const html = `${open}${from > 0 ? "…" : ""}${parts.join("")}${to < kids.length ? "…" : ""}</${parent.localName}>`;
  return clip(html, MAX_PARENT_HTML);
}

/** Announcements of the reading stops just before and after the node (two each side, at most four in all). */
function nearby(page: PageModel, nodeId: NodeId): string[] {
  const order = page.readingOrder;
  const inside = new Set<NodeId>([nodeId]);
  const walk = (id: NodeId) => {
    for (const c of page.nodes[id]?.children ?? []) {
      inside.add(c);
      walk(c);
    }
  };
  walk(nodeId);
  let lo = -1;
  let hi = -1;
  order.forEach((id, i) => {
    if (!inside.has(id)) return;
    if (lo < 0) lo = i;
    hi = i;
  });
  if (lo < 0) return [];
  const say = (i: number) => clip((page.nodes[order[i]]?.announcement ?? "").replace(/\s+/g, " ").trim(), 120);
  const picks = [lo - 2, lo - 1, hi + 1, hi + 2].filter((i) => i >= 0 && i < order.length);
  return picks.map(say).filter(Boolean).slice(0, 4);
}

/** What an agent may see about one target. Call after stampIds, before pinLayout (pins would show in the markup). */
export function collectContext(doc: Document, page: PageModel, nodeId: NodeId): FixTargetContext {
  const node = page.nodes[nodeId];
  if (!node) throw new Error(`No node ${nodeId} on the page.`);
  const el = resolve(doc, node);
  if (!el) throw new Error(`Couldn't find “${nodeId}” on the live page.`);
  return {
    nodeId,
    selector: el.hasAttribute(ID_ATTR) ? attrSelector(ID_ATTR, el.getAttribute(ID_ATTR) ?? nodeId) : node.selector,
    outerHTML: clip(el.outerHTML, MAX_OUTER_HTML),
    parentHTML: parentContext(el),
    nearbyText: nearby(page, nodeId),
    style: computed(doc, el),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Layout pins

export interface Pins {
  /** Pin value -> box in document coordinates. */
  rects: Record<string, Rect>;
  docHeight: number;
}

function boxOf(doc: Document, el: Element): Rect {
  const r = el.getBoundingClientRect();
  const win = doc.defaultView;
  return { x: r.left + (win?.scrollX ?? 0), y: r.top + (win?.scrollY ?? 0), w: r.width, h: r.height };
}

/** Tag every element in the body and record where it sits, so the same element can be found after the edits. */
export function pinLayout(doc: Document): Pins {
  const rects: Record<string, Rect> = {};
  let i = 0;
  for (const el of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
    const pin = String(i++);
    el.setAttribute(PIN_ATTR, pin);
    rects[pin] = boxOf(doc, el);
  }
  return { rects, docHeight: doc.documentElement?.scrollHeight ?? 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compare every pinned element's box with where it was. Elements inside the edited subtrees, new elements and
 * elements with no size before and after are left out. A box "moved" when it shifted by more than 1 px.
 * Without layout (jsdom) nothing has a size, so nothing is checked.
 */
export function measureLayout(doc: Document, pins: Pins, editedSelectors: string[]): LayoutReport {
  const edited: Element[] = [];
  for (const sel of editedSelectors) {
    try {
      edited.push(...Array.from(doc.querySelectorAll(sel)));
    } catch {
      /* a selector that no longer parses edits nothing */
    }
  }
  const inEdited = (el: Element) => edited.some((e) => e === el || e.contains(el));
  const moved: LayoutMove[] = [];
  let checked = 0;
  for (const el of Array.from(doc.body?.querySelectorAll(`[${PIN_ATTR}]`) ?? [])) {
    const before = pins.rects[el.getAttribute(PIN_ATTR) ?? ""];
    if (!before || inEdited(el)) continue;
    const after = boxOf(doc, el);
    if (before.w * before.h === 0 && after.w * after.h === 0) continue;
    checked++;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const id = el.getAttribute(ID_ATTR);
      moved.push({ selector: id ? attrSelector(ID_ATTR, id) : `${el.localName}[${PIN_ATTR}="${el.getAttribute(PIN_ATTR)}"]`, dx: round2(dx), dy: round2(dy) });
    }
  }
  return { checked, moved, docHeightBefore: pins.docHeight, docHeightAfter: doc.documentElement?.scrollHeight ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------
// Applying edits

export interface ApplyResult {
  /** outerHTML before, per edited selector (first edit wins). For an insert: the target's opening tag and a gap. */
  originals: Record<string, string>;
  /** outerHTML after, per edited selector (last edit wins). */
  applied: Record<string, string>;
  /** Why an op (or part of one) was skipped. */
  errors: string[];
  /** Selectors whose subtree was changed; layout inside them is not compared. Inserts add nothing here. */
  edited: string[];
  /** Ops that changed the page. 0 means the fix did nothing. */
  ok: number;
}

type Undo = () => void;
const journals = new WeakMap<Document, Map<string, Undo[]>>();

function journalFor(doc: Document, fixId: string): Undo[] {
  let byFix = journals.get(doc);
  if (!byFix) journals.set(doc, (byFix = new Map()));
  let list = byFix.get(fixId);
  if (!list) byFix.set(fixId, (list = []));
  return list;
}

function styleElements(doc: Document, fixId: string): Element[] {
  return Array.from(doc.querySelectorAll(`style[${FIX_ATTR}]`)).filter((s) => s.getAttribute(FIX_ATTR) === fixId);
}

/** Keep ids unique: drop an id from the new markup when another element outside `replacing` already has it. */
function dedupeIds(doc: Document, frag: DocumentFragment, replacing?: Element): void {
  for (const el of Array.from(frag.querySelectorAll(`[${ID_ATTR}]`))) {
    const id = el.getAttribute(ID_ATTR) ?? "";
    let clash: Element | null = null;
    try {
      clash = doc.querySelector(attrSelector(ID_ATTR, id));
    } catch {
      clash = null;
    }
    if (clash && !(replacing && replacing.contains(clash))) el.removeAttribute(ID_ATTR);
  }
}

function html(nodes: Node[]): string {
  return stripPins(nodes.map(serialize).join(""));
}

function wholeHtml(el: Element): string {
  return clip(stripPins(el.outerHTML), MAX_RECORDED_HTML);
}

function openTag(el: Element): string {
  const shell = (el.cloneNode(false) as Element).outerHTML;
  return shell.slice(0, shell.lastIndexOf("</"));
}

const POSITIONS: InsertPosition[] = ["beforebegin", "afterbegin", "beforeend", "afterend"];

/** Apply one fix's edits to the live copy. Every op is validated; one that cannot be applied is skipped with a reason. */
export function applyEdits(doc: Document, fix: FixEdits): ApplyResult {
  const result: ApplyResult = { originals: {}, applied: {}, errors: [], edited: [], ok: 0 };
  const journal = journalFor(doc, fix.fixId);
  const record = (selector: string, before: string, after: string, subtree: boolean) => {
    result.originals[selector] ??= before;
    result.applied[selector] = after;
    if (subtree && !result.edited.includes(selector)) result.edited.push(selector);
    result.ok++;
  };
  const fail = (op: EditOp, why: string) => result.errors.push(`${op.op} ${op.selector}: ${why}`);

  const ops = fix.edits.slice(0, MAX_EDITS_PER_FIX);
  if (fix.edits.length > ops.length) result.errors.push(`Only the first ${MAX_EDITS_PER_FIX} edits are applied (got ${fix.edits.length}).`);

  for (const op of ops) {
    let found: Element[];
    try {
      found = typeof op.selector === "string" && op.selector.length <= 500 ? Array.from(doc.querySelectorAll(op.selector)) : [];
    } catch {
      fail(op, "not a valid selector.");
      continue;
    }
    if (found.length !== 1) {
      fail(op, found.length === 0 ? "matches no element." : `matches ${found.length} elements, not one.`);
      continue;
    }
    const el = found[0];
    const tag = el.localName;
    // Taken before the op changes anything. An insert inside an element records a summary instead (the body
    // would be the whole page).
    const inside = op.op === "insert" && (op.position === "afterbegin" || op.position === "beforeend");
    const before = inside ? "" : wholeHtml(el);

    switch (op.op) {
      case "replace": {
        if (tag === "html" || tag === "body" || tag === "head") {
          fail(op, `can't replace <${tag}>.`);
          break;
        }
        const frag = sanitizeFragment(doc, op.html);
        if (isSanitizeError(frag)) {
          fail(op, frag.error);
          break;
        }
        const root = Array.from(frag.children)[0];
        if (!root) {
          fail(op, "the new HTML has no element.");
          break;
        }
        dedupeIds(doc, frag, el);
        const oldId = el.getAttribute(ID_ATTR);
        if (oldId) root.setAttribute(ID_ATTR, oldId);
        const created = Array.from(frag.childNodes);
        el.replaceWith(frag);
        journal.push(() => {
          created[0]?.parentNode?.insertBefore(el, created[0]);
          for (const n of created) n.parentNode?.removeChild(n);
        });
        record(op.selector, before, html(created), true);
        break;
      }
      case "wrapChildren": {
        if (op.tag !== "button" && op.tag !== "span") {
          fail(op, `can't create <${String(op.tag)}>.`);
          break;
        }
        const wrapper = doc.createElement(op.tag);
        for (const [name, value] of Object.entries(op.attributes ?? {})) {
          if (!isSafeAttributeName(name) || !isAllowedAttribute(name, String(value))) {
            result.errors.push(`wrapChildren ${op.selector}: attribute ${name} is not allowed.`);
            continue;
          }
          wrapper.setAttribute(name.toLowerCase(), String(value));
        }
        // A button with no type submits the form it sits in.
        if (op.tag === "button" && !wrapper.hasAttribute("type")) wrapper.setAttribute("type", "button");
        const moved = Array.from(el.childNodes);
        for (const child of moved) wrapper.appendChild(child);
        el.appendChild(wrapper);
        journal.push(() => {
          for (const child of Array.from(wrapper.childNodes)) el.insertBefore(child, wrapper);
          wrapper.remove();
        });
        record(op.selector, before, wholeHtml(el), true);
        break;
      }
      case "setAttributes": {
        const undo: Array<[string, string | null]> = [];
        let changed = 0;
        for (const [name, value] of Object.entries(op.attributes ?? {})) {
          const n = name.toLowerCase();
          if (!isSafeAttributeName(n) || !isAllowedAttribute(n, String(value))) {
            result.errors.push(`setAttributes ${op.selector}: attribute ${name} is not allowed.`);
            continue;
          }
          if (n === ID_ATTR && el.hasAttribute(ID_ATTR)) {
            result.errors.push(`setAttributes ${op.selector}: ${ID_ATTR} is already set.`);
            continue;
          }
          undo.push([n, el.getAttribute(n)]);
          el.setAttribute(n, String(value));
          changed++;
        }
        if (changed === 0) {
          fail(op, "no allowed attribute to set.");
          break;
        }
        journal.push(() => {
          for (const [n, old] of undo.reverse()) {
            if (old === null) el.removeAttribute(n);
            else el.setAttribute(n, old);
          }
        });
        record(op.selector, before, wholeHtml(el), true);
        break;
      }
      case "removeAttributes": {
        const undo: Array<[string, string]> = [];
        for (const name of op.names ?? []) {
          const n = String(name).toLowerCase();
          if (n === ID_ATTR || !isAllowedAttribute(n)) {
            result.errors.push(`removeAttributes ${op.selector}: attribute ${name} may not be removed.`);
            continue;
          }
          const old = el.getAttribute(n);
          if (old === null) continue;
          undo.push([n, old]);
          el.removeAttribute(n);
        }
        if (undo.length === 0) {
          fail(op, "nothing to remove.");
          break;
        }
        journal.push(() => {
          for (const [n, old] of undo) el.setAttribute(n, old);
        });
        record(op.selector, before, wholeHtml(el), true);
        break;
      }
      case "insert": {
        if (!POSITIONS.includes(op.position)) {
          fail(op, `unknown position ${String(op.position)}.`);
          break;
        }
        if ((tag === "html" || tag === "body") && (op.position === "beforebegin" || op.position === "afterend")) {
          fail(op, `can't insert outside <${tag}>.`);
          break;
        }
        if (tag === "html" && op.position !== "beforeend") {
          fail(op, "insert into <html> is not supported.");
          break;
        }
        const frag = sanitizeFragment(doc, op.html);
        if (isSanitizeError(frag)) {
          fail(op, frag.error);
          break;
        }
        dedupeIds(doc, frag);
        const created = Array.from(frag.childNodes);
        const parent = el.parentNode;
        if (op.position === "beforebegin") parent?.insertBefore(frag, el);
        else if (op.position === "afterbegin") el.insertBefore(frag, el.firstChild);
        else if (op.position === "beforeend") el.appendChild(frag);
        else parent?.insertBefore(frag, el.nextSibling);
        journal.push(() => {
          for (const n of created) n.parentNode?.removeChild(n);
        });
        const added = html(created);
        const gap = "…";
        const open = stripPins(openTag(el));
        const shown = inside ? `${open}\n  ${gap}\n</${tag}>` : clip(before, 400);
        const after = inside
          ? op.position === "afterbegin"
            ? `${open}\n  ${added}\n  ${gap}\n</${tag}>`
            : `${open}\n  ${gap}\n  ${added}\n</${tag}>`
          : op.position === "beforebegin"
            ? `${added}\n${clip(before, 400)}`
            : `${clip(before, 400)}\n${added}`;
        record(op.selector, shown, after, false);
        break;
      }
      case "setText": {
        const text = String(op.text ?? "");
        if (text.length > MAX_EDIT_HTML) {
          fail(op, "the text is too long.");
          break;
        }
        const old = Array.from(el.childNodes);
        el.textContent = text;
        journal.push(() => el.replaceChildren(...old));
        record(op.selector, before, wholeHtml(el), true);
        break;
      }
      default:
        result.errors.push(`Unknown edit ${(op as { op?: string }).op ?? "?"}.`);
    }
  }

  // Remove an older copy of this fix's style (a retry), then add the new one when something was applied.
  for (const s of styleElements(doc, fix.fixId)) s.remove();
  if (fix.css && result.ok > 0) {
    const css = sanitizeCss(fix.css);
    if (isSanitizeError(css)) {
      result.errors.push(`css: ${css.error}`);
    } else {
      const style = doc.createElement("style");
      style.setAttribute(FIX_ATTR, fix.fixId);
      style.textContent = css.css;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
  }
  return result;
}

/**
 * Undo one fix before a retry. Edits made through applyEdits are undone exactly (the site's own listeners stay
 * attached); for anything the journal doesn't know, the recorded original outerHTML is put back instead.
 */
export function restore(doc: Document, originals: Record<string, string>, fixId: string): void {
  const journal = journals.get(doc)?.get(fixId);
  if (journal && journal.length > 0) {
    for (const undo of journal.reverse()) {
      try {
        undo();
      } catch {
        /* the node is gone; nothing to undo */
      }
    }
    journals.get(doc)?.delete(fixId);
  } else {
    for (const [selector, original] of Object.entries(originals)) {
      if (original.endsWith("…")) continue; // abbreviated for display: not a faithful copy
      let target: Element | null = null;
      try {
        target = doc.querySelector(selector);
      } catch {
        target = null;
      }
      const frag = target ? sanitizeFragment(doc, original) : null;
      if (target && frag && !isSanitizeError(frag)) target.replaceWith(frag);
    }
  }
  for (const s of styleElements(doc, fixId)) s.remove();
}
