import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chainEdges, dijkstra, pathEdges, type EdgeFn } from "./dijkstra";

interface Edge {
  u: number;
  v: number;
  w: number;
}

function adjacency(n: number, edges: Edge[]): EdgeFn {
  const adj: Edge[][] = Array.from({ length: n }, () => []);
  for (const e of edges) adj[e.u].push(e);
  return (u, relax) => {
    for (const e of adj[u]) relax(e.v, e.w, 0);
  };
}

/** Brute-force reference: Bellman-Ford. */
function bellmanFord(n: number, edges: Edge[], source: number): number[] {
  const dist = new Array<number>(n).fill(Infinity);
  dist[source] = 0;
  for (let round = 0; round < n; round++) {
    let changed = false;
    for (const e of edges) {
      if (dist[e.u] + e.w < dist[e.v]) {
        dist[e.v] = dist[e.u] + e.w;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return dist;
}

const graph = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      source: fc.integer({ min: 0, max: n - 1 }),
      edges: fc.array(fc.record({ u: fc.integer({ min: 0, max: n - 1 }), v: fc.integer({ min: 0, max: n - 1 }), w: fc.integer({ min: 0, max: 20 }) }), { maxLength: 40 }),
    }),
  );

describe("dijkstra", () => {
  it("equals brute-force Bellman-Ford on random small graphs", () => {
    fc.assert(
      fc.property(graph, ({ n, source, edges }) => {
        const sp = dijkstra(n, source, adjacency(n, edges));
        expect(Array.from(sp.dist)).toEqual(bellmanFord(n, edges, source));
      }),
      { numRuns: 300 },
    );
  });

  it("returns paths whose edge weights sum to the distance", () => {
    fc.assert(
      fc.property(graph, fc.nat(), ({ n, source, edges }, pick) => {
        const sp = dijkstra(n, source, adjacency(n, edges));
        const target = pick % n;
        if (!Number.isFinite(sp.dist[target])) return;
        const path = pathEdges(sp, target);
        let at = source;
        let total = 0;
        for (const e of path) {
          expect(e.from).toBe(at);
          const best = Math.min(...edges.filter((x) => x.u === e.from && x.v === e.to).map((x) => x.w));
          total += best;
          at = e.to;
        }
        expect(at).toBe(target);
        expect(total).toBe(sp.dist[target]);
      }),
      { numRuns: 200 },
    );
  });

  it("adding an edge never increases any shortest-path cost", () => {
    fc.assert(
      fc.property(
        graph,
        fc.record({ u: fc.nat(), v: fc.nat(), w: fc.integer({ min: 0, max: 20 }) }),
        ({ n, source, edges }, extra) => {
          const added: Edge = { u: extra.u % n, v: extra.v % n, w: extra.w };
          const before = dijkstra(n, source, adjacency(n, edges)).dist;
          const after = dijkstra(n, source, adjacency(n, [...edges, added])).dist;
          for (let i = 0; i < n; i++) expect(after[i]).toBeLessThanOrEqual(before[i]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("stops at the goal with its final distance", () => {
    fc.assert(
      fc.property(graph, fc.nat(), ({ n, source, edges }, pick) => {
        const goal = pick % n;
        const full = dijkstra(n, source, adjacency(n, edges));
        const early = dijkstra(n, source, adjacency(n, edges), (s) => s === goal);
        if (Number.isFinite(full.dist[goal])) {
          expect(early.goal).toBe(goal);
          expect(early.dist[goal]).toBe(full.dist[goal]);
        } else {
          expect(early.goal).toBe(-1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic and breaks ties the same way every time", () => {
    const edges: Edge[] = [
      { u: 0, v: 1, w: 1 },
      { u: 0, v: 2, w: 1 },
      { u: 1, v: 3, w: 1 },
      { u: 2, v: 3, w: 1 },
    ];
    const a = dijkstra(4, 0, adjacency(4, edges));
    const b = dijkstra(4, 0, adjacency(4, edges));
    expect(Array.from(a.prev)).toEqual(Array.from(b.prev));
    expect(a.dist[3]).toBe(2);
    expect(a.prev[3]).toBe(1); // lower state index wins the tie
  });

  it("chainEdges matches dijkstra on a line graph", () => {
    const n = 9;
    const edges: Edge[] = [];
    for (let i = 0; i < n - 1; i++) {
      edges.push({ u: i, v: i + 1, w: 1 });
      edges.push({ u: i + 1, v: i, w: 1 });
    }
    for (const [from, to] of [
      [0, 8],
      [8, 0],
      [3, 5],
      [5, 3],
      [4, 4],
    ]) {
      const sp = dijkstra(n, from, adjacency(n, edges), (s) => s === to);
      const viaSearch = pathEdges(sp, sp.goal).map((e) => [e.from, e.to]);
      const viaChain = chainEdges(from, to, 0, 1).map((e) => [e.from, e.to]);
      expect(viaChain).toEqual(viaSearch);
    }
  });
});
