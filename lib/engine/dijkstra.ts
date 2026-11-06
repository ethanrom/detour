// Dijkstra on an implicit graph, with a binary heap on typed arrays. The graph is given as an
// edge-enumeration callback so the screen-reader and keyboard navigation graphs are never
// materialised as adjacency lists. Ties are broken by node index, so results are deterministic.

/** Called by an edge enumerator once per outgoing edge: target state, non-negative weight, edge tag. */
export type Relax = (to: number, weight: number, tag: number) => void;

export type EdgeFn = (from: number, relax: Relax) => void;

export interface ShortestPaths {
  /** Distance from the source, Infinity when unreached. */
  dist: Float64Array;
  /** Predecessor state on a shortest path, -1 for the source / unreached. */
  prev: Int32Array;
  /** Tag of the edge used to enter each state. */
  via: Int32Array;
  /** The goal state that was settled first, or -1 (also -1 when no goal predicate was given). */
  goal: number;
}

class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 64) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  private less(i: number, j: number): boolean {
    const ki = this.keys[i];
    const kj = this.keys[j];
    return ki < kj || (ki === kj && this.vals[i] < this.vals[j]);
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i];
    this.keys[i] = this.keys[j];
    this.keys[j] = k;
    const v = this.vals[i];
    this.vals[i] = this.vals[j];
    this.vals[j] = v;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
      const nv = new Int32Array(this.size * 2);
      nv.set(this.vals);
      this.vals = nv;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  peekKey(): number {
    return this.keys[0];
  }

  peekVal(): number {
    return this.vals[0];
  }

  pop(): void {
    const last = --this.size;
    if (last > 0) {
      this.keys[0] = this.keys[last];
      this.vals[0] = this.vals[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
  }
}

/**
 * Single-source shortest paths over states 0..n-1. Stops as soon as `isGoal` accepts a settled
 * state (its distance is then final); without `isGoal` it settles every reachable state.
 * Edge weights must be non-negative.
 */
export function dijkstra(n: number, source: number, edges: EdgeFn, isGoal?: (state: number) => boolean): ShortestPaths {
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap(Math.min(Math.max(16, n), 4096));
  let cu = 0;
  let cd = 0;
  const relax: Relax = (to, weight, tag) => {
    const nd = cd + weight;
    if (nd < dist[to]) {
      dist[to] = nd;
      prev[to] = cu;
      via[to] = tag;
      heap.push(nd, to);
    }
  };
  dist[source] = 0;
  heap.push(0, source);
  let goal = -1;
  while (heap.size > 0) {
    const d = heap.peekKey();
    const u = heap.peekVal();
    heap.pop();
    if (done[u] === 1 || d > dist[u]) continue;
    done[u] = 1;
    if (isGoal && isGoal(u)) {
      goal = u;
      break;
    }
    cu = u;
    cd = d;
    edges(u, relax);
  }
  return { dist, prev, via, goal };
}

export interface PathEdge {
  from: number;
  to: number;
  tag: number;
}

/**
 * The unique path along a line graph (states differ by one per edge). Used instead of a search
 * where the graph is a plain chain; equals what `dijkstra` + `pathEdges` return on such a graph.
 */
export function chainEdges(from: number, to: number, forwardTag: number, backwardTag: number): PathEdge[] {
  const out: PathEdge[] = [];
  if (to >= from) for (let s = from; s < to; s++) out.push({ from: s, to: s + 1, tag: forwardTag });
  else for (let s = from; s > to; s--) out.push({ from: s, to: s - 1, tag: backwardTag });
  return out;
}

/** The edges of the shortest path from the source to `target`, in travel order ([] for the source itself). */
export function pathEdges(sp: ShortestPaths, target: number): PathEdge[] {
  const out: PathEdge[] = [];
  let v = target;
  while (sp.prev[v] !== -1) {
    out.push({ from: sp.prev[v], to: v, tag: sp.via[v] });
    v = sp.prev[v];
  }
  return out.reverse();
}
