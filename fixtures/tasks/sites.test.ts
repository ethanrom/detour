// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { SITES } from "./index";

const SITES_DIR = path.resolve(__dirname, "../../public/sites");

function read(id: string, file: string): string {
  return fs.readFileSync(path.join(SITES_DIR, id, file), "utf8");
}

function load(id: string): Document {
  return new JSDOM(read(id, "index.html")).window.document;
}

const ids = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll("[data-detour-id]")).map((e) => e.getAttribute("data-detour-id") ?? "");

describe.each(SITES)("demo site $id", (site) => {
  const doc = load(site.id);

  it("is served from /sites/<id>/index.html and has tasks", () => {
    expect(site.path).toBe(`/sites/${site.id}/index.html`);
    expect(site.tasks.length).toBeGreaterThanOrEqual(3);
    for (const t of site.tasks) {
      expect(t.siteId).toBe(site.id);
      expect(t.grounding).toBe("fixture");
      expect(t.steps.length).toBeGreaterThan(0);
    }
  });

  it("every task target data-detour-id exists exactly once", () => {
    for (const t of site.tasks) {
      for (const step of t.steps) {
        const hits = doc.querySelectorAll(`[data-detour-id="${step.target}"]`);
        expect(hits.length, `${site.id}/${t.id}: ${step.target}`).toBe(1);
      }
    }
  });

  it("all data-detour-id values are unique", () => {
    const all = ids(doc);
    expect(all.length).toBeGreaterThan(20);
    expect(all.every((v) => v.length > 0)).toBe(true);
    const dupes = all.filter((v, i) => all.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  it("references no external network resources", () => {
    const external = /^\s*(https?:)?\/\//i;
    const bad: string[] = [];
    for (const el of Array.from(doc.querySelectorAll("[src],[href],[action],[srcset],[poster],[data]"))) {
      for (const attr of ["src", "href", "action", "srcset", "poster", "data"]) {
        const v = el.getAttribute(attr);
        if (v && external.test(v)) bad.push(`${el.tagName} ${attr}=${v}`);
      }
    }
    expect(bad).toEqual([]);
    // url(...) in inline styles and in the linked CSS; absolute URLs in the script.
    const css = read(site.id, "styles.css");
    const inline = Array.from(doc.querySelectorAll("[style]")).map((e) => e.getAttribute("style") ?? "").join("\n");
    const styleTags = Array.from(doc.querySelectorAll("style")).map((e) => e.textContent ?? "").join("\n");
    for (const text of [css, inline, styleTags]) {
      for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/gi)) expect(m[1]).not.toMatch(/^(https?:)?\/\//i);
      expect(text).not.toMatch(/@import/i);
    }
    expect(read(site.id, "app.js")).not.toMatch(/https?:\/\//i);
  });

  it("has one h1, a title, and uses only local stylesheet and script", () => {
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.title.length).toBeGreaterThan(5);
    expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("styles.css");
    expect(doc.querySelector("script[src]")?.getAttribute("src")).toBe("app.js");
  });
});

describe("site registry", () => {
  it("lists northwind, riverside and alpine with the right kinds", () => {
    expect(SITES.map((s) => [s.id, s.kind])).toEqual([
      ["northwind", "demo"],
      ["riverside", "demo"],
      ["alpine", "control"],
    ]);
  });

  it("uses the agreed task ids", () => {
    const byId = (id: string) => SITES.find((s) => s.id === id)!.tasks.map((t) => t.id);
    expect(byId("northwind")).toEqual(["buy-m", "returns", "open-cart"]);
    expect(byId("riverside")).toEqual(["apply", "income-3", "spanish"]);
    expect(byId("alpine")).toEqual(["buy-m", "returns", "open-cart"]);
  });
});

describe("northwind inaccessibility patterns", () => {
  const doc = load("northwind");

  it("has no <main> and no skip link", () => {
    expect(doc.querySelector("main")).toBeNull();
    expect(doc.querySelector('[role="main"]')).toBeNull();
    const skip = Array.from(doc.querySelectorAll('a[href^="#"]')).filter((a) => {
      const h = a.getAttribute("href") ?? "";
      return h.length > 1 && /skip/i.test(a.textContent ?? "");
    });
    expect(skip).toEqual([]);
    expect(doc.querySelector(".skip-link")).toBeNull();
  });

  it("uses a div header and div footer, not landmarks", () => {
    expect(doc.querySelector("header")).toBeNull();
    expect(doc.querySelector("footer")).toBeNull();
    expect(doc.querySelector("div.header")).not.toBeNull();
    expect(doc.querySelector("div.footer")).not.toBeNull();
  });

  it("has an always-visible mega menu of at least 55 links in real lists", () => {
    const links = doc.querySelectorAll("nav a");
    expect(links.length).toBeGreaterThanOrEqual(55);
    expect(doc.querySelectorAll("nav ul").length).toBe(6);
  });

  it("has a long footer with at least 35 links", () => {
    expect(doc.querySelectorAll(".footer a").length).toBeGreaterThanOrEqual(35);
  });

  it("has icon-only buttons with no accessible name, including the cart", () => {
    for (const cls of ["icon-search", "icon-wishlist", "icon-cart"]) {
      const b = doc.querySelector(`button.icon-btn.${cls}`);
      expect(b, cls).not.toBeNull();
      expect(b!.querySelector("svg")).not.toBeNull();
      expect(b!.hasAttribute("aria-label")).toBe(false);
      expect(b!.hasAttribute("aria-labelledby")).toBe(false);
      expect(b!.hasAttribute("title")).toBe(false);
      expect((b!.textContent ?? "").trim()).toBe("");
    }
  });

  it("has fake div size and colour buttons with no role or tabindex", () => {
    const sizes = Array.from(doc.querySelectorAll('[data-detour-id^="size-"]')).filter((e) => /^size-(xs|s|m|l|xl)$/.test(e.getAttribute("data-detour-id")!));
    expect(sizes.map((e) => e.textContent!.trim())).toEqual(["XS", "S", "M", "L", "XL"]);
    for (const s of sizes) {
      expect(s.tagName).toBe("DIV");
      expect(s.hasAttribute("role")).toBe(false);
      expect(s.hasAttribute("tabindex")).toBe(false);
      expect(s.hasAttribute("onclick")).toBe(false);
    }
    const swatches = doc.querySelectorAll('[data-detour-id^="swatch-"]');
    expect(swatches.length).toBeGreaterThanOrEqual(4);
    for (const s of Array.from(swatches)) {
      expect(s.tagName).toBe("DIV");
      expect(s.hasAttribute("role")).toBe(false);
      expect(s.hasAttribute("tabindex")).toBe(false);
    }
  });

  it("has a real Add to cart button, a real h1, and fake section headings", () => {
    expect(doc.querySelector('button[data-detour-id="add-to-cart"]')?.textContent?.trim()).toBe("Add to cart");
    expect(doc.querySelector("h1")?.textContent?.trim()).toBe("Trail Jacket");
    expect(doc.querySelectorAll("h2,h3,h4,h5,h6").length).toBe(0);
    const titles = Array.from(doc.querySelectorAll("div.section-title")).map((e) => e.textContent!.trim());
    expect(titles).toEqual(["Product details", "Customer reviews", "Shipping & returns", "You may also like"]);
  });

  it("has 8 reviews before the returns section, 4 related cards and a placeholder-only newsletter input", () => {
    const all = Array.from(doc.querySelectorAll("[data-detour-id]"));
    const order = (id: string) => all.indexOf(doc.querySelector(`[data-detour-id="${id}"]`)!);
    const reviews = doc.querySelectorAll('[data-detour-id^="review-"]');
    const reviewIds = Array.from(reviews).map((e) => e.getAttribute("data-detour-id")!).filter((v) => /^review-\d$/.test(v));
    expect(reviewIds.length).toBe(8);
    for (const id of reviewIds) expect(order(id)).toBeLessThan(order("returns-title"));
    expect(doc.querySelectorAll('a.pcard[data-detour-id^="related-"]').length).toBe(4);
    const input = doc.querySelector('[data-detour-id="newsletter-input"]')!;
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("placeholder")).toBeTruthy();
    expect(input.id).toBe("");
    expect(input.hasAttribute("aria-label")).toBe(false);
    expect(doc.querySelector("label")).toBeNull();
  });

  it("states the 60-day return policy", () => {
    expect(doc.querySelector('[data-detour-id="returns-body"]')?.textContent).toContain(
      "You can return unworn items within 60 days for a full refund.",
    );
  });

  it("attaches behaviour with addEventListener, never inline handlers", () => {
    expect(doc.querySelectorAll("[onclick]").length).toBe(0);
    expect(read("northwind", "app.js")).toContain("addEventListener");
  });

  it("styles fake controls with a pointer cursor", () => {
    const css = read("northwind", "styles.css");
    for (const sel of [".size-opt", ".swatch"]) {
      const rule = css.match(new RegExp(`${sel.replace(".", "\\.")}\\s*\\{[^}]*\\}`));
      expect(rule?.[0], sel).toMatch(/cursor:\s*pointer/);
    }
    const title = css.match(/\.section-title\s*\{[^}]*\}/)?.[0] ?? "";
    expect(title).toMatch(/font-weight:\s*800|font-weight:\s*700/);
    expect(Number(title.match(/font-size:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24);
  });
});

describe("riverside inaccessibility patterns", () => {
  const doc = load("riverside");

  it("has a chat launcher with tabindex=1 and a feedback tab with tabindex=2", () => {
    expect(doc.querySelector('[data-detour-id="chat-launcher"]')?.getAttribute("tabindex")).toBe("1");
    expect(doc.querySelector('[data-detour-id="feedback-tab"]')?.getAttribute("tabindex")).toBe("2");
    expect(doc.querySelector('[data-detour-id="feedback-tab"]')?.textContent?.trim()).toBe("Give feedback");
    expect(doc.querySelectorAll('[tabindex="1"]').length).toBe(1);
  });

  it("has a fake div language picker with Spanish and the other languages", () => {
    const toggle = doc.querySelector('[data-detour-id="lang-toggle"]')!;
    expect(toggle.tagName).toBe("DIV");
    expect(toggle.hasAttribute("role")).toBe(false);
    expect(toggle.hasAttribute("tabindex")).toBe(false);
    expect(toggle.textContent).toContain("English");
    const opts = Array.from(doc.querySelectorAll(".lang-opt"));
    expect(opts.map((o) => o.textContent!.trim())).toEqual(["English", "Español", "Tiếng Việt", "中文", "Tagalog"]);
    for (const o of opts) {
      expect(o.tagName).toBe("DIV");
      expect(o.hasAttribute("role")).toBe(false);
      expect(o.hasAttribute("tabindex")).toBe(false);
    }
  });

  it("has a main nav of about 30 links", () => {
    const n = doc.querySelectorAll("nav a").length;
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n).toBeLessThanOrEqual(34);
  });

  it("has an income grid built from divs, with household 3 as a single row", () => {
    expect(doc.querySelector("table")).toBeNull();
    const row = doc.querySelector('[data-detour-id="income-row-3"]')!;
    expect(row.tagName).toBe("DIV");
    expect((row.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("3 people — $3,108 per month");
    for (let i = 1; i <= 6; i++) expect(doc.querySelector(`[data-detour-id="income-row-${i}"]`)).not.toBeNull();
  });

  it("titles the income section vaguely, with a clear intro inside it", () => {
    const title = doc.querySelector('[data-detour-id="income-title"]')!;
    expect(title.tagName).toBe("DIV");
    expect(title.textContent?.trim()).toBe("More information");
    const intro = doc.querySelector('[data-detour-id="income-intro"]')!;
    expect(intro.textContent).toContain("gross monthly income must be at or below these limits");
    const section = title.parentElement!;
    expect(section.contains(doc.querySelector('[data-detour-id="income-row-3"]'))).toBe(true);
    expect(section.contains(intro)).toBe(true);
  });

  it("has an FAQ accordion with fake div toggles and a real h1, with no h2-h6", () => {
    const toggles = doc.querySelectorAll('[data-detour-id^="faq-toggle-"]');
    expect(toggles.length).toBeGreaterThanOrEqual(5);
    for (const t of Array.from(toggles)) {
      expect(t.tagName).toBe("DIV");
      expect(t.hasAttribute("role")).toBe(false);
      expect(t.hasAttribute("tabindex")).toBe(false);
    }
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelectorAll("h2,h3,h4,h5,h6").length).toBe(0);
  });

  it("buries a real 'Start your application' link after the FAQ", () => {
    const apply = doc.querySelector('[data-detour-id="apply-link"]')!;
    expect(apply.tagName).toBe("A");
    expect(apply.textContent?.trim()).toBe("Start your application");
    const all = Array.from(doc.querySelectorAll("*"));
    const pos = (el: Element) => all.indexOf(el);
    const lastFaq = doc.querySelector('[data-detour-id="faq-answer-6"]')!;
    expect(pos(apply)).toBeGreaterThan(pos(lastFaq));
  });

  it("has a footer with about 35 links, no <main>, no skip link", () => {
    expect(doc.querySelectorAll(".footer a").length).toBeGreaterThanOrEqual(33);
    expect(doc.querySelector("main")).toBeNull();
    expect(doc.querySelector(".skip-link")).toBeNull();
  });

  it("has a seal drawn in SVG", () => {
    expect(doc.querySelector("svg.seal")).not.toBeNull();
  });
});

describe("alpine well-built control patterns", () => {
  const doc = load("alpine");

  it("has a working skip link, a <header>, a <nav> and a <main>", () => {
    const skip = doc.querySelector("a.skip-link")!;
    expect(skip.getAttribute("href")).toBe("#main");
    expect(doc.querySelector("#main")?.tagName).toBe("MAIN");
    expect(doc.querySelector("header")).not.toBeNull();
    expect(doc.querySelector("footer")).not.toBeNull();
    const navLinks = doc.querySelectorAll("header nav.main-nav a").length;
    expect(navLinks).toBeGreaterThanOrEqual(5);
    expect(navLinks).toBeLessThanOrEqual(12);
  });

  it("uses real h2 section headings and no fake heading divs", () => {
    const h2 = Array.from(doc.querySelectorAll("main h2")).map((e) => e.textContent!.trim());
    expect(h2).toEqual(["Product details", "Customer reviews", "Shipping & returns", "You may also like"]);
    expect(doc.querySelectorAll("div.section-title").length).toBe(0);
  });

  it("has a size picker built as a radio group in a fieldset with legend and labels", () => {
    const fs_ = doc.querySelector('fieldset[data-detour-id="sizes"]')!;
    expect(fs_.querySelector("legend")).not.toBeNull();
    const radios = fs_.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(5);
    for (const r of Array.from(radios)) {
      expect(doc.querySelector(`label[for="${r.id}"]`), r.id).not.toBeNull();
    }
    expect(doc.querySelector('[data-detour-id="size-m"]')?.getAttribute("type")).toBe("radio");
  });

  it("has labelled icon buttons and a labelled search and newsletter field", () => {
    for (const id of ["cart-button", "wishlist-button"]) {
      const b = doc.querySelector(`button[data-detour-id="${id}"]`)!;
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
    expect(doc.querySelector('label[for="site-search"]')).not.toBeNull();
    expect(doc.querySelector('label[for="news-email"]')).not.toBeNull();
    expect(doc.querySelector('button[data-detour-id="add-to-cart"]')?.textContent?.trim()).toBe("Add to cart");
  });

  it("has no positive tabindex and no pointer-cursor fake controls", () => {
    for (const el of Array.from(doc.querySelectorAll("[tabindex]"))) {
      expect(Number(el.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
    }
    expect(doc.querySelectorAll("[onclick]").length).toBe(0);
  });

  it("states the 60-day return policy under the same target id as northwind", () => {
    expect(doc.querySelector('[data-detour-id="returns-body"]')?.textContent).toContain(
      "You can return unworn items within 60 days for a full refund.",
    );
  });
});
