// "Analyze any URL": validation, the call to the page proxy, friendly errors and the SiteInfo for a URL.
//
// The proxy (GET /api/proxy) serves any public page from our own origin with scripts removed, so the preview
// iframe stays same-origin and the extractor can read its rendered DOM. `mode=check` answers with JSON before
// we load anything into the iframe.

import type { SiteInfo } from "./datasource";

export const URL_SITE_PREFIX = "url:";
export const MAX_URL_LENGTH = 2048;
/** /api/ground and /api/repair accept siteId and task.siteId up to 100 characters. */
export const MAX_WIRE_ID = 100;
/** If the proxy has not answered after this long the check is abandoned. */
const CHECK_TIMEOUT_MS = 30_000;

export type UrlInputResult = { ok: true; url: string; hostname: string } | { ok: false; message: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT = /^[^/:?#@\s]+:\d+(?:[/?#]|$)/;

/**
 * Turn what someone typed into the absolute http(s) URL we send to the proxy. A missing scheme means https.
 * Only checks the shape; whether the address is allowed and reachable is the proxy's call.
 */
export function normalizeUrlInput(raw: string): UrlInputResult {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Enter the address of a page, for example https://example.com." };
  if (/\s/.test(text)) return { ok: false, message: "An address cannot contain spaces. Check what you pasted." };
  if (text.length > MAX_URL_LENGTH) return { ok: false, message: "That address is too long." };

  let candidate = text;
  if (text.startsWith("//")) candidate = `https:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // "mailto:x" and "javascript:x" are schemes; "example.com:8080" and "localhost:3000" are hosts with a port.
    if (SCHEME.test(text) && !HOST_PORT.test(text)) return { ok: false, message: "Only http and https addresses work. Try one that starts with https://." };
    candidate = `https://${text}`;
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, message: "That does not look like a web address. Try something like https://example.com." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "Only http and https addresses work. Try one that starts with https://." };
  if (u.username || u.password) return { ok: false, message: "Remove the user name and password from the address." };
  const host = u.hostname;
  if (!host) return { ok: false, message: "That address has no site name. Try something like https://example.com." };
  if (!host.includes(".") && !host.includes(":") && host !== "localhost") {
    return { ok: false, message: "That does not look like a full web address. Add the domain, for example example.com." };
  }
  u.hash = "";
  return { ok: true, url: u.href, hostname: host };
}

/** `GET` URL of the proxy for a page. `check` asks for the JSON pre-flight instead of the page. */
export function proxyPath(url: string, check = false): string {
  return `/api/proxy?url=${encodeURIComponent(url)}${check ? "&mode=check" : ""}`;
}

/** Plain-language message for a proxy error code (`X-Detour-Proxy-Error` or the `error` of mode=check). */
export function friendlyProxyError(code: string, fallback?: string): string {
  switch (code) {
    case "bad-url":
      return "That does not look like a web address. Try something like https://example.com.";
    case "blocked-host":
      return "That address points to a private network, so Detour won’t fetch it.";
    case "not-html":
      return "That address is not a web page (it is a file, an image or data). Try a page that opens as a normal web page.";
    case "too-large":
      return "That page is too large for Detour to read. Try a lighter page.";
    case "timeout":
      return "That site took too long to answer. Try again, or try another page.";
    case "rate-limited":
      return "Too many pages fetched from this address; try again in a minute.";
    case "fetch-failed":
      return "Detour could not reach that site. Check the spelling, or the site may be down.";
    case "proxy-unavailable":
      return "The page fetcher is not available on this server.";
    case "network":
      return "Detour could not be reached to check that address. Check your connection and try again.";
  }
  const status = /^upstream-(\d{3})$/.exec(code)?.[1];
  if (status) {
    const n = Number(status);
    if (n === 404 || n === 410) return `The site says that page does not exist (${n}). Check the address.`;
    if (n === 401 || n === 403) return `The site refused to share that page (${n}). It may need a sign-in or block automated visitors.`;
    if (n === 429) return `The site is limiting requests right now (${n}). Wait a moment and try again.`;
    if (n >= 500) return `The site had a server problem (${n}). Try again later.`;
    return `The site answered with an error (${n}). Try another page.`;
  }
  return fallback?.trim() || "Detour could not read that page. Try another address.";
}

export type CheckResult = { ok: true; finalUrl: string; title: string; bytes: number } | { ok: false; code: string; message: string };

const fail = (code: string, fallback?: string): CheckResult => ({ ok: false, code, message: friendlyProxyError(code, fallback) });

/** Ask the proxy whether `url` is a fetchable HTML page (`mode=check`). Never throws. */
export async function checkUrl(url: string, doFetch: typeof fetch = (...a) => fetch(...a), timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(proxyPath(url, true), { cache: "no-store", signal: ctrl.signal });
    const header = res.headers.get("X-Detour-Proxy-Error");
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (o.ok === true && typeof o.finalUrl === "string" && o.finalUrl) {
      return { ok: true, finalUrl: o.finalUrl, title: typeof o.title === "string" ? o.title : "", bytes: typeof o.bytes === "number" ? o.bytes : 0 };
    }
    const code = typeof o.error === "string" && o.error ? o.error : header;
    if (code) return fail(code, typeof o.message === "string" ? o.message : undefined);
    return fail(res.status === 404 ? "proxy-unavailable" : "fetch-failed");
  } catch (e) {
    return fail(e instanceof DOMException && e.name === "AbortError" ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** The SiteInfo for a page the proxy accepted. It starts with no tasks; the user adds them. */
export function urlSiteFromCheck({ finalUrl, title }: { finalUrl: string; title: string }): SiteInfo {
  const u = new URL(finalUrl);
  return {
    id: URL_SITE_PREFIX + finalUrl,
    name: u.hostname,
    tagline: clip(title.replace(/\s+/g, " ").trim(), 140) || "Untitled page",
    path: proxyPath(finalUrl),
    kind: "url",
    tasks: [],
  };
}

export const isUrlSite = (site: Pick<SiteInfo, "kind">): boolean => site.kind === "url";

/** The page's real address (the part after "url:"). For other sites: their path. */
export function sourceUrl(site: Pick<SiteInfo, "id" | "kind" | "path">): string {
  return site.kind === "url" && site.id.startsWith(URL_SITE_PREFIX) ? site.id.slice(URL_SITE_PREFIX.length) : site.path;
}

function hash36(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** A site id short enough for /api/ground and /api/repair (max 100 characters). Stable, and equal to the id when short. */
export function wireSiteId(siteId: string): string {
  if (siteId.length <= MAX_WIRE_ID) return siteId;
  return `${siteId.slice(0, MAX_WIRE_ID - 10)}~${hash36(siteId)}`.slice(0, MAX_WIRE_ID);
}
