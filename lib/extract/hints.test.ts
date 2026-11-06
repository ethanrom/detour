// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPage } from "./index";
import { byId, docFrom, pageFrom, stops } from "./testing";

const BODY = "<style>body{font-size:16px}</style>";

describe("looksLikeHeading", () => {
  const hint = (style: string, text = "Customer reviews", tag = "div") => {
    const p = pageFrom(`${BODY}<${tag} style="${style}" data-detour-id="x">${text}</${tag}>`);
    return byId(p, "x").hints.looksLikeHeading;
  };

  it("flags large bold text with the suggested level", () => {
    expect(hint("font-size:24px;font-weight:700")).toEqual({ fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: 2 });
    expect(hint("font-size:32px;font-weight:700")).toMatchObject({ fontSizeRatio: 2, suggestedLevel: 1 });
    expect(hint("font-size:40px")).toMatchObject({ fontSizeRatio: 2.5, fontWeight: 400, suggestedLevel: 1 });
  });

  it("uses the thresholds: ratio >= 1.25, or bold with ratio >= 1.1", () => {
    expect(hint("font-size:20px")).toMatchObject({ fontSizeRatio: 1.25, suggestedLevel: 3 });
    expect(hint("font-size:19.9px")).toBeUndefined();
    expect(hint("font-size:18px;font-weight:600")).toMatchObject({ suggestedLevel: 4 });
    expect(hint("font-size:18px;font-weight:500")).toBeUndefined();
    expect(hint("font-size:17px;font-weight:700")).toBeUndefined(); // ratio 1.0625 < 1.1
    expect(hint("font-size:16px;font-weight:700")).toBeUndefined();
    expect(hint("font-size:24px", "x".repeat(81))).toBeUndefined();
    expect(hint("font-size:24px", "x".repeat(80))).toBeDefined();
  });

  it("maps ratios to levels 1/2/3/4 at 2.0, 1.5, 1.25", () => {
    const level = (px: number) => hint(`font-size:${px}px;font-weight:700`)?.suggestedLevel;
    expect([level(32), level(31), level(24), level(23), level(20), level(18)]).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it("reads the style of a single styled child and resolves relative units", () => {
    const p = pageFrom(`${BODY}<div data-detour-id="a"><span style="font-size:1.5em;font-weight:bold">Big span</span></div>
      <div data-detour-id="b" style="font-size:150%">Percent</div>`);
    expect(byId(p, "a").hints.looksLikeHeading).toMatchObject({ fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: 2 });
    expect(byId(p, "b").hints.looksLikeHeading).toMatchObject({ fontSizeRatio: 1.5 });
  });

  it("does not flag real headings, controls, links or long mixed content", () => {
    const p = pageFrom(`${BODY}
      <h2 style="font-size:32px" data-detour-id="h">Real heading</h2>
      <button style="font-size:32px;font-weight:700" data-detour-id="b">Big button</button>
      <a href="/x" style="font-size:32px" data-detour-id="l">Big link</a>
      <div style="font-size:32px;font-weight:700" data-detour-id="m">Big text with <a href="/y">a link</a></div>
      <p data-detour-id="plain">Normal paragraph</p>`);
    expect(byId(p, "h").hints.looksLikeHeading).toBeUndefined();
    expect(byId(p, "b").hints.looksLikeHeading).toBeUndefined();
    expect(byId(p, "l").hints.looksLikeHeading).toBeUndefined();
    expect(byId(p, "plain").hints.looksLikeHeading).toBeUndefined();
    for (const id of byId(p, "m").children) expect(p.nodes[id].hints.looksLikeHeading).toBeUndefined();
  });

  it("keeps the node a plain text stop (not a heading)", () => {
    const p = pageFrom(`${BODY}<div style="font-size:24px;font-weight:700" data-detour-id="x">Select a size</div>`);
    expect(byId(p, "x")).toMatchObject({ role: "generic", name: "Select a size" });
    expect(p.headings).toEqual([]);
    expect(p.readingOrder).toEqual(["x"]);
  });
});

describe("fakeButton", () => {
  it("flags cursor:pointer elements without a role or tabindex as reading stops that are not focusable", () => {
    const p = pageFrom(`<style>.size{cursor:pointer}</style><div class="size" data-detour-id="m">M</div>`);
    expect(byId(p, "m")).toMatchObject({
      role: "generic",
      name: "M",
      actionable: true,
      focusable: false,
      tabIndex: null,
      announcement: "clickable, M",
      hints: { fakeButton: true },
    });
    expect(p.readingOrder).toEqual(["m"]);
    expect(p.focusOrder).toEqual([]);
  });

  it("flags elements with an onclick attribute", () => {
    const p = pageFrom(`<span onclick="go()" data-detour-id="s">Go</span><div onclick="x()" data-detour-id="d">Div</div>`);
    expect(byId(p, "s").hints.fakeButton).toBe(true);
    expect(byId(p, "d").hints.fakeButton).toBe(true);
  });

  it("detects an onclick property handler, but addEventListener alone is only visible through the pointer cursor", () => {
    const doc = docFrom(`<div data-detour-id="prop">Prop</div><div data-detour-id="listener">Listener</div><div style="cursor:pointer" data-detour-id="both">Both</div>`);
    (doc.querySelector('[data-detour-id="prop"]') as HTMLElement).onclick = () => {};
    doc.querySelector('[data-detour-id="listener"]')!.addEventListener("click", () => {});
    doc.querySelector('[data-detour-id="both"]')!.addEventListener("click", () => {});
    const p = extractPage(doc);
    expect(byId(p, "prop").hints.fakeButton).toBe(true);
    expect(byId(p, "listener").hints.fakeButton).toBeUndefined();
    expect(byId(p, "both").hints.fakeButton).toBe(true);
  });

  it("does not flag real controls or elements that are focusable by tabindex", () => {
    const p = pageFrom(`<style>*{cursor:default} .p{cursor:pointer}</style>
      <button class="p" data-detour-id="b">Real</button>
      <a class="p" href="/x" data-detour-id="a">Link</a>
      <div class="p" role="button" tabindex="0" data-detour-id="rb">Aria button</div>
      <div class="p" tabindex="0" data-detour-id="ti">Focusable div</div>
      <label class="p" data-detour-id="lb">Label</label>
      <p data-detour-id="plain">Plain</p>`);
    for (const id of ["b", "a", "rb", "ti", "lb", "plain"]) expect(byId(p, id).hints.fakeButton).toBeUndefined();
    expect(byId(p, "rb")).toMatchObject({ role: "button", focusable: true });
  });

  it("does not repeat the hint for descendants that inherit the pointer cursor", () => {
    const p = pageFrom(`<style>.card{cursor:pointer}</style><div class="card" data-detour-id="c"><span>Add</span> <b>now</b></div>`);
    expect(p.readingOrder).toEqual(["c"]);
    expect(byId(p, "c").name).toBe("Add now");
    expect(byId(p, "c").children).toEqual([]);
  });

  it("does not turn a wrapper around real controls or headings into a fake button", () => {
    const p = pageFrom(`<style>.card{cursor:pointer}</style>
      <div class="card" data-detour-id="c"><h3 data-detour-id="h">Title</h3><a href="/p" data-detour-id="l">Buy</a></div>`);
    expect(byId(p, "c").hints.fakeButton).toBeUndefined();
    expect(p.readingOrder).toEqual(["h", "l"]);
  });

  it("splits inline fake buttons out of the surrounding text", () => {
    const p = pageFrom(`<p>Pick <span style="cursor:pointer" data-detour-id="s">red</span> or blue</p>`);
    expect(stops(p)).toEqual(["text:Pick", "generic:red", "text:or blue"]);
    expect(byId(p, "s").hints.fakeButton).toBe(true);
  });

  it("flags a clickable image with alt text", () => {
    const p = pageFrom(`<img alt="Thumbnail 2" onclick="show(2)" data-detour-id="i">`);
    expect(byId(p, "i")).toMatchObject({ role: "img", actionable: true, focusable: false, hints: { fakeButton: true } });
  });
});

describe("unlabeled and visualLabel", () => {
  it("labels an icon button from an svg <title> when the name algorithm ignores it", () => {
    const p = pageFrom(`<button data-detour-id="b"><svg aria-hidden="true" focusable="false"><title>Cart</title><path d="M0 0"/></svg></button>`);
    expect(byId(p, "b")).toMatchObject({ name: "", announcement: "button", hints: { unlabeled: true, visualLabel: "Cart" } });
  });

  it("labels an icon button from the icon class name", () => {
    const p = pageFrom(`
      <button data-detour-id="a"><i class="icon-cart"></i></button>
      <button data-detour-id="b" class="btn"><span class="fa fa-solid fa-magnifying-glass"></span></button>
      <a href="/menu" data-detour-id="c"><i class="menu-icon"></i></a>`);
    expect(byId(p, "a").hints).toMatchObject({ unlabeled: true, visualLabel: "cart" });
    expect(byId(p, "b").hints).toMatchObject({ unlabeled: true, visualLabel: "magnifying glass" });
    expect(byId(p, "c").hints).toMatchObject({ unlabeled: true, visualLabel: "menu" });
  });

  it("falls back to data-icon, svg <use> reference, image file name, then nearby text", () => {
    const p = pageFrom(`
      <button data-detour-id="a" data-icon="heart"></button>
      <button data-detour-id="b"><svg aria-hidden="true"><use href="sprite.svg#icon-bell"/></svg></button>
      <a href="/c" data-detour-id="c"><img src="/img/wishlist.svg" alt=""></a>
      <span>Quantity</span> <input type="text" data-detour-id="d">`);
    expect(byId(p, "a").hints.visualLabel).toBe("heart");
    expect(byId(p, "b").hints.visualLabel).toBe("bell");
    expect(byId(p, "c").hints.visualLabel).toBe("wishlist");
    expect(byId(p, "d")).toMatchObject({ hints: { unlabeled: true, visualLabel: "Quantity" } });
  });

  it("uses an empty visualLabel when nothing is found", () => {
    const p = pageFrom(`<button data-detour-id="a"></button>`);
    expect(byId(p, "a").hints).toMatchObject({ unlabeled: true, visualLabel: "" });
  });

  it("does not flag controls that have a name (including title and placeholder)", () => {
    const p = pageFrom(`
      <button data-detour-id="a">Buy</button>
      <button data-detour-id="b" title="Close"></button>
      <input data-detour-id="c" aria-label="Email">
      <input data-detour-id="d" placeholder="Search products">
      <a href="/x" data-detour-id="e"><img alt="Home"></a>`);
    for (const id of ["a", "b", "c", "d", "e"]) expect(byId(p, id).hints.unlabeled).toBeUndefined();
    expect(byId(p, "d").name).toBe("Search products");
  });

  it("flags links, buttons and fields without any name", () => {
    const p = pageFrom(`<a href="/x" data-detour-id="a"></a><select data-detour-id="s"><option>1</option></select><div role="button" tabindex="0" data-detour-id="r"></div>`);
    for (const id of ["a", "s", "r"]) expect(byId(p, id).hints.unlabeled).toBe(true);
  });

  it("flags an empty fake button as unlabeled too", () => {
    const p = pageFrom(`<div onclick="x()" class="icon-close" data-detour-id="f"></div>`);
    expect(byId(p, "f").hints).toMatchObject({ fakeButton: true, unlabeled: true, visualLabel: "close" });
  });
});

describe("repetitiveBlock", () => {
  const links = (n: number) => Array.from({ length: n }, (_, i) => `<li><a href="/${i}">Link ${i}</a></li>`).join("");

  it("flags nav, header and footer containers with at least 10 links", () => {
    const p = pageFrom(`
      <header data-detour-id="hd"><nav data-detour-id="nv"><ul>${links(10)}</ul></nav></header>
      <footer data-detour-id="ft"><ul>${links(12)}</ul></footer>`);
    expect(byId(p, "nv").hints.repetitiveBlock).toBe(true);
    expect(byId(p, "hd").hints.repetitiveBlock).toBe(true);
    expect(byId(p, "ft").hints.repetitiveBlock).toBe(true);
  });

  it("does not flag fewer than 10 links or non-nav containers", () => {
    const p = pageFrom(`
      <nav data-detour-id="small"><ul>${links(9)}</ul></nav>
      <div data-detour-id="div"><ul>${links(30)}</ul></div>
      <main data-detour-id="mn"><ul>${links(30)}</ul></main>`);
    expect(byId(p, "small").hints.repetitiveBlock).toBeUndefined();
    expect(byId(p, "div").hints.repetitiveBlock).toBeUndefined();
    expect(byId(p, "mn").hints.repetitiveBlock).toBeUndefined();
  });

  it("flags role-based banner/contentinfo/navigation containers", () => {
    const p = pageFrom(`
      <div role="navigation" data-detour-id="a">${links(11).replace(/<\/?li>/g, "")}</div>
      <div role="contentinfo" data-detour-id="b">${links(10).replace(/<\/?li>/g, "")}</div>`);
    expect(byId(p, "a").hints.repetitiveBlock).toBe(true);
    expect(byId(p, "b").hints.repetitiveBlock).toBe(true);
  });
});
