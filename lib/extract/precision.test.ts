// @vitest-environment jsdom
// Precision rules found by running the extractor on the real demo sites.
import { describe, expect, it } from "vitest";
import { byId, pageFrom } from "./testing";

const BODY = "<style>body{font-size:16px}</style>";
const BIG = "font-size:32px;font-weight:800";

describe("looksLikeHeading ignores figures", () => {
  const flagged = (text: string, style = BIG) => {
    const p = pageFrom(`${BODY}<div style="${style}" data-detour-id="x">${text}</div>`);
    return !!byId(p, "x").hints.looksLikeHeading;
  };

  it("excludes prices, ratings, statistics and durations", () => {
    for (const t of ["$189.00", "4.7", "42,300", "$238", "3 days", "€45", "£9.99", "₹499", "2024 results", "100%"]) expect(flagged(t), t).toBe(false);
  });

  it("excludes text with fewer than 2 letters or under 50% letters", () => {
    expect(flagged("A")).toBe(false);
    expect(flagged("-- 12 34 56 ab --")).toBe(false);
    expect(flagged("★★★★★")).toBe(false);
    expect(flagged("Q4")).toBe(false); // starts with a letter but only 1 letter
    expect(flagged("Ab 12")).toBe(true); // 2 letters, exactly half of the non-space characters
  });

  it("keeps real section titles and bold review titles", () => {
    expect(flagged("Customer reviews")).toBe(true);
    expect(flagged("Packs down to nothing", "font-size:18px;font-weight:700")).toBe(true);
    expect(flagged("Get 10% off your first order")).toBe(true);
  });
});

describe("visualLabel for groups of unlabeled controls", () => {
  it("reads data-* names (colour, name, label, value, network) before any nearby text", () => {
    const p = pageFrom(`
      <div class="opt">Colour: Forest</div>
      <div class="swatches">
        <div style="cursor:pointer" data-colour="Forest" data-detour-id="a"></div>
        <div style="cursor:pointer" data-colour="Ember" data-detour-id="b"></div>
        <div style="cursor:pointer" data-color="Glacier" data-detour-id="c"></div>
      </div>
      <a href="#" data-network="instagram" data-detour-id="n"></a>
      <button data-label="Compare" data-detour-id="l"></button>
      <button data-value="42" data-detour-id="num"></button>`);
    expect(["a", "b", "c"].map((id) => byId(p, id).hints.visualLabel)).toEqual(["Forest", "Ember", "Glacier"]);
    expect(byId(p, "n").hints.visualLabel).toBe("instagram");
    expect(byId(p, "l").hints.visualLabel).toBe("Compare");
    expect(byId(p, "num").hints.visualLabel).toBe(""); // a bare number is not a label
  });

  it("reads icon class tokens: icon-heart, ico-, i-, fa- prefixes", () => {
    const p = pageFrom(`
      <div class="cta"><button data-detour-id="add">Add</button><div style="cursor:pointer" class="btn-wish icon-heart" data-detour-id="a"></div></div>
      <div class="social">
        <a href="#" class="icon-instagram" data-detour-id="b"></a>
        <a href="#" class="ico-facebook" data-detour-id="c"></a>
        <a href="#" class="i-youtube" data-detour-id="d"></a>
        <a href="#" data-detour-id="e"><i class="fa-brands fa-x-twitter"></i></a>
      </div>`);
    expect(["a", "b", "c", "d", "e"].map((id) => byId(p, id).hints.visualLabel)).toEqual(["heart", "instagram", "facebook", "youtube", "x twitter"]);
  });

  it("does not borrow text from another parent or from a group of controls", () => {
    const p = pageFrom(`
      <div class="sizes"><div style="cursor:pointer">XS</div><div style="cursor:pointer">S</div><div style="cursor:pointer">M</div></div>
      <div class="cta"><button>Add to cart</button><div style="cursor:pointer" data-detour-id="wish"></div></div>
      <div class="f-title">Follow us</div>
      <div class="social"><a href="#" data-detour-id="s1"></a><a href="#" data-detour-id="s2"></a></div>
      <div class="opt"><span>Colour: Forest</span></div>
      <div class="swatches"><div style="cursor:pointer" data-detour-id="sw"></div></div>`);
    for (const id of ["wish", "s1", "s2", "sw"]) expect(byId(p, id).hints.visualLabel, id).toBe("");
  });

  it("does not use a preceding sibling that holds several elements", () => {
    const p = pageFrom(`<div><div class="sizes"><b>XS</b><b>S</b><b>M</b></div><button data-detour-id="wish"></button></div>`);
    expect(byId(p, "wish").hints.visualLabel).toBe("");
  });

  it("uses nearby sibling text for a single unlabeled control in the same parent", () => {
    const p = pageFrom(`<div><span>Quantity</span> <input type="text" data-detour-id="q"></div>`);
    expect(byId(p, "q").hints.visualLabel).toBe("Quantity");
  });

  it("drops nearby text shared by several unlabeled controls in the same parent", () => {
    const p = pageFrom(`<div><span>Quantity</span> <input type="text" data-detour-id="a"> <input type="text" data-detour-id="b"></div>
      <div><span>Name</span> <input type="text" data-detour-id="c"></div>`);
    expect(byId(p, "a").hints.visualLabel).toBe("");
    expect(byId(p, "b").hints.visualLabel).toBe("");
    expect(byId(p, "c").hints.visualLabel).toBe("Name");
  });

  it("reads data-view for thumbnail-style controls", () => {
    const p = pageFrom(`<div style="cursor:pointer" data-view="back" data-detour-id="v"></div>`);
    expect(byId(p, "v").hints.visualLabel).toBe("back");
  });
});

describe("className and styleKey hints", () => {
  const html = `${BODY}<style>.section-title{font-size:24px;font-weight:700}.size-opt{cursor:pointer;font-weight:600}</style>
    <div class="section-title" data-detour-id="t1">Product details</div>
    <div class="section-title" data-detour-id="t2">Customer reviews</div>
    <div class="  title-b   section-title" data-detour-id="t3">Related items</div>
    <div style="font-size:24px;font-weight:700" data-detour-id="t4">No classes here</div>
    <div class="size-opt" data-detour-id="s1">XS</div>
    <button class="icon-btn icon-cart" data-detour-id="cart"></button>
    <p class="lead" data-detour-id="plain">Plain paragraph</p>
    <button class="primary" data-detour-id="named">Buy</button>`;

  it("sets className and styleKey on nodes with looksLikeHeading, fakeButton or unlabeled", () => {
    const p = pageFrom(html);
    expect(byId(p, "t1").hints).toMatchObject({ className: "section-title", styleKey: "div.section-title|24|700" });
    expect(byId(p, "s1").hints).toMatchObject({ className: "size-opt", styleKey: "div.size-opt|16|600", fakeButton: true });
    expect(byId(p, "cart").hints).toMatchObject({ className: "icon-btn icon-cart", styleKey: "button.icon-btn.icon-cart|16|400" });
  });

  it("gives the same styleKey to nodes of one component and different ones otherwise", () => {
    const p = pageFrom(html);
    expect(byId(p, "t2").hints.styleKey).toBe(byId(p, "t1").hints.styleKey);
    expect(byId(p, "t3").hints.styleKey).toBe("div.section-title.title-b|24|700"); // sorted classes
    expect(byId(p, "t3").hints.styleKey).not.toBe(byId(p, "t1").hints.styleKey);
  });

  it("uses an empty className and a tag-only key when there are no classes", () => {
    const p = pageFrom(html);
    expect(byId(p, "t4").hints).toMatchObject({ className: "", styleKey: "div|24|700" });
  });

  it("leaves unhinted nodes alone", () => {
    const p = pageFrom(html);
    expect(byId(p, "plain").hints).toEqual({});
    expect(byId(p, "named").hints).toEqual({});
  });
});
