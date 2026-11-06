// Small dense linear-algebra kit for the absorbing Markov chain: Gauss-Jordan inversion and
// Gaussian elimination with partial pivoting. No dependencies.
//
// Row operations skip zero multipliers, so the (bidiagonal) matrices I - Q produced by the search
// model cost O(n^2) rather than O(n^3).

export type Matrix = number[][];

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function assertSquare(A: Matrix): number {
  const n = A.length;
  for (const row of A) if (row.length !== n) throw new Error(`Matrix must be square (got ${n} rows, a row of length ${row.length})`);
  return n;
}

function scaleOf(A: Matrix): number {
  let m = 0;
  for (const row of A) for (const v of row) m = Math.max(m, Math.abs(v));
  return m;
}

/** Inverse by Gauss-Jordan elimination with partial (row) pivoting. Throws if the matrix is singular. */
export function invert(A: Matrix): Matrix {
  const n = assertSquare(A);
  const tol = Math.max(scaleOf(A), 1) * n * 1e-13;
  const M: Matrix = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const w = 2 * n;
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best <= tol) throw new Error("invert: matrix is singular to working precision");
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const inv = 1 / M[col][col];
    const prow = M[col];
    for (let j = 0; j < w; j++) prow[j] *= inv;
    prow[col] = 1;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      const row = M[r];
      for (let j = 0; j < w; j++) row[j] -= f * prow[j];
      row[col] = 0;
    }
  }
  return M.map((row) => row.slice(n));
}

/** Solves A x = b by Gaussian elimination with partial pivoting and back substitution. */
export function solve(A: Matrix, b: number[]): number[] {
  const n = assertSquare(A);
  if (b.length !== n) throw new Error("solve: dimension mismatch");
  const tol = Math.max(scaleOf(A), 1) * n * 1e-13;
  const M: Matrix = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best <= tol) throw new Error("solve: matrix is singular to working precision");
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export function matMul(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const m = B[0]?.length ?? 0;
  const k = B.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let l = 0; l < k; l++) {
      const a = A[i][l];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += a * B[l][j];
    }
  }
  return out;
}

export function matVec(A: Matrix, x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

/** Fundamental matrix N = (I - Q)^-1 of an absorbing chain with transient block Q.
 *  N[i][j] is the expected number of visits to transient state j starting from i. */
export function fundamentalMatrix(Q: Matrix): Matrix {
  const n = assertSquare(Q);
  const IminusQ = identity(n).map((row, i) => row.map((v, j) => v - Q[i][j]));
  return invert(IminusQ);
}
