// Small in-memory helpers: a TTL cache with a size cap and a fixed-window per-key rate limiter.
// State lives in the server process, which is enough for a single-instance demo deployment.

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
}

export function createTtlCache<V>(opts: { ttlMs: number; maxEntries: number; now?: () => number }): TtlCache<V> {
  const now = opts.now ?? Date.now;
  const map = new Map<string, { value: V; expires: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, expires: now() + opts.ttlMs });
      // Maps iterate in insertion order, so the first key is the oldest entry.
      while (map.size > opts.maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    get size() {
      return map.size;
    },
  };
}

export interface RateLimiter {
  /** Records one request for `key`. `retryAfterSec` is only meaningful when `ok` is false. */
  hit(key: string): { ok: boolean; retryAfterSec: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const t = now();
      if (windows.size > 5000) {
        for (const [k, w] of windows) if (t - w.start >= opts.windowMs) windows.delete(k);
      }
      const w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        windows.set(key, { start: t, count: 1 });
        return { ok: true, retryAfterSec: 0 };
      }
      w.count += 1;
      if (w.count > opts.limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + opts.windowMs - t) / 1000)) };
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}
