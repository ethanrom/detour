// Per-page lookup tables for the navigation graphs. Built once per PageModel object (WeakMap),
// in O(nodes). States in the screen-reader graph are cursor positions shifted by one:
// state s = reading position s-1, so state 0 is "before the first stop".

import { wordCount } from "@/lib/a11y/announce";
import type { NodeId, PageModel } from "@/lib/contracts";

/** Announcements repeat across the page variants the fix optimiser evaluates; memoise their word counts. */
const WORD_CACHE_LIMIT = 50_000;
const wordCache = new Map<string, number>();
function cachedWordCount(text: string): number {
  let w = wordCache.get(text);
  if (w === undefined) {
    if (wordCache.size >= WORD_CACHE_LIMIT) wordCache.clear();
    w = wordCount(text);
    wordCache.set(text, w);
  }
  return w;
}

export class PageIndex {
  /** Number of browse-mode reading stops. */
  readonly N: number;
  /** Reading position of each stop. */
  readonly readPos = new Map<NodeId, number>();
  /** Focus index (position in focusOrder) of each focus stop. */
  readonly focusPos = new Map<NodeId, number>();
  /** Reading position of focusOrder[f], or -1 when that node is not a reading stop. */
  readonly focusReadPos: Int32Array;
  /** Focus index of the stop at each reading position, or -1. */
  readonly focusIdxOfRead: Int32Array;
  /** Size N+1, indexed by state s: first heading at reading position >= s, or -1. */
  readonly headingNext: Int32Array;
  /** Size N+1, indexed by state s: first landmark entry stop at position >= s, or -1. */
  readonly landmarkNext: Int32Array;
  /** Size N+1, indexed by state s: reading position that Tab lands on from state s, or -1. */
  readonly tabNext: Int32Array;
  /** Size N+1, indexed by state s: reading position that Shift+Tab lands on from state s, or -1. */
  readonly tabPrev: Int32Array;

  private wordsCache: Int32Array;
  private lowerCache: Array<string | undefined>;
  private docIdx: Map<NodeId, number> | null = null;
  private skipOut: Map<number, number[]> | null = null;
  private blocks = new Map<NodeId, NodeId | null>();

  constructor(readonly page: PageModel) {
    const ro = page.readingOrder;
    const N = ro.length;
    this.N = N;
    for (let i = 0; i < N; i++) if (!this.readPos.has(ro[i])) this.readPos.set(ro[i], i);
    this.wordsCache = new Int32Array(N).fill(-1);
    this.lowerCache = new Array<string | undefined>(N);

    const fo = page.focusOrder;
    const F = fo.length;
    this.focusReadPos = new Int32Array(F).fill(-1);
    this.focusIdxOfRead = new Int32Array(N).fill(-1);
    for (let f = 0; f < F; f++) {
      if (!this.focusPos.has(fo[f])) this.focusPos.set(fo[f], f);
      const r = this.readPos.get(fo[f]);
      if (r !== undefined) {
        this.focusReadPos[f] = r;
        if (this.focusIdxOfRead[r] === -1) this.focusIdxOfRead[r] = f;
      }
    }

    // First heading / landmark entry at position >= s (backward pass).
    const isHeading = new Uint8Array(N);
    for (const h of page.headings) {
      const r = this.readPos.get(h);
      if (r !== undefined) isHeading[r] = 1;
    }
    const isLandmarkStart = new Uint8Array(N);
    for (const l of page.landmarks) {
      const r = this.resolveStop(l);
      if (r >= 0) isLandmarkStart[r] = 1;
    }
    this.headingNext = new Int32Array(N + 1).fill(-1);
    this.landmarkNext = new Int32Array(N + 1).fill(-1);
    const nextFocusAtOrAfter = new Int32Array(N + 1).fill(-1);
    for (let s = N - 1; s >= 0; s--) {
      this.headingNext[s] = isHeading[s] ? s : this.headingNext[s + 1];
      this.landmarkNext[s] = isLandmarkStart[s] ? s : this.landmarkNext[s + 1];
      nextFocusAtOrAfter[s] = this.focusIdxOfRead[s] >= 0 ? s : nextFocusAtOrAfter[s + 1];
    }

    // Tab / Shift+Tab from each cursor state. A cursor on a focus stop follows focus order;
    // a cursor elsewhere continues from the next focus stop in reading order (and Shift+Tab from
    // the previous one).
    this.tabNext = new Int32Array(N + 1).fill(-1);
    this.tabPrev = new Int32Array(N + 1).fill(-1);
    let lastFocusBefore = -1; // last focus stop at reading position < p
    for (let s = 0; s <= N; s++) {
      const p = s - 1;
      const f = p >= 0 ? this.focusIdxOfRead[p] : -1;
      if (p < 0) {
        this.tabNext[s] = this.firstFocusReadPos(0, 1);
      } else if (f >= 0) {
        this.tabNext[s] = this.firstFocusReadPos(f + 1, 1);
        this.tabPrev[s] = this.firstFocusReadPos(f - 1, -1);
      } else {
        this.tabNext[s] = nextFocusAtOrAfter[s];
        this.tabPrev[s] = lastFocusBefore;
      }
      if (p >= 0 && f >= 0) lastFocusBefore = p;
    }
  }

  private firstFocusReadPos(from: number, step: 1 | -1): number {
    for (let f = from; f >= 0 && f < this.focusReadPos.length; f += step) {
      if (this.focusReadPos[f] >= 0) return this.focusReadPos[f];
    }
    return -1;
  }

  /** Words in the announcement of the stop at reading position j. */
  words(j: number): number {
    let w = this.wordsCache[j];
    if (w < 0) {
      w = cachedWordCount(this.page.nodes[this.page.readingOrder[j]].announcement);
      this.wordsCache[j] = w;
    }
    return w;
  }

  announcement(j: number): string {
    return this.page.nodes[this.page.readingOrder[j]].announcement;
  }

  /** Lower-cased announcement of the stop at reading position j (for find). */
  lower(j: number): string {
    let s = this.lowerCache[j];
    if (s === undefined) {
      s = this.announcement(j).toLowerCase();
      this.lowerCache[j] = s;
    }
    return s;
  }

  /** The reading position a screen-reader cursor lands on for `id`: its own stop, else the first stop inside it. -1 when none. */
  resolveStop(id: NodeId): number {
    const own = this.readPos.get(id);
    if (own !== undefined) return own;
    const root = this.page.nodes[id];
    if (!root) return -1;
    const stack: NodeId[] = [id];
    let best = -1;
    while (stack.length) {
      const cur = stack.pop()!;
      const r = this.readPos.get(cur);
      if (r !== undefined && (best === -1 || r < best)) best = r;
      const n = this.page.nodes[cur];
      if (n) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return best;
  }

  /** Document order index of every node (pre-order DFS from the root; orphans last). */
  docIndex(): Map<NodeId, number> {
    if (this.docIdx) return this.docIdx;
    const m = new Map<NodeId, number>();
    const { nodes, root } = this.page;
    const stack: NodeId[] = nodes[root] ? [root] : [];
    while (stack.length) {
      const cur = stack.pop()!;
      if (m.has(cur)) continue;
      m.set(cur, m.size);
      const n = nodes[cur];
      for (let i = n.children.length - 1; i >= 0; i--) if (nodes[n.children[i]]) stack.push(n.children[i]);
    }
    for (const id of Object.keys(nodes)) if (!m.has(id)) m.set(id, m.size);
    this.docIdx = m;
    return m;
  }

  /** Skip-link Enter edges in the focus graph: focus index of the link -> focus indices it can jump to. */
  skipEdges(): Map<number, number[]> {
    if (this.skipOut) return this.skipOut;
    const out = new Map<number, number[]>();
    if (this.page.skipLinks.length > 0 && this.page.focusOrder.length > 0) {
      const doc = this.docIndex();
      // Focus stops sorted by document order.
      const byDoc = this.page.focusOrder
        .map((id, f) => ({ f, d: doc.get(id) ?? Infinity }))
        .sort((a, b) => a.d - b.d || a.f - b.f);
      for (const sl of this.page.skipLinks) {
        const from = this.focusPos.get(sl.from);
        const d = doc.get(sl.to);
        if (from === undefined || d === undefined) continue;
        let lo = 0;
        let hi = byDoc.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (byDoc[mid].d < d) lo = mid + 1;
          else hi = mid;
        }
        if (lo >= byDoc.length) continue;
        const dest = byDoc[lo].f;
        const list = out.get(from);
        if (list) {
          if (!list.includes(dest)) list.push(dest);
        } else out.set(from, [dest]);
      }
    }
    this.skipOut = out;
    return out;
  }

  /** The nearest ancestor-or-self that is a landmark or flagged as a repetitive block, else null. */
  blockOf(id: NodeId): NodeId | null {
    const hit = this.blocks.get(id);
    if (hit !== undefined) return hit;
    let result: NodeId | null = null;
    let cur: NodeId | null = id;
    let guard = 0;
    while (cur !== null && guard++ < 10_000) {
      const n: PageModel["nodes"][string] | undefined = this.page.nodes[cur];
      if (!n) break;
      if (n.landmark || n.hints.repetitiveBlock) {
        result = cur;
        break;
      }
      cur = n.parentId;
    }
    this.blocks.set(id, result);
    return result;
  }
}

const cache = new WeakMap<PageModel, PageIndex>();

/** Cached index for a page object. A modified page (new object) gets a fresh index. */
export function getIndex(page: PageModel): PageIndex {
  let idx = cache.get(page);
  if (!idx) {
    idx = new PageIndex(page);
    cache.set(page, idx);
  }
  return idx;
}
