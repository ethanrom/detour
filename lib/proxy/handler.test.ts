import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/proxy/route";
import type { Transport } from "./fetch";
import { handleProxyRequest, type CachedPage } from "./handler";
import { createRateLimiter, createTtlCache } from "./limits";

const api = (query: string) => new Request(`http://localhost:3000/api/proxy?${query}`);

describe("GET /api/proxy", () => {
  it("answers a blocked host with 403, the error header and a small HTML page", async () => {
    const res = await GET(api(`url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`));
    expect(res.status).toBe(403);
    expect(res.headers.get("X-Detour-Proxy-Error")).toBe("blocked-host");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("blocked-host");

    const bad = await GET(api("url=ftp%3A%2F%2Fexample.com%2F"));
    expect(bad.status).toBe(400);
    expect(bad.headers.get("X-Detour-Proxy-Error")).toBe("bad-url");

    const check = await GET(api(`mode=check&url=${encodeURIComponent("http://localhost/")}`));
    expect(check.status).toBe(403);
    expect(await check.json()).toMatchObject({ ok: false, error: "blocked-host" });
  });

  it("serves the rewritten page with the security headers, caches it, and reports check metadata", async () => {
    const transport = vi.fn<Transport>(async () => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      destroy: () => {},
      body: (async function* () {
        yield new TextEncoder().encode(
          "<!doctype html><title>Hello</title><script>alert(1)</script><p onclick=\"x()\">Hi</p>",
        );
      })(),
    }));
    const deps = {
      transport,
      lookup: async () => [{ address: "93.184.216.34", family: 4 as const }],
      cache: createTtlCache<CachedPage>({ ttlMs: 60_000, maxEntries: 4 }),
      limiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    };
    const url = `url=${encodeURIComponent("https://example.com/page")}`;

    const check = await handleProxyRequest(api(`${url}&mode=check`), deps);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ ok: true, finalUrl: "https://example.com/page", title: "Hello", bytes: 83 });

    const page = await handleProxyRequest(api(url), deps);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    expect(page.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.headers.get("Cache-Control")).toBe("private, max-age=300");
    const body = await page.text();
    expect(body).toContain('<base href="https://example.com/page">');
    expect(body).not.toMatch(/<script|onclick/i);
    expect(transport).toHaveBeenCalledTimes(1); // the second request came from the cache
  });

  it("rate limits uncached requests per client IP", async () => {
    const deps = {
      transport: vi.fn<Transport>(),
      limiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
      cache: createTtlCache<CachedPage>({ ttlMs: 60_000, maxEntries: 4 }),
    };
    const call = () =>
      handleProxyRequest(
        new Request("http://localhost:3000/api/proxy?url=http%3A%2F%2F10.0.0.1%2F", {
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.2" },
        }),
        deps,
      );
    expect((await call()).status).toBe(403);
    expect((await call()).status).toBe(403);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("X-Detour-Proxy-Error")).toBe("rate-limited");
  });
});
