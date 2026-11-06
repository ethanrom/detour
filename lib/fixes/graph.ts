// Tree helpers and the single `recompute` routine that keeps a PageModel's derived arrays
// (readingOrder, focusOrder, headings, landmarks, skipLinks) and announcements consistent with
// the rules in fixtures/pagemodels/builder.ts. Document order = preorder traversal from `root`.

import { announce, type AnnounceContext } from "@/lib/a11y/announce";
import type { A11yNode, NodeId, PageModel, SkipLink } from "@/lib/contracts";

export interface Tree {
  /** Preorder traversal from root. Only reachable nodes appear. */
  order: NodeId[];
  /** Preorder index of each reachable node. */
  idx: Map<NodeId, number>;
  /** Preorder index of the last node in each node's subtree (inclusive). */
  end: Map<NodeId, number>;
}

export function buildTree(page: PageModel): Tree {
  const order: NodeId[] = [];
  const idx = new Map<NodeId, number>();
  const end = new Map<NodeId, number>();
  const frames: Array<{ id: NodeId; next: number }> = [];
  const enter = (id: NodeId) => {
    if (!page.nodes[id] || idx.has(id)) return;
    idx.set(id, order.length);
    order.push(id);
    frames.push({ id, next: 0 });
  };
  enter(page.root);
  while (frames.length > 0) {
    const f = frames[frames.length - 1];
    const kids = page.nodes[f.id].children;
    if (f.next < kids.length) {
      enter(kids[f.next++]);
    } else {
      end.set(f.id, order.length - 1);
      frames.pop();
    }
  }
  return { order, idx, end };
}

/** True when `a` is `b` or an ancestor of `b`. */
export function contains(tree: Tree, a: NodeId, b: NodeId): boolean {
  const ai = tree.idx.get(a);
  const bi = tree.idx.get(b);
  const ae = tree.end.get(a);
  return ai !== undefined && bi !== undefined && ae !== undefined && ai <= bi && bi <= ae;
}

/** Ancestors-or-self of `id`, outermost first. Guards against parent cycles. */
export function ancestorChain(page: PageModel, id: NodeId): A11yNode[] {
  const chain: A11yNode[] = [];
  const seen = new Set<NodeId>();
  let cur: NodeId | null = id;
  while (cur && !seen.has(cur) && page.nodes[cur]) {
    seen.add(cur);
    chain.push(page.nodes[cur]);
    cur = page.nodes[cur].parentId;
  }
  return chain.reverse();
}

/** First reading stop whose preorder index is >= that of `id` (the builder's skip-link target rule). */
export function firstStopAtOrAfter(page: PageModel, tree: Tree, id: NodeId): NodeId | undefined {
  const start = tree.idx.get(id);
  if (start === undefined) return undefined;
  let best: NodeId | undefined;
  let bestIdx = Infinity;
  for (const r of page.readingOrder) {
    const i = tree.idx.get(r);
    if (i !== undefined && i >= start && i < bestIdx) {
      best = r;
      bestIdx = i;
    }
  }
  return best;
}

/** First reading stop inside the subtree of `id` (inclusive). */
export function firstStopIn(page: PageModel, tree: Tree, id: NodeId): NodeId | undefined {
  const stop = firstStopAtOrAfter(page, tree, id);
  const e = tree.end.get(id);
  if (stop === undefined || e === undefined) return undefined;
  return (tree.idx.get(stop) as number) <= e ? stop : undefined;
}

/** Reading stops inside the subtree of `id` (inclusive), in reading order. */
export function stopsIn(page: PageModel, tree: Tree, id: NodeId): NodeId[] {
  const s = tree.idx.get(id);
  const e = tree.end.get(id);
  if (s === undefined || e === undefined) return [];
  return page.readingOrder.filter((r) => {
    const i = tree.idx.get(r);
    return i !== undefined && i >= s && i <= e;
  });
}

/** Text of a node: its own name, else the names of its descendant leaves joined by spaces. */
export function textOf(page: PageModel, tree: Tree, id: NodeId): string {
  const n = page.nodes[id];
  if (!n) return "";
  const own = n.name.trim();
  if (own) return own.replace(/\s+/g, " ");
  const s = tree.idx.get(id);
  const e = tree.end.get(id);
  if (s === undefined || e === undefined) return "";
  const parts: string[] = [];
  for (let i = s + 1; i <= e; i++) {
    const d = page.nodes[tree.order[i]];
    if (d.children.length === 0 && d.name.trim()) parts.push(d.name.trim());
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

/** Containers (landmarks and lists) the screen reader announces on arriving at `id`:
 *  ancestors-or-self whose subtree begins after the previous reading stop. Mirrors the builder. */
export function enterContext(page: PageModel, tree: Tree, id: NodeId): NonNullable<AnnounceContext["enter"]> {
  const me = tree.idx.get(id);
  if (me === undefined) return [];
  let prev = -1;
  for (const r of page.readingOrder) {
    const i = tree.idx.get(r);
    if (i !== undefined && i < me && i > prev) prev = i;
  }
  const enter: NonNullable<AnnounceContext["enter"]> = [];
  for (const a of ancestorChain(page, id)) {
    const ai = tree.idx.get(a.id);
    if (ai === undefined || ai <= prev) continue;
    if (a.landmark) enter.push({ kind: "landmark", role: a.landmark });
    if (a.role === "list") enter.push({ kind: "list", items: a.children.length });
  }
  return enter;
}

export function announceNode(page: PageModel, tree: Tree, id: NodeId): string {
  return announce(page.nodes[id], { enter: enterContext(page, tree, id) });
}

type FocusKey = [number, number];

/** Sort key for sequential focus: positive tabindex ascending first, then document order. */
function focusKey(page: PageModel, tree: Tree, id: NodeId): FocusKey {
  const t = page.nodes[id]?.tabIndex ?? 0;
  return [t > 0 ? t : Number.POSITIVE_INFINITY, tree.idx.get(id) ?? Number.POSITIVE_INFINITY];
}

function keyLess(a: FocusKey, b: FocusKey): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

export interface RecomputeOptions {
  /** Nodes that must be reading stops (inserted at their document position) and are re-announced. */
  addStops?: NodeId[];
  /** Nodes to add to focusOrder at their canonical position (ignored unless focusable and tabIndex >= 0). */
  addFocus?: NodeId[];
  /** Re-sort the whole focusOrder canonically (use after tabIndex changes). */
  resortFocus?: boolean;
  /** Skip links to add (deduplicated by `from`). */
  addSkipLinks?: SkipLink[];
  /** Reading stops whose announcement is rebuilt from the tree. */
  reannounce?: NodeId[];
}

/** Rebuild the derived arrays of a draft page in place. Membership of readingOrder and focusOrder is
 *  kept (minus dangling ids) plus the explicit additions; headings and landmarks are re-derived in
 *  document order; announcements of the affected stops are rebuilt with lib/a11y/announce. */
export function recompute(page: PageModel, opts: RecomputeOptions = {}): void {
  const tree = buildTree(page);
  const known = (id: NodeId) => tree.idx.has(id);
  const idxOf = (id: NodeId) => tree.idx.get(id) as number;

  // readingOrder: keep order and membership, then insert new stops at their document position.
  const reading: NodeId[] = [];
  const readingSet = new Set<NodeId>();
  for (const id of page.readingOrder) {
    if (known(id) && !readingSet.has(id)) {
      reading.push(id);
      readingSet.add(id);
    }
  }
  const newStops = [...new Set(opts.addStops ?? [])].filter((id) => known(id) && !readingSet.has(id)).sort((a, b) => idxOf(a) - idxOf(b));
  for (const id of newStops) {
    let at = reading.findIndex((r) => idxOf(r) > idxOf(id));
    if (at < 0) at = reading.length;
    reading.splice(at, 0, id);
    readingSet.add(id);
  }
  page.readingOrder = reading;

  // focusOrder
  let focus: NodeId[] = [];
  const focusSet = new Set<NodeId>();
  for (const id of page.focusOrder) {
    if (known(id) && !focusSet.has(id)) {
      focus.push(id);
      focusSet.add(id);
    }
  }
  if (opts.resortFocus) {
    const keyed = focus.map((id, i) => ({ id, i, k: focusKey(page, tree, id) }));
    keyed.sort((a, b) => (keyLess(a.k, b.k) ? -1 : keyLess(b.k, a.k) ? 1 : a.i - b.i));
    focus = keyed.map((x) => x.id);
  }
  const newFocus = [...new Set(opts.addFocus ?? [])]
    .filter((id) => known(id) && !focusSet.has(id) && page.nodes[id].focusable && (page.nodes[id].tabIndex ?? 0) >= 0)
    .sort((a, b) => idxOf(a) - idxOf(b));
  for (const id of newFocus) {
    const k = focusKey(page, tree, id);
    let at = focus.findIndex((f) => keyLess(k, focusKey(page, tree, f)));
    if (at < 0) at = focus.length;
    focus.splice(at, 0, id);
    focusSet.add(id);
  }
  page.focusOrder = focus;

  // headings and landmarks: document order, derived from the nodes themselves.
  page.headings = tree.order.filter((id) => page.nodes[id].role === "heading" && readingSet.has(id));
  page.landmarks = tree.order.filter((id) => page.nodes[id].landmark !== undefined);

  // skipLinks
  const skip: SkipLink[] = [];
  const seenFrom = new Set<NodeId>();
  for (const s of [...page.skipLinks, ...(opts.addSkipLinks ?? [])]) {
    if (known(s.from) && known(s.to) && !seenFrom.has(s.from)) {
      skip.push({ from: s.from, to: s.to });
      seenFrom.add(s.from);
    }
  }
  page.skipLinks = skip;

  // announcements of the affected stops
  for (const id of new Set([...newStops, ...(opts.reannounce ?? [])])) {
    if (readingSet.has(id)) page.nodes[id].announcement = announceNode(page, tree, id);
  }
}
