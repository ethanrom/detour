// @vitest-environment jsdom
// A realistic, inaccessible product page. Its extracted model must have the same shape as
// fixtures/pagemodels/mini-shop.ts (the hand-built model the engine and fixes tests rely on).
import { describe, expect, it } from "vitest";
import { miniShop } from "@/fixtures/pagemodels/mini-shop";
import { extractPage } from "./index";
import { byId, docFromFull } from "./testing";

const navCats = ["Men", "Women", "Kids", "Outerwear", "Footwear", "Packs", "Camp", "Climb", "Run", "Sale"];
const subLinks = ["New arrivals", "Best sellers", "Jackets", "Fleece", "Rain gear", "Base layers", "Hats", "Gloves", "Socks", "Gift cards", "Repairs", "Stores", "Blog", "Help"];
const footLinks = ["About", "Careers", "Press", "Sustainability", "Returns", "Shipping", "Warranty", "Contact", "Privacy", "Terms", "Accessibility", "Sitemap"];

const li = (id: string, text: string) => `<li><a href="/${id}" data-detour-id="${id}">${text}</a></li>`;

const HTML = `<!doctype html>
<html lang="en"><head><title>Trail Jacket | Northwind Outfitters</title>
<style>
  body { font-size: 16px; font-family: sans-serif; }
  .size { display: inline-block; width: 48px; height: 48px; cursor: pointer; }
  .label { font-size: 20.8px; font-weight: 700; }
  .section-title { font-size: 25.6px; font-weight: 700; }
  .icon-btn { border: 0; background: none; }
  ul { list-style: none; }
</style></head>
<body>
  <header>
    <a href="/" data-detour-id="logo">Northwind Outfitters home</a>
    <input type="text" aria-label="Search" data-detour-id="search">
    <button class="icon-btn" data-detour-id="cart-icon"><i class="icon-cart"></i></button>
    <nav data-detour-id="nav">
      <ul data-detour-id="nav-list">
        ${navCats.map((c, i) => li(`nav-${i}`, c)).join("\n")}
        ${subLinks.map((c, i) => li(`sub-${i}`, c)).join("\n")}
      </ul>
    </nav>
  </header>
  <div data-detour-id="content">
    <p data-detour-id="crumbs">Home / Outerwear / Jackets</p>
    <h1 data-detour-id="product-title">Trail Jacket</h1>
    <p data-detour-id="price">$189.00</p>
    <p data-detour-id="desc">A packable, waterproof shell with taped seams, pit zips and an adjustable hood for changing mountain weather.</p>
    <div class="label" data-detour-id="size-label">Select a size</div>
    <div data-detour-id="sizes">
      ${["XS", "S", "M", "L", "XL"].map((s) => `<div class="size" data-detour-id="size-${s.toLowerCase()}">${s}</div>`).join("\n")}
    </div>
    <button data-detour-id="add-to-cart">Add to cart</button>
    <div class="section-title" data-detour-id="reviews-title">Customer reviews</div>
    <p data-detour-id="review-1">Kept me dry on a three-day trek in Patagonia. Runs slightly large.</p>
    <p data-detour-id="review-2">Great pit zips, but the hood is tight with a helmet.</p>
    <div class="section-title" data-detour-id="returns-title">Free returns</div>
    <p data-detour-id="returns-body">Return unworn items within 60 days for a full refund.</p>
  </div>
  <footer data-detour-id="footer">
    <ul data-detour-id="foot-list">
      ${footLinks.map((c, i) => li(`foot-${i}`, c)).join("\n")}
    </ul>
  </footer>
</body></html>`;

const page = extractPage(docFromFull(HTML), { url: "https://shop.example/trail-jacket" });

describe("mini product page", () => {
  it("has the same reading order and focus order as the mini-shop fixture, minus the div sizes in focus", () => {
    expect(page.readingOrder).toEqual(miniShop.readingOrder);
    expect(page.focusOrder).toEqual(miniShop.focusOrder);
    expect(page.focusOrder[0]).toBe("logo");
    for (const s of ["xs", "s", "m", "l", "xl"]) {
      expect(page.focusOrder).not.toContain(`size-${s}`);
      expect(page.readingOrder).toContain(`size-${s}`);
    }
  });

  it("has the fixture's headings and the page's landmarks", () => {
    expect(page.headings).toEqual(miniShop.headings);
    expect(page.headings).toEqual(["product-title"]);
    expect(page.landmarks).toEqual(["n1", "nav", "footer"]);
    expect(page.nodes.n1).toMatchObject({ role: "banner", tag: "header" });
    expect(page.nodes.footer).toMatchObject({ role: "contentinfo" });
    expect(page.skipLinks).toEqual([]);
    expect(page.title).toBe("Trail Jacket | Northwind Outfitters");
    expect(page.url).toBe("https://shop.example/trail-jacket");
  });

  it("matches the fixture's role, name, tag and key hints on every shared stop", () => {
    for (const id of miniShop.readingOrder) {
      const want = miniShop.nodes[id];
      const got = byId(page, id);
      expect(got.role, id).toBe(want.role);
      expect(got.tag, id).toBe(want.tag);
      expect(got.actionable, id).toBe(want.actionable);
      expect(got.focusable, id).toBe(want.focusable);
      expect(!!got.hints.fakeButton, id).toBe(!!want.hints.fakeButton);
      expect(!!got.hints.unlabeled, id).toBe(!!want.hints.unlabeled);
      // The fixture hand-assigns level 2 to size-label (ratio 1.3); the spec's rule (>= 1.25 -> 3) gives 3.
      if (id !== "size-label") expect(got.hints.looksLikeHeading?.suggestedLevel, id).toBe(want.hints.looksLikeHeading?.suggestedLevel);
      else expect(!!got.hints.looksLikeHeading, id).toBe(true);
      if (!want.hints.unlabeled) expect(got.name, id).toBe(want.name);
    }
  });

  it("matches the fixture's announcements except where it adds banner/content-info landmarks", () => {
    const differs = new Set(["logo", "foot-0"]);
    for (const id of miniShop.readingOrder) {
      if (differs.has(id)) continue;
      expect(byId(page, id).announcement, id).toBe(miniShop.nodes[id].announcement);
    }
    expect(byId(page, "nav-0").announcement).toBe("navigation landmark, list with 24 items, link, Men");
    expect(byId(page, "logo").announcement).toBe("banner landmark, link, Northwind Outfitters home");
    expect(byId(page, "foot-0").announcement).toBe("content info landmark, list with 12 items, link, About");
    expect(byId(page, "size-m").announcement).toBe("clickable, M");
    expect(byId(page, "cart-icon").announcement).toBe("button");
  });

  it("flags the fake buttons, fake headings, unlabeled icon button and repetitive blocks", () => {
    for (const s of ["xs", "s", "m", "l", "xl"]) {
      expect(byId(page, `size-${s}`)).toMatchObject({ actionable: true, focusable: false, hints: { fakeButton: true } });
    }
    expect(byId(page, "size-label").hints.looksLikeHeading).toMatchObject({ fontSizeRatio: 1.3, fontWeight: 700, suggestedLevel: 3 });
    expect(byId(page, "reviews-title").hints.looksLikeHeading).toMatchObject({ fontSizeRatio: 1.6, suggestedLevel: 2 });
    expect(byId(page, "returns-title").hints.looksLikeHeading).toMatchObject({ suggestedLevel: 2 });
    expect(byId(page, "cart-icon").hints).toMatchObject({ unlabeled: true, visualLabel: "cart" });
    expect(byId(page, "nav").hints.repetitiveBlock).toBe(true);
    expect(byId(page, "footer").hints.repetitiveBlock).toBe(true);
    expect(byId(page, "n1").hints.repetitiveBlock).toBe(true); // header wraps the 24-link nav
    expect(byId(page, "content").hints.repetitiveBlock).toBeUndefined();
  });

  it("keeps the size picker grouped under one container", () => {
    expect(byId(page, "sizes").children).toEqual(["size-xs", "size-s", "size-m", "size-l", "size-xl"]);
    expect(byId(page, "size-m").parentId).toBe("sizes");
    expect(byId(page, "sizes").parentId).toBe("content");
    expect(byId(page, "nav-list")).toMatchObject({ role: "list" });
    expect(byId(page, "nav-list").children).toHaveLength(24);
  });
});
