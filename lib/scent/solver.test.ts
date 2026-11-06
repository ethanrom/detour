import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fundamentalMatrix, identity, invert, matMul, matVec, solve, visitsFromFirstState, type Matrix } from "./solver";

const maxAbsDiff = (A: Matrix, B: Matrix) => Math.max(...A.flatMap((row, i) => row.map((v, j) => Math.abs(v - B[i][j]))));

/** Random strictly diagonally dominant matrix: always well conditioned and non-singular. */
const wellConditioned = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.array(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n }), { minLength: n, maxLength: n }).chain((m) =>
      fc.double({ min: 1.2, max: 3, noNaN: true }).map((slack) =>
        m.map((row, i) => row.map((v, j) => (i === j ? (row.reduce((s, x, k) => (k === i ? s : s + Math.abs(x)), 0) + slack) * (v >= 0 ? 1 : -1) : v))),
      ),
    ),
  );

describe("invert / solve (Gaussian elimination with partial pivoting)", () => {
  it("matches a known 3x3 inverse", () => {
    const A = [
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ];
    const expected = [
      [3 / 4, 1 / 2, 1 / 4],
      [1 / 2, 1, 1 / 2],
      [1 / 4, 1 / 2, 3 / 4],
    ];
    expect(maxAbsDiff(invert(A), expected)).toBeLessThan(1e-12);
  });

  it("needs row exchanges: a zero leading pivot is fine", () => {
    const A = [
      [0, 1],
      [1, 0],
    ];
    expect(invert(A)).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(solve(A, [3, 5])).toEqual([5, 3]);
  });

  it("throws on a singular matrix", () => {
    expect(() =>
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toThrow(/singular/);
    expect(() =>
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/);
  });

  it("A * inv(A) = I and inv(inv(A)) = A on random well-conditioned matrices", () => {
    fc.assert(
      fc.property(wellConditioned, (A) => {
        const inv = invert(A);
        expect(maxAbsDiff(matMul(A, inv), identity(A.length))).toBeLessThan(1e-9);
        expect(maxAbsDiff(matMul(inv, A), identity(A.length))).toBeLessThan(1e-9);
        expect(maxAbsDiff(invert(inv), A)).toBeLessThan(1e-7);
      }),
      { numRuns: 200 },
    );
  });

  it("solve(A, b) agrees with inv(A) b and satisfies A x = b", () => {
    fc.assert(
      fc.property(
        wellConditioned.chain((A) => fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: A.length, maxLength: A.length }).map((b) => ({ A, b }))),
        ({ A, b }) => {
          const x = solve(A, b);
          const viaInverse = matVec(invert(A), b);
          const resid = matVec(A, x).map((v, i) => Math.abs(v - b[i]));
          expect(Math.max(...resid)).toBeLessThan(1e-8);
          expect(Math.max(...x.map((v, i) => Math.abs(v - viaInverse[i])))).toBeLessThan(1e-7);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fundamental matrix of a sub-stochastic Q has non-negative entries and N (I - Q) = I", () => {
    // Q = random non-negative matrix with row sums <= 1 - leak, so absorption is certain.
    const subStochastic = fc.integer({ min: 1, max: 10 }).chain((n) =>
      fc
        .tuple(
          fc.array(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: n, maxLength: n }), { minLength: n, maxLength: n }),
          fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        )
        .map(([m, leak]) =>
          m.map((row) => {
            const s = row.reduce((a, b) => a + b, 0) || 1;
            return row.map((v) => (v / s) * (1 - leak));
          }),
        ),
    );
    fc.assert(
      fc.property(subStochastic, (Q) => {
        const N = fundamentalMatrix(Q);
        for (const row of N) for (const v of row) expect(v).toBeGreaterThanOrEqual(-1e-12);
        const IminusQ = identity(Q.length).map((r, i) => r.map((v, j) => v - Q[i][j]));
        expect(maxAbsDiff(matMul(N, IminusQ), identity(Q.length))).toBeLessThan(1e-8);
        // Diagonal of N is >= 1 (the visit at time zero).
        N.forEach((row, i) => expect(row[i]).toBeGreaterThanOrEqual(1 - 1e-12));
        // The first row of N, whether from the full inverse or from one transposed solve.
        const full = visitsFromFirstState(Q, { full: true });
        const fast = visitsFromFirstState(Q, { full: false });
        expect(full).toEqual(N[0]);
        full.forEach((v, j) => expect(Math.abs(v - fast[j])).toBeLessThan(1e-9 * Math.max(1, v)));
      }),
      { numRuns: 200 },
    );
  });

  it("the first-row solve stays fast on long bidiagonal chains (600 states)", () => {
    const n = 600;
    const Q: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (j === i + 1 ? 0.9 : 0)));
    const t0 = performance.now();
    const v = visitsFromFirstState(Q);
    expect(performance.now() - t0).toBeLessThan(1500);
    v.forEach((x, j) => expect(x).toBeCloseTo(0.9 ** j, 10));
  });
});
