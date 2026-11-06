// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rewriteHtml } from "./rewrite";

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="windows-1252">
<meta http-equiv="refresh" content="0; url=https://evil.example/">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<base href="https://other.example/">
<title>  Food   assistance </title>
<link rel="modulepreload" href="/app.js">
<link rel="preload" as="script" href="/chunk.js">
<link rel="preload" as="style" href="/site.css" onload="this.onload=null;this.rel='stylesheet'">
<link rel="stylesheet" href="/main.css">
<script>window.stolen = document.cookie</script>
<script src="/app.js"></script>
</head><body onload="steal()">
<noscript><img src="/pixel.gif" alt="tracking pixel"><iframe src="https://tag.example/ns"></iframe><p id="nojs">Enable JavaScript or read this.</p></noscript>
<a id="js" href="  JaVa&#x09;Script:alert(1)" onclick="steal()">bad link</a>
<a id="ok" href="/benefits#apply">Apply</a>
<form action="javascript:steal()"><button formaction="javascript:steal()" onmouseover="x()">Go</button></form>
<iframe src="https://evil.example/"></iframe><object data="x.swf"></object><embed src="x.swf">
<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)"><text>svg link</text></a></svg>
<template><script>alert(2)</script><img src=x onerror="alert(3)"></template>
<img id="icon" src="data:image/png;base64,AAAA" alt="">
</body></html>`;

describe("rewriteHtml", () => {
  const { html, title } = rewriteHtml(PAGE, "https://www.usa.gov/food-assistance");
  const doc = new DOMParser().parseFromString(html, "text/html");

  it("removes scripts, frames, objects and every on* attribute", () => {
    expect(doc.querySelectorAll("script, iframe, object, embed, template script").length).toBe(0);
    const withHandlers = Array.from(doc.querySelectorAll("*")).filter((el) =>
      el.getAttributeNames().some((n) => n.toLowerCase().startsWith("on")),
    );
    expect(withHandlers).toEqual([]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror|onclick|onload|onmouseover/i);
    expect(doc.querySelector("meta[http-equiv]")).toBeNull();
    expect(doc.querySelector('link[rel="modulepreload"], link[href$="chunk.js"]')).toBeNull();
    // The loadCSS pattern is turned into a real stylesheet because the onload swap can no longer run.
    expect(doc.querySelector('link[rel="stylesheet"][href="/site.css"]')).not.toBeNull();
  });

  it("replaces javascript: URLs with # but keeps real links and data: images", () => {
    expect(doc.getElementById("js")?.getAttribute("href")).toBe("#");
    expect(doc.querySelector("form")?.getAttribute("action")).toBe("#");
    expect(doc.querySelector("button")?.getAttribute("formaction")).toBe("#");
    expect(html).not.toMatch(/javascript:/i);
    expect(doc.getElementById("ok")?.getAttribute("href")).toBe("/benefits#apply");
    expect(doc.getElementById("icon")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("injects <base> and the no-referrer meta first in <head>, replacing the page's own base", () => {
    const kids = Array.from(doc.head.children);
    expect(kids[0].tagName).toBe("BASE");
    expect(kids[0].getAttribute("href")).toBe("https://www.usa.gov/food-assistance");
    expect(kids[1].getAttribute("name")).toBe("referrer");
    expect(kids[1].getAttribute("content")).toBe("no-referrer");
    expect(doc.querySelectorAll("base").length).toBe(1);
    expect(title).toBe("Food assistance");
  });

  it("unwraps <noscript> and keeps its (now safe) content", () => {
    expect(doc.querySelector("noscript")).toBeNull();
    expect(doc.getElementById("nojs")?.textContent).toBe("Enable JavaScript or read this.");
    expect(doc.querySelector('img[alt="tracking pixel"]')).not.toBeNull();
  });
});
