import { describe, expect, it, vi } from "vitest";
import { fetchHtml, type Transport, type UpstreamResponse } from "./fetch";
import type { LookupFn } from "./guard";

const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function reply(status: number, headers: Record<string, string>, body = ""): UpstreamResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers,
    destroy: () => {},
    body: (async function* () {
      yield bytes;
    })(),
  };
}

describe("guarded fetch", () => {
  it("re-validates every redirect hop and never contacts a private target", async () => {
    const transport = vi.fn<Transport>(async () =>
      reply(302, { location: "http://169.254.169.254/latest/meta-data/" }),
    );
    await expect(fetchHtml("https://example.com/", { transport, lookup: publicLookup })).rejects.toMatchObject({
      code: "blocked-host",
    });
    expect(transport).toHaveBeenCalledTimes(1);

    // A public name that redirects to a name resolving privately is blocked at the DNS step.
    const dnsLookup: LookupFn = async (host) => [
      { address: host === "evil.example.org" ? "10.0.0.7" : "93.184.216.34", family: 4 },
    ];
    const hop = vi.fn<Transport>(async () => reply(301, { location: "https://evil.example.org/x" }));
    await expect(fetchHtml("https://example.com/", { transport: hop, lookup: dnsLookup })).rejects.toMatchObject({
      code: "blocked-host",
    });
    expect(hop).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects, then enforces content type, size cap and status mapping", async () => {
    const calls: string[] = [];
    const transport: Transport = async ({ url }) => {
      calls.push(url.href);
      if (url.pathname === "/start") return reply(301, { location: "/final?x=1" });
      if (url.pathname === "/final") return reply(200, { "content-type": "text/html; charset=utf-8" }, "<p>hi</p>");
      if (url.pathname === "/json") return reply(200, { "content-type": "application/json" }, "{}");
      if (url.pathname === "/big") return reply(200, { "content-type": "text/html" }, "x".repeat(200));
      return reply(404, { "content-type": "text/html" }, "nope");
    };
    const deps = { transport, lookup: publicLookup, maxBytes: 100 };
    const ok = await fetchHtml("https://example.com/start", deps);
    expect(ok).toMatchObject({ finalUrl: "https://example.com/final?x=1", html: "<p>hi</p>", bytes: 9 });
    expect(calls).toEqual(["https://example.com/start", "https://example.com/final?x=1"]);
    await expect(fetchHtml("https://example.com/json", deps)).rejects.toMatchObject({ code: "not-html" });
    await expect(fetchHtml("https://example.com/big", deps)).rejects.toMatchObject({ code: "too-large" });
    await expect(fetchHtml("https://example.com/missing", deps)).rejects.toMatchObject({ code: "upstream-404" });
  });

  it("gives up with 'timeout' when the site never answers", async () => {
    const transport: Transport = ({ signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(
      fetchHtml("https://example.com/", { transport, lookup: publicLookup, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
