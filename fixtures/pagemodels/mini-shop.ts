// A small, realistically inaccessible product page: 24-link nav with no skip link, fake section
// headings, a div-based size picker (not keyboard reachable), an unlabeled icon button, and a footer.

import type { PageModel } from "@/lib/contracts";
import type { Task } from "@/lib/contracts";
import { buildPage, type Spec } from "./builder";

const navCats = ["Men", "Women", "Kids", "Outerwear", "Footwear", "Packs", "Camp", "Climb", "Run", "Sale"];
const navLinks: Spec[] = [];
navCats.forEach((c, i) => {
  navLinks.push({ id: `nav-${i}`, role: "link", name: c, tag: "a", rect: { x: 40 + i * 110, y: 70, w: 90, h: 32 } });
});
const subLinks = ["New arrivals", "Best sellers", "Jackets", "Fleece", "Rain gear", "Base layers", "Hats", "Gloves", "Socks", "Gift cards", "Repairs", "Stores", "Blog", "Help"];
subLinks.forEach((c, i) => {
  navLinks.push({ id: `sub-${i}`, role: "link", name: c, tag: "a", rect: { x: 40 + (i % 7) * 160, y: 110 + Math.floor(i / 7) * 28, w: 140, h: 24 } });
});

const footerLinks: Spec[] = ["About", "Careers", "Press", "Sustainability", "Returns", "Shipping", "Warranty", "Contact", "Privacy", "Terms", "Accessibility", "Sitemap"].map(
  (c, i) => ({ id: `foot-${i}`, role: "link", name: c, tag: "a", rect: { x: 40 + (i % 4) * 200, y: 1900 + Math.floor(i / 4) * 28, w: 160, h: 24 } }),
);

const sizes = ["XS", "S", "M", "L", "XL"].map(
  (s, i): Spec => ({
    id: `size-${s.toLowerCase()}`,
    role: "generic",
    name: s,
    tag: "div",
    focusable: false,
    actionable: true,
    rect: { x: 760 + i * 56, y: 520, w: 48, h: 48 },
    hints: { fakeButton: true },
  }),
);

const root: Spec = {
  id: "root",
  role: "document",
  stop: false,
  children: [
    {
      id: "header",
      role: "generic",
      tag: "header",
      stop: false,
      children: [
        { id: "logo", role: "link", name: "Northwind Outfitters home", tag: "a", rect: { x: 40, y: 16, w: 180, h: 40 } },
        { id: "search", role: "textbox", name: "Search", tag: "input", rect: { x: 520, y: 18, w: 320, h: 36 } },
        {
          id: "cart-icon",
          role: "button",
          name: "",
          tag: "button",
          rect: { x: 1180, y: 18, w: 40, h: 40 },
          hints: { unlabeled: true, visualLabel: "Cart" },
        },
        { id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, hints: { repetitiveBlock: true }, children: [{ id: "nav-list", role: "list", tag: "ul", stop: false, children: navLinks }] },
      ],
    },
    {
      id: "content",
      role: "generic",
      tag: "div",
      stop: false,
      children: [
        { id: "crumbs", role: "paragraph", name: "Home / Outerwear / Jackets", tag: "p", rect: { x: 40, y: 200, w: 400, h: 20 } },
        { id: "product-title", role: "heading", level: 1, name: "Trail Jacket", tag: "h1", rect: { x: 760, y: 240, w: 400, h: 48 } },
        { id: "price", role: "paragraph", name: "$189.00", tag: "p", rect: { x: 760, y: 300, w: 120, h: 28 } },
        { id: "desc", role: "paragraph", name: "A packable, waterproof shell with taped seams, pit zips and an adjustable hood for changing mountain weather.", tag: "p", rect: { x: 760, y: 340, w: 440, h: 80 } },
        {
          id: "size-label",
          role: "generic",
          name: "Select a size",
          tag: "div",
          rect: { x: 760, y: 480, w: 200, h: 28 },
          hints: { looksLikeHeading: { fontSizeRatio: 1.3, fontWeight: 700, suggestedLevel: 2 } },
        },
        { id: "sizes", role: "generic", tag: "div", stop: false, children: sizes },
        { id: "add-to-cart", role: "button", name: "Add to cart", tag: "button", rect: { x: 760, y: 600, w: 300, h: 52 } },
        {
          id: "reviews-title",
          role: "generic",
          name: "Customer reviews",
          tag: "div",
          rect: { x: 40, y: 900, w: 300, h: 36 },
          hints: { looksLikeHeading: { fontSizeRatio: 1.6, fontWeight: 700, suggestedLevel: 2 } },
        },
        { id: "review-1", role: "paragraph", name: "Kept me dry on a three-day trek in Patagonia. Runs slightly large.", tag: "p", rect: { x: 40, y: 950, w: 700, h: 48 } },
        { id: "review-2", role: "paragraph", name: "Great pit zips, but the hood is tight with a helmet.", tag: "p", rect: { x: 40, y: 1010, w: 700, h: 48 } },
        {
          id: "returns-title",
          role: "generic",
          name: "Free returns",
          tag: "div",
          rect: { x: 40, y: 1200, w: 300, h: 36 },
          hints: { looksLikeHeading: { fontSizeRatio: 1.6, fontWeight: 700, suggestedLevel: 2 } },
        },
        { id: "returns-body", role: "paragraph", name: "Return unworn items within 60 days for a full refund.", tag: "p", rect: { x: 40, y: 1250, w: 700, h: 24 } },
      ],
    },
    {
      id: "footer",
      role: "generic",
      tag: "footer",
      stop: false,
      hints: { repetitiveBlock: true },
      children: [{ id: "foot-list", role: "list", tag: "ul", stop: false, children: footerLinks }],
    },
  ],
};

export const miniShop: PageModel = buildPage(root, { url: "fixture://mini-shop", title: "Trail Jacket | Northwind Outfitters" });

export const miniShopTasks: Task[] = [
  {
    id: "buy-m",
    siteId: "mini-shop",
    label: "Add the Trail Jacket in size M to the cart",
    grounding: "fixture",
    steps: [
      { target: "size-m", action: "select", note: "Choose size M" },
      { target: "add-to-cart", action: "activate", note: "Press Add to cart" },
    ],
  },
  {
    id: "returns",
    siteId: "mini-shop",
    label: "Find out how long you have to return it",
    grounding: "fixture",
    steps: [{ target: "returns-body", action: "read", note: "Read the returns policy" }],
  },
];
