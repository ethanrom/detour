// Number and sentence formatting shared by every screen. Pure, so it is unit tested.

/** 4.3 -> "4.3", 52.4 -> "52", 6 -> "6". One decimal below 10 s, whole seconds above. */
export function fmtNum(s: number): string {
  if (!Number.isFinite(s)) return "–";
  const v = Math.max(0, s);
  if (v < 10) {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return String(Math.round(v));
}

/** "4.3 s" / "52 s". */
export function fmtSeconds(s: number): string {
  return `${fmtNum(s)} s`;
}

/** "38–71" (en dash, no unit). */
export function fmtRange(interval: readonly [number, number]): string {
  return `${fmtNum(interval[0])}–${fmtNum(interval[1])}`;
}

/** "52 s, 90% interval 38–71 s" — the canonical way to show a prediction. */
export function fmtResultLine(seconds: number, interval: readonly [number, number]): string {
  return `${fmtSeconds(seconds)}, 90% interval ${fmtRange(interval)} s`;
}

/** Same sentence written for speech: "52 seconds, 90 percent interval 38 to 71 seconds". */
export function fmtResultSpoken(seconds: number, interval: readonly [number, number]): string {
  return `${fmtNum(seconds)} ${plural(seconds, "second")}, 90 percent interval ${fmtNum(interval[0])} to ${fmtNum(interval[1])} seconds`;
}

function plural(n: number, word: string): string {
  return Math.round(n * 10) / 10 === 1 ? word : `${word}s`;
}

/** Whole-number percentage reduction from `before` to `after` (negative when slower). */
export function percentLess(before: number, after: number): number {
  if (!(before > 0) || !Number.isFinite(before) || !Number.isFinite(after)) return 0;
  return Math.round(((before - after) / before) * 100);
}

/** "83% less", "12% more", "no change". */
export function fmtPercentLess(before: number, after: number): string {
  const p = percentLess(before, after);
  if (p === 0) return "no change";
  return p > 0 ? `${p}% less` : `${Math.abs(p)}% more`;
}

/** "−15 s" with a real minus sign, "+3 s" for increases. */
export function fmtSigned(deltaSeconds: number): string {
  const r = Math.round(deltaSeconds * 10) / 10;
  if (r === 0) return "0 s";
  return `${r < 0 ? "−" : "+"}${fmtNum(Math.abs(r))} s`;
}

/** Clock-style elapsed label for the race: "12.4 s" while running. */
export function fmtElapsed(s: number): string {
  return `${Math.max(0, s).toFixed(1)} s`;
}

/** Where the exhaustive check drew its subsets from: "all 11 candidates" or "the 11 most promising candidates". */
function poolPhrase(pool: number | undefined, total: number | undefined): string {
  if (pool === undefined) return "the candidates";
  if (total !== undefined && pool >= total) return `all ${pool} candidates`;
  return `the ${pool} most promising candidates`;
}

/** Optimality sentence. `gap` is plan.optimalityGap, `pool` the exhaustive pool size (exhaustivePoolSize(plan)),
 *  `total` the number of candidates and `k` the fix budget. Null when the exhaustive check did not run. */
export function fmtOptimality(gap: number | undefined, pool?: number, total?: number, k?: number): string | null {
  if (gap === undefined) return null;
  const sets = k === undefined ? "all fix sets" : `all sets of up to ${k} fix${k === 1 ? "" : "es"}`;
  const among = `${sets} of ${poolPhrase(pool, total)}`;
  if (Math.abs(gap) < 1e-9) return `Certified optimal among ${among} (gap 0.0 s)`;
  return `Within ${gap.toFixed(1)} s of the best of ${among}, found by exhaustive search`;
}
