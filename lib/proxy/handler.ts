// Request handler behind GET /api/proxy. Kept out of app/api/proxy/route.ts because a Next.js route
// module may only export HTTP methods and route config, and tests need to inject the transport.

import { ProxyError, type ProxyErrorCode } from "./errors";
import { fetchHtml, type FetchDeps } from "./fetch";
import { createRateLimiter, createTtlCache, type RateLimiter, type TtlCache } from "./limits";
import { rewriteHtml } from "./rewrite";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 24;
export const RATE_LIMIT_PER_MINUTE = 30;

export interface CachedPage {
  html: string;
  finalUrl: string;
  title: string;
  bytes: number;
}

export interface ProxyDeps extends FetchDeps {
  cache?: TtlCache<CachedPage>;
  limiter?: RateLimiter;
}

// `style-src` needs 'unsafe-inline' because the page's own inline styles must still apply (layout is
// what Detour measures). Scripts stay fully off, including inline handlers and javascript: URLs.
const PAGE_CSP = [
  "default-src * data: blob:",
  "style-src * 'unsafe-inline' data: blob:",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri *",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

const defaultCache = createTtlCache<CachedPage>({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });
const defaultLimiter = createRateLimiter({ limit: RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });
const inFlight = new Map<string, Promise<CachedPage>>();

/**
 * GET ?url=<absolute URL>               -> 200 text/html: the page with scripts removed and <base> set
 * GET ?url=<absolute URL>&mode=check    -> 200 { ok: true, finalUrl, title, bytes }
 * Errors (HTML page, or JSON { ok: false, error, message } in check mode) carry the status and the
 * `X-Detour-Proxy-Error` header: bad-url 400, blocked-host 403, not-html/too-large 422, rate-limited 429,
 * upstream-<status>/fetch-failed 502, timeout 504.
 */
export async function handleProxyRequest(req: Request, deps: ProxyDeps = {}): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const mode = params.get("mode") === "check" ? "check" : "page";
  const cache = deps.cache ?? defaultCache;
  const limiter = deps.limiter ?? defaultLimiter;

  try {
    const raw = params.get("url");
    if (!raw) throw new ProxyError("bad-url", "Enter a full web address such as https://example.com/page.");
    const key = cacheKey(raw);

    let page = cache.get(key);
    if (!page) {
      const verdict = limiter.hit(clientKey(req));
      if (!verdict.ok) {
        throw new ProxyError("rate-limited", `Too many requests. Try again in ${verdict.retryAfterSec} seconds.`);
      }
      let pending = inFlight.get(key);
      if (!pending) {
        pending = loadPage(raw, deps).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      page = await pending;
      cache.set(key, page);
    }

    if (mode === "check") {
      return Response.json(
        { ok: true, finalUrl: page.finalUrl, title: page.title, bytes: page.bytes },
        { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
    return new Response(page.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": PAGE_CSP,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return errorResponse(mode, toProxyError(error));
  }
}

async function loadPage(raw: string, deps: ProxyDeps): Promise<CachedPage> {
  const fetched = await fetchHtml(raw, deps);
  const rewritten = rewriteHtml(fetched.html, fetched.finalUrl);
  return { html: rewritten.html, finalUrl: fetched.finalUrl, title: rewritten.title, bytes: fetched.bytes };
}

function cacheKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    return u.href;
  } catch {
    return raw; // invalid: validateUrl rejects it and nothing is cached
  }
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

function toProxyError(error: unknown): ProxyError {
  if (error instanceof ProxyError) return error;
  return new ProxyError("fetch-failed", "The page could not be fetched.");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errorResponse(mode: "page" | "check", error: ProxyError): Response {
  const headers: Record<string, string> = {
    "X-Detour-Proxy-Error": error.code,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (error.code === "rate-limited") headers["Retry-After"] = error.message.match(/\d+/)?.[0] ?? "60";
  if (mode === "check") {
    return Response.json({ ok: false, error: error.code, message: error.message }, { status: error.status, headers });
  }
  return new Response(errorPage(error.code, error.message), {
    status: error.status,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

function errorPage(code: ProxyErrorCode, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page could not be loaded</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}code{background:#eee;padding:.1rem .3rem;border-radius:.2rem}</style>
</head>
<body>
<main>
<h1>This page could not be loaded</h1>
<p>${escapeHtml(message)}</p>
<p>Error code: <code>${escapeHtml(code)}</code></p>
</main>
</body>
</html>`;
}
