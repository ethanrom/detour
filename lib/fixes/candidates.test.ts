import { describe, expect, it } from "vitest";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { applyFixes, generateCandidates, validatePage } from "./index";

const ids = (page = miniShop, tasks = miniShopTasks) => generateCandidates(page, tasks).map((c) => c.id);

describe("generateCandidates on mini-shop", () => {
  const cands = generateCandidates(miniShop, miniShopTasks);

  it("produces exactly the expected fixes in a deterministic order", () => {
    expect(cands.map((c) => c.id)).toEqual([
      "skip-link:main",
      "promote-heading:size-label",
      "promote-heading:reviews-title",
      "promote-heading:returns-title",
      "add-landmark:content+footer",
      "add-label:cart-icon",
      "real-button:sizes",
    ]);
    expect(cands.map((c) => c.kind)).toEqual(["skip-link", "promote-heading", "promote-heading", "promote-heading", "add-landmark", "add-label", "real-button"]);
    expect(generateCandidates(miniShop, miniShopTasks)).toEqual(cands);
    expect(new Set(cands.map((c) => c.id)).size).toBe(cands.length);
  });

  it("has readable titles, one-sentence rationales, WCAG references and targets", () => {
    expect(cands.map((c) => c.title)).toEqual([
      "Add a “Skip to main content” link",
      "Make “Select a size” a level-2 heading",
      "Make “Customer reviews” a level-2 heading",
      "Make “Free returns” a level-2 heading",
      "Mark the main content and footer as landmarks",
      "Label the unlabeled button “Cart”",
      "Make the size options real buttons",
    ]);
    for (const c of cands) {
      expect(c.rationale.length).toBeGreaterThan(20);
      expect(c.rationale.trim().endsWith(".")).toBe(true);
      expect(c.rationale.split(". ").length).toBe(1);
      expect(c.wcag.length).toBeGreaterThan(0);
      expect(c.targets.length).toBeGreaterThan(0);
      for (const t of c.targets) expect(miniShop.nodes[t]).toBeDefined();
      expect(c.patch.before).not.toEqual(c.patch.after);
      expect(c.patch.selector).not.toBe("");
    }
    const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
    expect(byId["skip-link:main"].wcag).toEqual(["2.4.1 Bypass Blocks"]);
    expect(byId["promote-heading:reviews-title"].wcag).toEqual(["1.3.1 Info and Relationships", "2.4.6 Headings and Labels"]);
    expect(byId["add-landmark:content+footer"].wcag).toEqual(["1.3.1 Info and Relationships", "2.4.1 Bypass Blocks"]);
    expect(byId["add-label:cart-icon"].wcag).toEqual(["4.1.2 Name, Role, Value", "2.5.3 Label in Name"]);
    expect(byId["real-button:sizes"].wcag).toEqual(["2.1.1 Keyboard", "4.1.2 Name, Role, Value"]);
  });

  it("targets the right nodes", () => {
    const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
    expect(byId["skip-link:main"].targets).toEqual(["product-title"]);
    expect(byId["add-landmark:content+footer"].targets).toEqual(["content", "footer"]);
    expect(byId["real-button:sizes"].targets).toEqual(["size-xs", "size-s", "size-m", "size-l", "size-xl"]);
    expect(byId["add-label:cart-icon"].params).toEqual({ label: "Cart" });
    expect(byId["promote-heading:reviews-title"].params.level).toBe(2);
  });

  it("renders abbreviated before/after HTML patches", () => {
    const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
    expect(byId["promote-heading:reviews-title"].patch).toEqual({
      selector: '[data-detour-id="reviews-title"]',
      before: "<div>Customer reviews</div>",
      after: "<h2>Customer reviews</h2>",
    });
    expect(byId["add-label:cart-icon"].patch.before).toBe("<button>…</button>");
    expect(byId["add-label:cart-icon"].patch.after).toBe('<button aria-label="Cart">…</button>');
    expect(byId["real-button:sizes"].patch.before).toBe("<div>XS</div>");
    expect(byId["real-button:sizes"].patch.after).toBe('<button type="button" aria-pressed="false">XS</button>');
    const skip = byId["skip-link:main"].patch;
    expect(skip.selector).toBe("body");
    expect(skip.before.startsWith("<body>")).toBe(true);
    expect(skip.after).toContain('<body>\n  <a class="skip-link" href="#main-content">Skip to main content</a>');
    expect(skip.after).toContain('<h1 id="main-content">Trail Jacket</h1>');
    const lm = byId["add-landmark:content+footer"].patch;
    expect(lm.after).toContain("<main>…</main>");
    expect(lm.after).toContain('<footer role="contentinfo">…</footer>');
  });

  it("works without tasks", () => {
    expect(ids(miniShop, [])).toEqual(ids());
    expect(generateCandidates(miniShop).map((c) => c.id)).toEqual(ids());
  });
});

describe("generateCandidates edge cases", () => {
  const link = (id: string, name: string): Spec => ({ id, role: "link", name, tag: "a" });

  it("returns nothing for a page that is already fixed", () => {
    const fixed = applyFixes(miniShop, generateCandidates(miniShop, miniShopTasks));
    expect(validatePage(fixed)).toEqual([]);
    expect(generateCandidates(fixed, miniShopTasks)).toEqual([]);
  });

  it("skips the skip link when the page already has one or nothing precedes the content", () => {
    const withSkip = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { ...link("skip", "Skip to content"), href: "main-h" },
        { id: "nav", role: "navigation", landmark: "navigation", stop: false, hints: { repetitiveBlock: true }, children: [link("a", "A"), link("b", "B")] },
        { id: "main-h", role: "heading", level: 1, name: "Title" },
      ],
    });
    expect(withSkip.skipLinks).toHaveLength(1);
    expect(generateCandidates(withSkip).some((c) => c.kind === "skip-link")).toBe(false);

    const noBlock = buildPage({ id: "root", role: "document", stop: false, children: [{ id: "h", role: "heading", level: 1, name: "Title" }, { id: "p", role: "paragraph", name: "Hi" }] });
    expect(generateCandidates(noBlock).some((c) => c.kind === "skip-link")).toBe(false);
  });

  it("targets an existing main landmark, then the first stop after the block when there is no h1", () => {
    const withMain = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "nav", role: "navigation", landmark: "navigation", stop: false, children: [link("a", "A"), link("b", "B")] },
        { id: "main", role: "main", landmark: "main", stop: false, children: [{ id: "intro", role: "paragraph", name: "Intro" }, { id: "h", role: "heading", level: 1, name: "T" }] },
      ],
    });
    const skip = generateCandidates(withMain).find((c) => c.kind === "skip-link");
    expect(skip?.targets).toEqual(["main"]);
    expect(skip?.params.stop).toBe("intro");
    // A main landmark exists, so no add-landmark main fix.
    expect(generateCandidates(withMain).some((c) => c.kind === "add-landmark")).toBe(false);

    const noH1 = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "menu", role: "generic", stop: false, hints: { repetitiveBlock: true }, children: [link("a", "A"), link("b", "B")] },
        { id: "p", role: "paragraph", name: "Body text" },
      ],
    });
    const skip2 = generateCandidates(noH1).find((c) => c.kind === "skip-link");
    expect(skip2?.targets).toEqual(["p"]);
  });

  it("picks the main container from the h1 and task targets, with a largest-container fallback", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "top", role: "generic", tag: "header", stop: false, hints: { repetitiveBlock: true }, children: [link("home", "Home"), link("about", "About")] },
        {
          id: "wrap",
          role: "generic",
          stop: false,
          children: [
            { id: "hero", role: "generic", stop: false, children: [{ id: "title", role: "heading", level: 1, name: "Title" }] },
            { id: "body", role: "generic", stop: false, children: [{ id: "t1", role: "paragraph", name: "One" }, { id: "t2", role: "paragraph", name: "Two" }, { id: "t3", role: "paragraph", name: "Three" }] },
          ],
        },
      ],
    });
    const mainOf = (tasks: Parameters<typeof generateCandidates>[1]) => generateCandidates(page, tasks).find((c) => c.kind === "add-landmark")?.params.main;
    expect(mainOf([{ id: "t", siteId: "s", label: "x", grounding: "fixture", steps: [{ target: "t2", action: "read" }] }])).toBe("wrap");
    // No tasks: the h1's parent is used.
    expect(mainOf([])).toBe("hero");
    // Task target inside the header: the common ancestor is the root, so fall back to the largest chrome-free container.
    expect(mainOf([{ id: "t", siteId: "s", label: "x", grounding: "fixture", steps: [{ target: "home", action: "activate" }] }])).toBe("wrap");
  });

  it("never promotes controls or nodes without text to headings", () => {
    const big = { fontSizeRatio: 2, fontWeight: 700, suggestedLevel: 2 as const };
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "card-link", role: "link", name: "Big card title", tag: "a", hints: { looksLikeHeading: big } },
        { id: "empty", role: "generic", name: "", hints: { looksLikeHeading: big } },
        { id: "real", role: "generic", name: "Real one", hints: { looksLikeHeading: big } },
      ],
    });
    expect(generateCandidates(page).map((c) => c.id)).toEqual(["promote-heading:real"]);
  });

  it("groups by styleKey: one fix per component, level after the preceding heading, distinct labels only", () => {
    const h = (id: string, name: string, level: 1 | 2 | 3): Spec => ({
      id,
      role: "generic",
      name,
      hints: { styleKey: "div.section-title|24|700", className: "section-title", looksLikeHeading: { fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: level } },
    });
    const icon = (id: string, label: string): Spec => ({
      id,
      role: "button",
      name: "",
      tag: "button",
      hints: { styleKey: `button.icon-btn.icon-${id}|16|400`, className: `icon-btn icon-${id}`, unlabeled: true, visualLabel: label },
    });
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "top", role: "heading", level: 1, name: "Shop", tag: "h1" },
        h("a", "Details", 1),
        h("b", "Reviews", 1),
        h("c", "Returns", 2),
        { id: "lone", role: "generic", name: "Other", hints: { looksLikeHeading: { fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: 3 } } },
        icon("search", "search"),
        icon("cart", "cart"),
        icon("dup1", "Menu"),
        icon("dup2", "menu"),
      ],
    });
    const cands = generateCandidates(page);
    const group = cands.find((c) => c.kind === "promote-heading" && c.targets.length > 1);
    expect(group?.targets).toEqual(["a", "b", "c"]);
    expect(group?.title).toBe("Make the 3 “section-title” blocks real <h2> headings");
    expect(group?.params.level).toBe(2); // most common level is 1, but after the h1 it cannot be higher than h2
    expect(group?.patch).toEqual({ selector: "div.section-title", before: '<div class="section-title">Details</div>', after: '<h2 class="section-title">Details</h2>' });
    // No styleKey: per-node fallback, level from the node itself.
    expect(cands.find((c) => c.id === "promote-heading:lone")?.params.level).toBe(3);
    // Labels: icon-btn variants are one component; the two "Menu" buttons collide and are left out.
    const labels = cands.find((c) => c.kind === "add-label");
    expect(labels?.targets).toEqual(["search", "cart"]);
    expect(labels?.title).toBe("Label the 2 unlabeled “icon-btn” buttons: “Search” and “Cart”");
    expect(labels?.params).toMatchObject({ "label:search": "Search", "label:cart": "Cart" });
    const out = applyFixes(page, cands);
    expect(validatePage(out)).toEqual([]);
    expect(out.nodes["b"].announcement).toBe("heading, level 2, Reviews");
    expect(out.nodes["cart"].name).toBe("Cart");
    expect(out.nodes["dup1"].name).toBe("");
  });

  it("offers a content-info-only landmark fix when main already exists", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "main", role: "main", landmark: "main", stop: false, children: [{ id: "h", role: "heading", level: 1, name: "T" }] },
        { id: "foot", role: "generic", tag: "footer", stop: false, hints: { repetitiveBlock: true }, children: [link("f1", "Terms"), link("f2", "Privacy")] },
      ],
    });
    const lm = generateCandidates(page).filter((c) => c.kind === "add-landmark");
    expect(lm).toHaveLength(1);
    expect(lm[0].id).toBe("add-landmark:foot");
    expect(lm[0].title).toBe("Mark the footer as a content info landmark");
    expect(lm[0].params).toEqual({ contentinfo: "foot" });
  });

  it("covers remove-positive-tabindex, unlabeled controls without a visual label, and fake-button groups", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "a", role: "link", name: "A", tag: "a", tabIndex: 3 },
        { id: "b", role: "link", name: "B", tag: "a" },
        { id: "c", role: "link", name: "C", tag: "a", tabIndex: 1 },
        { id: "icon", role: "button", name: "", tag: "button", hints: { unlabeled: true, visualLabel: "" } },
        { id: "wish", role: "generic", name: "Add to wishlist", focusable: false, actionable: true, hints: { fakeButton: true } },
      ],
    });
    const cands = generateCandidates(page);
    expect(cands.map((c) => c.id)).toEqual(["real-button:root", "remove-positive-tabindex"]);
    const tab = cands.find((c) => c.kind === "remove-positive-tabindex");
    expect(tab?.title).toBe("Remove positive tabindex from 2 elements");
    expect(tab?.targets).toEqual(["a", "c"]);
    expect(tab?.wcag).toEqual(["2.4.3 Focus Order"]);
    const rb = cands[0];
    expect(rb.title).toBe("Make “Add to wishlist” a real button");
    expect(rb.params.pressed).toBe(false);
    expect(rb.patch.after).toBe('<button type="button">Add to wishlist</button>');
  });
});
