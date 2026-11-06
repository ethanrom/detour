// "Click to choose a target": map an element of the rendered page back to its PageModel node, build the task
// for a chosen node, and list the nodes a keyboard or screen-reader user can choose from instead of clicking.
// Deterministic: no LLM is involved.

import type { A11yNode, NodeId, PageModel, Task } from "@/lib/contracts";
import { attrSelector, cssPath } from "@/lib/extract/selector";

const ID_ATTR = "data-detour-id";

export interface PickIndex {
  page: PageModel;
  /** node.selector -> nodes that carry it. Several nodes share one when an element holds more than one text run. */
  bySelector: Map<string, A11yNode[]>;
  /** Reading stops: what a screen-reader user can land on. */
  stops: Set<NodeId>;
}

/** O(nodes), no DOM access: build once per page model. */
export function createPickIndex(page: PageModel): PickIndex {
  const bySelector = new Map<string, A11yNode[]>();
  for (const n of Object.values(page.nodes)) {
    const list = bySelector.get(n.selector);
    if (list) list.push(n);
    else bySelector.set(n.selector, [n]);
  }
  return { page, bySelector, stops: new Set(page.readingOrder) };
}

/** A node worth choosing as a task target. */
const pickable = (ix: PickIndex, n: A11yNode) => n.actionable || ix.stops.has(n.id);

function contains(n: A11yNode, p: { x: number; y: number }): boolean {
  const r = n.rect;
  return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

const area = (n: A11yNode) => (n.rect ? n.rect.w * n.rect.h : Infinity);

/** Among nodes of one element (text runs), the one under the pointer; otherwise the first. */
function choose(cands: A11yNode[], point?: { x: number; y: number }): A11yNode {
  const best = (list: A11yNode[]) => list.reduce((a, b) => (area(b) < area(a) ? b : a));
  const actionable = cands.filter((n) => n.actionable);
  const pool = actionable.length ? actionable : cands;
  if (point) {
    const hit = pool.filter((n) => contains(n, point));
    if (hit.length) return best(hit);
  }
  return pool[0];
}

/** Nodes whose recorded selector resolves to exactly `el` in `doc`. */
function nodesOfElement(ix: PickIndex, doc: Document, el: Element): A11yNode[] {
  const selectors: string[] = [];
  const id = el.getAttribute(ID_ATTR);
  if (id) selectors.push(attrSelector(ID_ATTR, id));
  if (doc.body) selectors.push(cssPath(el, doc.body));
  const out: A11yNode[] = [];
  for (const sel of selectors) {
    const list = ix.bySelector.get(sel);
    if (!list) continue;
    let resolves = false;
    try {
      resolves = doc.querySelector(sel) === el;
    } catch {
      resolves = false;
    }
    if (resolves) out.push(...list);
  }
  return out;
}

/**
 * The node a person means when they point at `el`. Walks up from the element to the nearest ancestor that is a
 * node (its `selector` finds that very element), preferring actionable nodes, then reading stops. A link
 * around a heading therefore wins over the heading, because pressing anywhere on it activates the link.
 * `point` (document coordinates) tells apart the text runs of one element, and is the fallback for the blank space
 * around elements. Returns null when nothing readable is there.
 */
export function nodeForElement(ix: PickIndex, doc: Document, el: Element | null, point?: { x: number; y: number }): A11yNode | null {
  let firstStop: A11yNode | null = null;
  for (let cur: Element | null = el; cur && cur !== doc.documentElement; cur = cur.parentElement) {
    const cands = nodesOfElement(ix, doc, cur).filter((n) => pickable(ix, n));
    if (cands.length === 0) continue;
    const hit = choose(cands, point);
    if (hit.actionable) return hit;
    firstStop ??= hit;
  }
  if (firstStop) return firstStop;
  if (!point) return null;
  // Blank space inside a container: the smallest reading stop under the pointer.
  let found: A11yNode | null = null;
  for (const id of ix.page.readingOrder) {
    const n = ix.page.nodes[id];
    if (n && contains(n, point) && (!found || area(n) < area(found))) found = n;
  }
  return found;
}

/** The element a node stands for in `doc` (null if its selector no longer matches). */
export function elementForNode(doc: Document, node: A11yNode): Element | null {
  try {
    return doc.querySelector(node.selector);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** What to call a node: its accessible name, else the best visual hint, else its role. */
export function nodeLabel(n: A11yNode, max = 80): string {
  const name = clean(n.name) || clean(n.hints.visualLabel ?? "");
  return clip(name || `unlabeled ${roleWord(n)}`, max);
}

/** "link", "button", "heading 2", "image", ... */
export function roleWord(n: A11yNode): string {
  if (n.role === "heading") return n.level ? `heading ${n.level}` : "heading";
  if (n.hints.looksLikeHeading && n.role !== "heading") return "heading-like text";
  if (n.role === "img") return "image";
  if (n.role === "text" || n.role === "generic" || n.role === "paragraph") return "text";
  return n.role;
}

/** The deterministic task for a chosen node: reach and press a control, or find and read content. */
export function taskForNode(page: PageModel, siteId: string, nodeId: NodeId): Task | null {
  const n = page.nodes[nodeId];
  if (!n) return null;
  const name = nodeLabel(n, 70);
  return {
    id: `pick-${n.id}`,
    siteId,
    label: n.actionable ? `Reach and activate “${name}”` : `Find and read “${name}”`,
    steps: [{ target: n.id, action: n.actionable ? "activate" : "read" }],
    grounding: "fixture",
  };
}

// ---------------------------------------------------------------------------------------------
// The keyboard-accessible list of targets
// ---------------------------------------------------------------------------------------------

export interface PickOption {
  id: NodeId;
  name: string;
  role: string;
  /** Lower-cased "name role", what a search matches against. */
  /** The landmark it sits in ("navigation", "main", ...), "" when none: tells apart same-named links. */
  where: string;
  haystack: string;
  actionable: boolean;
}

function landmarkOf(page: PageModel, n: A11yNode): string {
  for (let id = n.parentId, hops = 0; id && hops < 60; hops++) {
    const p = page.nodes[id];
    if (!p) break;
    if (p.landmark) return p.landmark;
    id = p.parentId;
  }
  return "";
}

/** Actionable elements and headings (including headings that are only styled as headings), in reading order. */
export function pickOptions(page: PageModel): PickOption[] {
  const out: PickOption[] = [];
  const seen = new Set<NodeId>();
  for (const id of page.readingOrder) {
    const n = page.nodes[id];
    if (!n || seen.has(id)) continue;
    if (!n.actionable && n.role !== "heading" && !n.hints.looksLikeHeading) continue;
    seen.add(id);
    const name = nodeLabel(n, 90);
    const role = roleWord(n);
    const where = landmarkOf(page, n);
    out.push({ id, name, role, where, haystack: `${name} ${role} ${where}`.toLowerCase(), actionable: n.actionable });
  }
  return out;
}

/** Options whose name or role contains every word typed, best (starts with the text, then a word start) first. */
export function filterOptions(options: PickOption[], query: string, limit = 50): { shown: PickOption[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { shown: options.slice(0, limit), total: options.length };
  const scored: Array<{ o: PickOption; score: number; i: number }> = [];
  options.forEach((o, i) => {
    if (!words.every((w) => o.haystack.includes(w))) return;
    const name = o.name.toLowerCase();
    const q = words.join(" ");
    const score = name.startsWith(q) ? 0 : name.includes(` ${words[0]}`) ? 1 : 2;
    scored.push({ o, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return { shown: scored.slice(0, limit).map((s) => s.o), total: scored.length };
}
