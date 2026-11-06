// Live smoke test: real DNS and a real HTTPS fetch through the guard and rewriter. Skipped unless
// PROXY_LIVE=1 so CI never touches the network.  Run: PROXY_LIVE=1 npx vitest run lib/proxy/live.test.ts

import { describe, expect, it } from "vitest";
import { fetchHtml } from "./fetch";
import { rewriteHtml } from "./rewrite";

describe.skipIf(process.env.PROXY_LIVE !== "1")("live proxy smoke", () => {
  it("fetches https://www.usa.gov/food-assistance and strips every script", async () => {
    const fetched = await fetchHtml("https://www.usa.gov/food-assistance");
    const rewritten = rewriteHtml(fetched.html, fetched.finalUrl);
    console.log(
      JSON.stringify({
        finalUrl: fetched.finalUrl,
        upstreamBytes: fetched.bytes,
        servedBytes: Buffer.byteLength(rewritten.html),
        title: rewritten.title,
        scriptsBefore: (fetched.html.match(/<script/gi) ?? []).length,
        scriptsAfter: (rewritten.html.match(/<script/gi) ?? []).length,
        onAttrsAfter: (rewritten.html.match(/\son[a-z]+\s*=/gi) ?? []).length,
      }),
    );
    expect(rewritten.title.length).toBeGreaterThan(0);
    expect(rewritten.html).not.toMatch(/<script/i);
    expect(rewritten.html).toContain("<base href=");
  }, 30_000);
});
