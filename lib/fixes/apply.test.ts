import { describe, expect, it } from "vitest";
import type { FixSpec, PageModel } from "@/lib/contracts";
import { buildPage } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { applyFix, applyFixes, generateCandidates, validatePage } from "./index";
import { announceNode, buildTree } from "./graph";
import { deepFreeze } from "./testing";

const cands = generateCandidates(miniShop, miniShopTasks);
const fix = (id: string): FixSpec => {
  const f = cands.find((c) => c.id === id);
  if (!f) throw new Error(`no candidate ${id}`);
  return f;
};

describe("validatePage", () => {
  it("accepts the fixture", () => {
    expect(validatePage(miniShop)).toEqual([]);
  });

  it("reports every kind of violation", () => {
    const p: PageModel = structuredClone(miniShop);
    p.readingOrder.push("ghost");
    p.focusOrder.push("crumbs", "logo"); // not focusable, duplicate
    p.headings.push("price"); // not in headings-eligible shape
    p.landmarks.push("price");
    p.skipLinks.push({ from: "logo", to: "nowhere" });
    p.nodes["price"].announcement = "";
    p.nodes["nav-0"].children.push("phantom");
    const errs = validatePage(p).join("\n");
    expect(errs).toContain('readingOrder references unknown node "ghost"');
    expect(errs).toContain('focusOrder entry "crumbs" is not focusable');
    expect(errs).toContain('focusOrder lists "logo" twice');
    expect(errs).toContain('heading "price" has role "paragraph"');
    expect(errs).toContain('heading "price" has no valid level');
    expect(errs).toContain('landmark "price" has no landmark role');
    expect(errs).toContain('skipLink to unknown node "nowhere"');
    expect(errs).toContain('reading stop "price" has an empty announcement');
    expect(errs).toContain('node "nav-0" has unknown child "phantom"');
  });

  it("flags headings outside readingOrder, missing derived entries and broken parents", () => {
    const p: PageModel = structuredClone(miniShop);
    p.readingOrder = p.readingOrder.filter((id) => id !== "product-title");
    p.landmarks = [];
    p.nodes["logo"].parentId = "footer";
    const errs = validatePage(p).join("\n");
    expect(errs).toContain('heading "product-title" is not in readingOrder');
    expect(errs).toContain('landmark node "nav" is missing from landmarks');
    expect(errs).toContain('child "logo" of "header" has parentId "footer"');
    expect(validatePage({ ...miniShop, root: "nope" })).toEqual(['root "nope" does not exist']);
  });
});

describe("each fix applied alone", () => {
  it("promote-heading puts the node in headings, in document order, with a heading announcement", () => {
    const p = applyFix(miniShop, fix("promote-heading:reviews-title"));
    expect(validatePage(p)).toEqual([]);
    expect(p.headings).toEqual(["product-title", "reviews-title"]);
    expect(p.nodes["reviews-title"]).toMatchObject({ role: "heading", level: 2, tag: "h2", announcement: "heading, level 2, Customer reviews" });
    expect(p.nodes["reviews-title"].hints.looksLikeHeading).toBeUndefined();
    expect(p.readingOrder).toEqual(miniShop.readingOrder);

    const early = applyFix(miniShop, fix("promote-heading:size-label"));
    expect(early.headings).toEqual(["product-title", "size-label"]);
    const all = applyFixes(miniShop, ["returns-title", "size-label", "reviews-title"].map((n) => fix(`promote-heading:${n}`)));
    expect(all.headings).toEqual(["product-title", "size-label", "reviews-title", "returns-title"]);
    expect(validatePage(all)).toEqual([]);
  });

  it("skip-link adds the first reading stop, first focus stop and a skipLink to the h1", () => {
    const p = applyFix(miniShop, fix("skip-link:main"));
    expect(validatePage(p)).toEqual([]);
    expect(p.focusOrder[0]).toBe("fix-skip-link");
    expect(p.focusOrder.slice(1)).toEqual(miniShop.focusOrder);
    expect(p.readingOrder[0]).toBe("fix-skip-link");
    expect(p.readingOrder.slice(1)).toEqual(miniShop.readingOrder);
    expect(p.skipLinks).toEqual([{ from: "fix-skip-link", to: "product-title" }]);
    expect(p.nodes["fix-skip-link"]).toMatchObject({ role: "link", name: "Skip to main content", focusable: true, actionable: true, tag: "a", parentId: "root", announcement: "link, Skip to main content" });
    expect(p.nodes["root"].children[0]).toBe("fix-skip-link");
  });

  it("real-button makes every size focusable, in document position between the nav and add-to-cart", () => {
    const p = applyFix(miniShop, fix("real-button:sizes"));
    expect(validatePage(p)).toEqual([]);
    for (const s of ["xs", "s", "m", "l", "xl"]) {
      expect(p.nodes[`size-${s}`]).toMatchObject({ role: "button", focusable: true, actionable: true, tag: "button" });
      expect(p.nodes[`size-${s}`].hints.fakeButton).toBeUndefined();
    }
    const at = (id: string) => p.focusOrder.indexOf(id);
    expect(at("size-m")).toBeGreaterThan(at("sub-13")); // after the last nav link
    expect(at("size-m")).toBeLessThan(at("add-to-cart"));
    expect(p.focusOrder.slice(at("size-xs"), at("size-xl") + 1)).toEqual(["size-xs", "size-s", "size-m", "size-l", "size-xl"]);
    expect(at("size-xl") + 1).toBe(at("add-to-cart"));
    expect(p.nodes["size-m"].announcement).toBe("button, M, not pressed");
    expect(p.nodes["size-m"].states).toEqual(["not pressed"]);
    expect(p.readingOrder).toEqual(miniShop.readingOrder);
  });

  it("add-label names the control and re-announces it", () => {
    const p = applyFix(miniShop, fix("add-label:cart-icon"));
    expect(validatePage(p)).toEqual([]);
    expect(p.nodes["cart-icon"].name).toBe("Cart");
    expect(p.nodes["cart-icon"].announcement).toBe("button, Cart");
    expect(p.nodes["cart-icon"].hints.unlabeled).toBeUndefined();
    expect(p.nodes["cart-icon"].hints.visualLabel).toBe("Cart");
  });

  it("add-landmark marks main and contentinfo and re-announces the first stop in each", () => {
    const p = applyFix(miniShop, fix("add-landmark:content+footer"));
    expect(validatePage(p)).toEqual([]);
    expect(p.landmarks).toEqual(["nav", "content", "footer"]);
    expect(p.nodes["content"]).toMatchObject({ landmark: "main", role: "main", tag: "main" });
    expect(p.nodes["footer"]).toMatchObject({ landmark: "contentinfo", role: "contentinfo" });
    expect(p.nodes["crumbs"].announcement).toBe("main landmark, Home / Outerwear / Jackets");
    expect(p.nodes["foot-0"].announcement).toBe("content info landmark, list with 12 items, link, About");
    // Everything else keeps its announcement.
    expect(p.nodes["nav-0"].announcement).toBe(miniShop.nodes["nav-0"].announcement);
    expect(p.nodes["product-title"].announcement).toBe(miniShop.nodes["product-title"].announcement);
  });

  it("remove-positive-tabindex restores document order", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "a", role: "link", name: "A", tag: "a", tabIndex: 3 },
        { id: "b", role: "link", name: "B", tag: "a" },
        { id: "c", role: "link", name: "C", tag: "a", tabIndex: 1 },
        { id: "d", role: "generic", name: "D", tag: "div", focusable: true, tabIndex: 2 },
      ],
    });
    expect(page.focusOrder).toEqual(["c", "d", "a", "b"]);
    const f = generateCandidates(page).find((x) => x.kind === "remove-positive-tabindex") as FixSpec;
    const p = applyFix(page, f);
    expect(validatePage(p)).toEqual([]);
    expect(p.focusOrder).toEqual(["a", "b", "c", "d"]);
    expect(p.nodes["a"].tabIndex).toBeNull();
    expect(p.nodes["c"].tabIndex).toBeNull();
    expect(p.nodes["d"].tabIndex).toBe(0); // a div needs tabindex=0 to stay focusable
    expect(p.nodes["d"].focusable).toBe(true);
  });
});

describe("composition", () => {
  const all = applyFixes(miniShop, cands);

  it("applying every candidate yields a valid page with the expected state", () => {
    expect(validatePage(all)).toEqual([]);
    expect(all.focusOrder[0]).toBe("fix-skip-link");
    expect(all.headings).toEqual(["product-title", "size-label", "reviews-title", "returns-title"]);
    expect(all.nodes["crumbs"].announcement).toBe("main landmark, Home / Outerwear / Jackets");
    expect(all.nodes["cart-icon"].announcement).toBe("button, Cart");
  });

  it("re-announcing a stop from the tree reproduces the builder's announcements", () => {
    const tree = buildTree(miniShop);
    for (const id of miniShop.readingOrder) expect(announceNode(miniShop, tree, id)).toBe(miniShop.nodes[id].announcement);
  });

  it("landmark and heading fixes compose in either order, including when the heading is the first stop", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "nav", role: "navigation", landmark: "navigation", stop: false, hints: { repetitiveBlock: true }, children: [{ id: "n1", role: "link", name: "N", tag: "a" }] },
        {
          id: "body",
          role: "generic",
          stop: false,
          children: [
            { id: "t", role: "generic", name: "Welcome", hints: { looksLikeHeading: { fontSizeRatio: 2, fontWeight: 700, suggestedLevel: 1 } } },
            { id: "x", role: "paragraph", name: "Text" },
          ],
        },
      ],
    });
    const cs = generateCandidates(page);
    const lm = cs.find((c) => c.kind === "add-landmark") as FixSpec;
    const ph = cs.find((c) => c.kind === "promote-heading") as FixSpec;
    const ab = applyFixes(page, [lm, ph]);
    const ba = applyFixes(page, [ph, lm]);
    expect(ab).toEqual(ba);
    expect(ab.nodes["t"].announcement).toBe("main landmark, heading, level 1, Welcome");
    expect(validatePage(ab)).toEqual([]);
  });

  it("a promoted node that was not a reading stop becomes one at its document position", () => {
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "p1", role: "paragraph", name: "Before" },
        { id: "box", role: "generic", name: "", stop: false, hints: { looksLikeHeading: { fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: 3 } }, children: [{ id: "inner", role: "generic", name: "Section title", stop: false, children: [] }] },
        { id: "p2", role: "paragraph", name: "After" },
      ],
    });
    expect(page.readingOrder).toEqual(["p1", "p2"]);
    const p = applyFixes(page, generateCandidates(page));
    expect(validatePage(p)).toEqual([]);
    expect(p.readingOrder).toEqual(["p1", "box", "p2"]);
    expect(p.headings).toEqual(["box"]);
    expect(p.nodes["box"].name).toBe("Section title");
    expect(p.nodes["box"].announcement).toBe("heading, level 3, Section title");
  });
});

describe("purity and no-ops", () => {
  it("never mutates a frozen input", () => {
    const frozen = deepFreeze(structuredClone(miniShop));
    expect(() => applyFixes(frozen, cands)).not.toThrow();
    for (const c of cands) expect(() => applyFix(frozen, c)).not.toThrow();
    expect(frozen).toEqual(miniShop);
  });

  it("returns a deep copy even when the fix does nothing", () => {
    const stale: FixSpec = { ...fix("add-label:cart-icon"), targets: ["no-such-node"] };
    const p = applyFix(miniShop, stale);
    expect(p).toEqual(miniShop);
    expect(p).not.toBe(miniShop);
    expect(p.nodes).not.toBe(miniShop.nodes);
    expect(applyFix(miniShop, { ...stale, kind: "nonsense" as FixSpec["kind"] })).toEqual(miniShop);
  });

  it("applying a fix twice equals applying it once", () => {
    for (const c of cands) {
      const once = applyFix(miniShop, c);
      expect(applyFix(once, c)).toEqual(once);
    }
  });
});

