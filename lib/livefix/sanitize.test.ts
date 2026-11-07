// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isAllowedAttribute, isSanitizeError, sanitizeCss, sanitizeFragment } from "./sanitize";

function clean(html: string): string {
  const frag = sanitizeFragment(document, html);
  if (isSanitizeError(frag)) throw new Error(frag.error);
  const host = document.createElement("div");
  host.appendChild(frag);
  return host.innerHTML;
}

describe("sanitizeFragment", () => {
  it("strips scripts, event handlers and script URLs but keeps class and data-*", () => {
    const out = clean(
      `<button class="size" data-size="M" onclick="alert(1)" data-detour-id="x">M</button><script>alert(2)</script><iframe src="https://e.x"></iframe><a href="  JaVa\tScript:alert(3)">x</a><a href="#main">ok</a>`,
    );
    expect(out).not.toMatch(/script|onclick|iframe|alert/i);
    expect(out).toContain('class="size"');
    expect(out).toContain('data-size="M"');
    expect(out).toContain('data-detour-id="x"');
    expect(out).toContain('href="#main"');
  });

  it("drops style attributes that fetch or run code and refuses empty or oversized html", () => {
    expect(clean(`<div style="color:red">a</div><div style="background:url(http://e.x/a.png)">b</div>`)).toBe(`<div style="color:red">a</div><div>b</div>`);
    expect(isSanitizeError(sanitizeFragment(document, "  "))).toBe(true);
    expect(isSanitizeError(sanitizeFragment(document, "<p>".padEnd(5000, "x")))).toBe(true);
  });
});

describe("allow-lists", () => {
  it("accepts aria, role, a non-positive tabindex and in-page hrefs only", () => {
    expect(isAllowedAttribute("aria-label", "Cart")).toBe(true);
    expect(isAllowedAttribute("role", "button")).toBe(true);
    expect(isAllowedAttribute("tabindex", "0")).toBe(true);
    expect(isAllowedAttribute("tabindex", "3")).toBe(false);
    expect(isAllowedAttribute("tabindex")).toBe(true); // removal
    expect(isAllowedAttribute("href", "#main-content")).toBe(true);
    expect(isAllowedAttribute("href", "https://e.x")).toBe(false);
    expect(isAllowedAttribute("onclick", "x()")).toBe(false);
    expect(isAllowedAttribute("style", "color:red")).toBe(false);
  });

  it("rejects css that loads, imports or runs anything", () => {
    expect(sanitizeCss("button.x{border:0;background:none}")).toEqual({ css: "button.x{border:0;background:none}" });
    for (const bad of ["a{background:url(x)}", "@import 'x';", "a{width:expression(1)}", "a{b:javascript:x}", "</style><script>", "a{behavior:x}", "a{background:u\\72l(x)}"]) {
      expect(isSanitizeError(sanitizeCss(bad)), bad).toBe(true);
    }
    expect(isSanitizeError(sanitizeCss("a{}".padEnd(3000, " ")))).toBe(true);
  });
});
