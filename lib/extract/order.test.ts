// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { byId, pageFrom, stops } from "./testing";

describe("reading stops", () => {
  it("makes every interactive element, heading and image its own stop, in document order", () => {
    const p = pageFrom(`
      <h1>Shop</h1>
      <a href="/a">First</a>
      <button>Second</button>
      <img alt="Photo">
      <input aria-label="Third">`);
    expect(stops(p)).toEqual(["heading:Shop", "link:First", "button:Second", "img:Photo", "textbox:Third"]);
  });

  it("makes each text-only block one stop", () => {
    const p = pageFrom(`<p>One</p><div>Two</div><ul><li>Three</li><li>Four</li></ul>`);
    expect(stops(p)).toEqual(["paragraph:One", "generic:Two", "listitem:Three", "listitem:Four"]);
  });

  it("splits text around an inline link into before / link / after stops", () => {
    const p = pageFrom(`<p data-detour-id="p">Please read the <a href="/terms" data-detour-id="t">terms</a> before you buy.</p>`);
    expect(stops(p)).toEqual(["text:Please read the", "link:terms", "text:before you buy."]);
    const [before, link, after] = p.readingOrder.map((id) => p.nodes[id]);
    expect(before.parentId).toBe("p");
    expect(after.parentId).toBe("p");
    expect(link.id).toBe("t");
    expect(byId(p, "p").announcement).toBe("");
    expect(before.announcement).toBe("Please read the");
    expect(after.announcement).toBe("before you buy.");
  });

  it("keeps inline formatting inside one text stop and drops hidden inline text", () => {
    const p = pageFrom(`<p>Free <b>shipping</b> on <em>orders</em> over $50<span hidden> secret</span>.</p>`);
    expect(stops(p)).toEqual(["paragraph:Free shipping on orders over $50."]);
  });

  it("treats block-level children as separate stops", () => {
    const p = pageFrom(`<div>Intro<p>Para</p>Outro</div>`);
    expect(stops(p)).toEqual(["text:Intro", "paragraph:Para", "text:Outro"]);
  });

  it("splits text at <br> only as whitespace", () => {
    const p = pageFrom(`<p>Line one<br>Line two</p>`);
    expect(stops(p)).toEqual(["paragraph:Line one Line two"]);
  });

  it("emits a heading stop and keeps a nested link as its own stop", () => {
    const p = pageFrom(`<h2 data-detour-id="h"><a href="/p" data-detour-id="l">Trail Jacket</a></h2>`);
    expect(stops(p)).toEqual(["heading:Trail Jacket", "link:Trail Jacket"]);
    expect(byId(p, "l").parentId).toBe("h");
    expect(p.focusOrder).toEqual(["l"]);
  });

  it("finds headings inside links", () => {
    const p = pageFrom(`<a href="/card" data-detour-id="c"><h3 data-detour-id="ct">Card title</h3><p>blurb</p></a>`);
    expect(p.headings).toEqual(["ct"]);
    expect(p.readingOrder).toEqual(["c", "ct"]);
  });

  it("gives non-stop nodes an empty announcement", () => {
    const p = pageFrom(`<main><nav><ul><li><a href="/x">X</a></li></ul></nav><div><p>a</p><p>b</p></div></main>`);
    for (const n of Object.values(p.nodes)) {
      expect(n.announcement === "").toBe(!p.readingOrder.includes(n.id));
    }
  });
});

describe("announcements", () => {
  it("prefixes the first stop in a navigation list with its entry phrases", () => {
    const p = pageFrom(`<nav><ul><li><a href="/m" data-detour-id="m">Men</a></li><li><a href="/w" data-detour-id="w">Women</a></li><li><a href="/k" data-detour-id="k">Kids</a></li></ul></nav>`);
    expect(byId(p, "m").announcement).toBe("navigation landmark, list with 3 items, link, Men");
    expect(byId(p, "w").announcement).toBe("link, Women");
    expect(byId(p, "k").announcement).toBe("link, Kids");
  });

  it("uses the landmark's accessible name and counts items", () => {
    const p = pageFrom(`<nav aria-label="Primary"><ul><li><a href="/a" data-detour-id="a">A</a></li></ul></nav>`);
    expect(byId(p, "a").announcement).toBe("Primary navigation landmark, list with 1 item, link, A");
  });

  it("lists nested containers outermost first, once", () => {
    const p = pageFrom(`
      <header><nav><ul>
        <li><a href="/a" data-detour-id="a">Shop</a>
          <ul><li><a href="/b" data-detour-id="b">Shirts</a></li><li><a href="/c" data-detour-id="c">Hats</a></li></ul>
        </li>
        <li><a href="/d" data-detour-id="d">Sale</a></li>
      </ul></nav></header>`);
    expect(byId(p, "a").announcement).toBe("banner landmark, navigation landmark, list with 2 items, link, Shop");
    expect(byId(p, "b").announcement).toBe("list with 2 items, link, Shirts");
    expect(byId(p, "c").announcement).toBe("link, Hats");
    expect(byId(p, "d").announcement).toBe("link, Sale");
  });

  it("gives each landmark its own entry phrase on its first stop", () => {
    const p = pageFrom(`
      <header><a href="/" data-detour-id="logo">Logo</a></header>
      <main><h1 data-detour-id="h">Title</h1><p data-detour-id="t">Text</p></main>
      <footer><p data-detour-id="f">Fine print</p></footer>`);
    expect(byId(p, "logo").announcement).toBe("banner landmark, link, Logo");
    expect(byId(p, "h").announcement).toBe("main landmark, heading, level 1, Title");
    expect(byId(p, "t").announcement).toBe("Text");
    expect(byId(p, "f").announcement).toBe("content info landmark, Fine print");
  });

  it("announces form controls, images and fake buttons like the printer", () => {
    const p = pageFrom(`
      <style>.pick{cursor:pointer}</style>
      <input type="radio" aria-label="Medium" data-detour-id="r">
      <input required aria-label="Email" data-detour-id="e">
      <button aria-expanded="false" data-detour-id="b">Menu</button>
      <img alt="Logo" data-detour-id="i">
      <div class="pick" data-detour-id="m">M</div>`);
    expect(byId(p, "r").announcement).toBe("radio button, not checked, Medium");
    expect(byId(p, "e").announcement).toBe("edit, Email, required, blank");
    expect(byId(p, "b").announcement).toBe("button, Menu, collapsed");
    expect(byId(p, "i").announcement).toBe("graphic, Logo");
    expect(byId(p, "m").announcement).toBe("clickable, M");
  });

  it("attaches entry phrases to a text stop and to a stop that follows a heading", () => {
    const p = pageFrom(`<section aria-label="Reviews"><h2 data-detour-id="h">Reviews</h2><p data-detour-id="p">Good.</p></section>`);
    expect(byId(p, "h").announcement).toBe("Reviews region, heading, level 2, Reviews");
    expect(byId(p, "p").announcement).toBe("Good.");
  });
});

describe("focus order", () => {
  const html = `
    <a href="#" data-detour-id="a0">zero</a>
    <button data-detour-id="b2" tabindex="2">two</button>
    <div data-detour-id="d1" tabindex="1" role="button">one</div>
    <input data-detour-id="i0" aria-label="in">
    <button data-detour-id="bx" tabindex="-1">negative</button>
    <button data-detour-id="bd" disabled>disabled</button>
    <div data-detour-id="dz" tabindex="0">zero div</div>
    <a data-detour-id="nolink">no href</a>
    <button data-detour-id="b2b" tabindex="2">two again</button>
    <span hidden><button data-detour-id="hid">hidden</button></span>
    <div role="button" data-detour-id="rb">role button without tabindex</div>`;

  it("orders positive tabindex ascending (DOM order on ties), then tabindex 0 and native in DOM order", () => {
    const p = pageFrom(html);
    expect(p.focusOrder).toEqual(["d1", "b2", "b2b", "a0", "i0", "dz"]);
  });

  it("excludes tabindex=-1, disabled, non-link anchors, hidden and role-only elements", () => {
    const p = pageFrom(html);
    for (const id of ["bx", "bd", "nolink", "rb"]) expect(p.focusOrder).not.toContain(id);
    expect(p.nodes.hid).toBeUndefined();
  });

  it("sets focusable and tabIndex on every node", () => {
    const p = pageFrom(html);
    expect(byId(p, "a0")).toMatchObject({ focusable: true, tabIndex: null });
    expect(byId(p, "b2")).toMatchObject({ focusable: true, tabIndex: 2 });
    expect(byId(p, "d1")).toMatchObject({ focusable: true, tabIndex: 1 });
    expect(byId(p, "bx")).toMatchObject({ focusable: false, tabIndex: -1 });
    expect(byId(p, "bd")).toMatchObject({ focusable: false, tabIndex: null });
    expect(byId(p, "dz")).toMatchObject({ focusable: true, tabIndex: 0, actionable: false });
    expect(byId(p, "rb")).toMatchObject({ focusable: false, actionable: true });
    expect(byId(p, p.root)).toMatchObject({ focusable: false });
  });

  it("includes summary, contenteditable and areas of native focus, in DOM order", () => {
    const p = pageFrom(`
      <details><summary data-detour-id="s">Q</summary>A</details>
      <div contenteditable aria-label="Ed" data-detour-id="c"></div>
      <textarea aria-label="T" data-detour-id="t"></textarea>
      <select aria-label="S" data-detour-id="sel"><option>1</option></select>`);
    expect(p.focusOrder).toEqual(["s", "c", "t", "sel"]);
  });

  it("keeps a tabindex=-1 skip target out of the order but records it", () => {
    const p = pageFrom(`<main tabindex="-1" data-detour-id="m"><h1 data-detour-id="h">Hi</h1></main>`);
    expect(p.focusOrder).toEqual([]);
    expect(byId(p, "m")).toMatchObject({ tabIndex: -1, focusable: false });
  });
});

describe("skip links", () => {
  it("points each in-page link at the first reading stop at or after its target", () => {
    const p = pageFrom(`
      <a href="#main" data-detour-id="skip">Skip to content</a>
      <nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav>
      <main id="main"><div><h1 data-detour-id="h1">Title</h1></div></main>
      <a href="#tail" data-detour-id="jump">Jump</a>
      <div id="spacer"></div>
      <p id="tail" data-detour-id="tailp">Tail</p>`);
    expect(p.skipLinks).toEqual([
      { from: "skip", to: "h1" },
      { from: "jump", to: "tailp" },
    ]);
  });

  it("resolves a target that has no stop of its own to the next stop after it", () => {
    const p = pageFrom(`
      <a href="#empty" data-detour-id="s">Skip</a>
      <p>Before</p>
      <div id="empty"></div>
      <p data-detour-id="after">After</p>`);
    expect(p.skipLinks).toEqual([{ from: "s", to: "after" }]);
  });

  it("ignores links whose target is missing, bare # links and external links", () => {
    const p = pageFrom(`
      <a href="#nowhere">x</a><a href="#">top</a><a href="https://example.com/#frag">ext</a>
      <p id="here">Here</p>`);
    expect(p.skipLinks).toEqual([]);
  });

  it("resolves name= anchors and percent-encoded ids", () => {
    const p = pageFrom(`
      <a href="#sec%201" data-detour-id="a">One</a><a href="#old" data-detour-id="b">Two</a>
      <p id="sec 1" data-detour-id="t1">First</p><a name="old"></a><p data-detour-id="t2">Second</p>`);
    expect(p.skipLinks).toEqual([
      { from: "a", to: "t1" },
      { from: "b", to: "t2" },
    ]);
  });
});
