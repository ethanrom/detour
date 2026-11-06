import { describe, expect, it } from "vitest";
import { checkUrl, friendlyProxyError, normalizeUrlInput, proxyPath, sourceUrl, urlSiteFromCheck, wireSiteId } from "./any-url";

describe("normalizeUrlInput", () => {
  it("adds https, drops the fragment and keeps the query", () => {
    expect(normalizeUrlInput("  example.com/a b ")).toMatchObject({ ok: false }); // spaces inside
    const r = normalizeUrlInput(" www.usa.gov/food-assistance?x=1#top ");
    expect(r).toEqual({ ok: true, url: "https://www.usa.gov/food-assistance?x=1", hostname: "www.usa.gov" });
  });

  it("accepts hosts with a port and protocol-relative links", () => {
    expect(normalizeUrlInput("example.com:8080/x")).toMatchObject({ ok: true, url: "https://example.com:8080/x" });
    expect(normalizeUrlInput("//example.org")).toMatchObject({ ok: true, url: "https://example.org/" });
    expect(normalizeUrlInput("http://example.org")).toMatchObject({ ok: true, url: "http://example.org/" });
  });

  it("rejects what cannot be a public web address", () => {
    for (const bad of ["", "   ", "javascript:alert(1)", "mailto:a@b.co", "ftp://example.com", "intranet", "https://user:pw@example.com", "https://"]) {
      expect(normalizeUrlInput(bad).ok, bad).toBe(false);
    }
    expect(normalizeUrlInput(`https://example.com/${"a".repeat(3000)}`).ok).toBe(false);
  });

  it("leaves private addresses to the proxy, which names them", () => {
    expect(normalizeUrlInput("http://localhost:3000/x").ok).toBe(true);
    expect(normalizeUrlInput("http://192.168.0.1/").ok).toBe(true);
  });
});

describe("friendlyProxyError", () => {
  it("has a plain sentence for every proxy code", () => {
    expect(friendlyProxyError("blocked-host")).toBe("That address points to a private network, so Detour won’t fetch it.");
    expect(friendlyProxyError("rate-limited")).toBe("Too many pages fetched from this address; try again in a minute.");
    for (const code of ["bad-url", "not-html", "too-large", "timeout", "fetch-failed", "upstream-404", "upstream-403", "upstream-429", "upstream-503", "upstream-418"]) {
      expect(friendlyProxyError(code).length, code).toBeGreaterThan(20);
    }
    expect(friendlyProxyError("upstream-404")).toContain("404");
  });

  it("falls back to the server's message, then to a generic one", () => {
    expect(friendlyProxyError("something-new", "Server says no")).toBe("Server says no");
    expect(friendlyProxyError("something-new")).toMatch(/could not read/);
  });
});

describe("URL sites", () => {
  const finalUrl = "https://www.usa.gov/food-assistance?a=b&c=d";
  it("builds the SiteInfo the workbench expects", () => {
    const site = urlSiteFromCheck({ finalUrl, title: "  Food   assistance\n | USA.gov " });
    expect(site).toEqual({
      id: `url:${finalUrl}`,
      name: "www.usa.gov",
      tagline: "Food assistance | USA.gov",
      path: `/api/proxy?url=${encodeURIComponent(finalUrl)}`,
      kind: "url",
      tasks: [],
    });
    expect(sourceUrl(site)).toBe(finalUrl);
    expect(urlSiteFromCheck({ finalUrl, title: "" }).tagline).toBe("Untitled page");
    expect(proxyPath(finalUrl, true)).toBe(`/api/proxy?url=${encodeURIComponent(finalUrl)}&mode=check`);
  });

  it("keeps ids short enough for /api/ground and /api/repair", () => {
    expect(wireSiteId("url:https://example.com/")).toBe("url:https://example.com/");
    const long = `url:https://example.com/${"x".repeat(300)}`;
    const a = wireSiteId(long);
    expect(a.length).toBeLessThanOrEqual(100);
    expect(wireSiteId(long)).toBe(a);
    expect(wireSiteId(`${long}y`)).not.toBe(a);
  });
});

describe("checkUrl", () => {
  const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

  it("returns the final address and title when the proxy says ok", async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input) => {
      calls.push(String(input));
      return json({ ok: true, finalUrl: "https://example.com/", title: "Example", bytes: 1256 });
    };
    expect(await checkUrl("https://example.com/", fake)).toEqual({ ok: true, finalUrl: "https://example.com/", title: "Example", bytes: 1256 });
    expect(calls).toEqual(["/api/proxy?url=https%3A%2F%2Fexample.com%2F&mode=check"]);
  });

  it("turns each failure into a friendly message", async () => {
    const blocked = await checkUrl("http://10.0.0.1/", async () => json({ ok: false, error: "blocked-host", message: "x" }, { status: 403 }));
    expect(blocked).toEqual({ ok: false, code: "blocked-host", message: friendlyProxyError("blocked-host") });

    const viaHeader = await checkUrl("https://x.co/", async () => new Response("<html></html>", { status: 502, headers: { "X-Detour-Proxy-Error": "upstream-500" } }));
    expect(viaHeader).toMatchObject({ ok: false, code: "upstream-500" });

    const missing = await checkUrl("https://x.co/", async () => new Response("not found", { status: 404 }));
    expect(missing).toMatchObject({ ok: false, code: "proxy-unavailable" });

    const down = await checkUrl("https://x.co/", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(down).toMatchObject({ ok: false, code: "network" });

    const slow = await checkUrl(
      "https://x.co/",
      (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      5,
    );
    expect(slow).toMatchObject({ ok: false, code: "timeout" });
  });
});
