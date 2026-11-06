// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { byId, pageFrom } from "./testing";

describe("landmark roles", () => {
  it("maps native landmark elements", () => {
    const p = pageFrom(`
      <header data-detour-id="hd"><a href="/" data-detour-id="logo">Home</a></header>
      <nav data-detour-id="nv"><a href="/a">A</a></nav>
      <main data-detour-id="mn"><p>Hi</p></main>
      <aside data-detour-id="as"><p>Side</p></aside>
      <form aria-label="Sign in" data-detour-id="fm"><input aria-label="Email"></form>
      <section aria-label="Reviews" data-detour-id="sc"><p>Great</p></section>
      <footer data-detour-id="ft"><p>Copyright</p></footer>`);
    expect(p.landmarks).toEqual(["hd", "nv", "mn", "as", "fm", "sc", "ft"]);
    expect(byId(p, "hd")).toMatchObject({ role: "banner", landmark: "banner" });
    expect(byId(p, "nv")).toMatchObject({ role: "navigation", landmark: "navigation" });
    expect(byId(p, "mn")).toMatchObject({ role: "main", landmark: "main" });
    expect(byId(p, "as")).toMatchObject({ role: "complementary", landmark: "complementary" });
    expect(byId(p, "fm")).toMatchObject({ role: "form", landmark: "form", name: "Sign in" });
    expect(byId(p, "sc")).toMatchObject({ role: "region", landmark: "region", name: "Reviews" });
    expect(byId(p, "ft")).toMatchObject({ role: "contentinfo", landmark: "contentinfo" });
  });

  it("does not treat unnamed form/section as landmarks", () => {
    const p = pageFrom(`
      <form data-detour-id="f2"><input aria-label="q"></form>
      <section data-detour-id="s2"><p>x</p></section>`);
    expect(p.landmarks).toEqual([]);
    expect(byId(p, "f2").landmark).toBeUndefined();
    expect(byId(p, "s2").landmark).toBeUndefined();
    expect(byId(p, "f2").role).toBe("generic");
  });

  it("does not map header/footer nested in sectioning content to banner/contentinfo", () => {
    const p = pageFrom(`
      <article data-detour-id="ar"><header data-detour-id="ah"><h2>Post</h2></header><footer data-detour-id="af"><p>by me</p></footer></article>
      <main><header data-detour-id="mh"><p>inside main</p></header></main>`);
    expect(p.landmarks).toEqual([expect.stringMatching(/./)]); // only <main>
    expect(byId(p, "ah").landmark).toBeUndefined();
    expect(byId(p, "af").landmark).toBeUndefined();
    expect(byId(p, "mh").landmark).toBeUndefined();
    expect(byId(p, "ar").role).toBe("article");
  });

  it("maps explicit role= landmarks and the <search> element", () => {
    const p = pageFrom(`
      <div role="banner" data-detour-id="r1"><p>b</p></div>
      <div role="navigation" aria-label="Footer" data-detour-id="r2"><a href="/x">x</a></div>
      <div role="main" data-detour-id="r3"><p>m</p></div>
      <div role="complementary" data-detour-id="r4"><p>c</p></div>
      <div role="search" data-detour-id="r5"><input aria-label="Find"></div>
      <div role="contentinfo" data-detour-id="r6"><p>ci</p></div>
      <div role="region" aria-label="Deals" data-detour-id="r7"><p>d</p></div>
      <div role="region" data-detour-id="r8"><p>unnamed region is not a landmark</p></div>
      <search data-detour-id="r9"><input aria-label="Site search"></search>`);
    expect(p.landmarks).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r9"]);
    expect(byId(p, "r2").name).toBe("Footer");
    expect(byId(p, "r5").landmark).toBe("search");
    expect(byId(p, "r9").landmark).toBe("search");
    expect(byId(p, "r8").landmark).toBeUndefined();
  });
});

describe("headings and lists", () => {
  it("reads heading levels from h1-h6 and aria-level, in document order", () => {
    const p = pageFrom(`
      <h1 data-detour-id="a">One</h1><h2 data-detour-id="b">Two</h2><h6 data-detour-id="f">Six</h6>
      <div role="heading" aria-level="3" data-detour-id="c">Three</div>
      <div role="heading" data-detour-id="d">Default</div>
      <h4 aria-level="2" data-detour-id="e">Override</h4>`);
    expect(p.headings).toEqual(["a", "b", "f", "c", "d", "e"]);
    expect(p.headings.map((h) => byId(p, h).level)).toEqual([1, 2, 6, 3, 2, 2]);
    expect(byId(p, "a")).toMatchObject({ role: "heading", name: "One" });
    for (const h of p.headings) expect(p.readingOrder).toContain(h);
  });

  it("models lists and list items", () => {
    const p = pageFrom(`<ul data-detour-id="ul"><li data-detour-id="l1">One</li><li data-detour-id="l2"><a href="/t" data-detour-id="lk">Two</a></li></ul>`);
    expect(byId(p, "ul")).toMatchObject({ role: "list", children: ["l1", "l2"], announcement: "" });
    expect(byId(p, "l1")).toMatchObject({ role: "listitem", name: "One" });
    expect(byId(p, "l2")).toMatchObject({ role: "listitem", children: ["lk"], announcement: "" });
    expect(p.readingOrder).toEqual(["l1", "lk"]);
  });

  it("gives text blocks the paragraph/generic/text roles", () => {
    const p = pageFrom(`<p data-detour-id="p">Para</p><div data-detour-id="d">Div text</div><div data-detour-id="m">Lead <b>bold</b> <a href="/x">go</a></div>`);
    expect(byId(p, "p")).toMatchObject({ role: "paragraph", name: "Para", tag: "p" });
    expect(byId(p, "d")).toMatchObject({ role: "generic", name: "Div text" });
    const kids = byId(p, "m").children.map((c) => p.nodes[c]);
    expect(kids.map((k) => [k.role, k.name])).toEqual([
      ["text", "Lead bold"],
      ["link", "go"],
    ]);
  });
});

describe("interactive roles and names", () => {
  it("maps native controls", () => {
    const p = pageFrom(`
      <a href="/x" data-detour-id="a">Link</a>
      <button data-detour-id="b">Btn</button>
      <input data-detour-id="t" aria-label="Text">
      <input type="email" data-detour-id="e" aria-label="Mail">
      <input type="search" data-detour-id="s" aria-label="Find">
      <input type="password" data-detour-id="pw" aria-label="Pass">
      <input type="checkbox" data-detour-id="cb" aria-label="Agree">
      <input type="radio" data-detour-id="rd" aria-label="Pick">
      <input type="submit" value="Go" data-detour-id="sub">
      <input type="number" data-detour-id="num" aria-label="Qty">
      <input type="range" data-detour-id="rng" aria-label="Vol">
      <select data-detour-id="sel" aria-label="Size"><option>S</option><option>M</option></select>
      <textarea data-detour-id="ta" aria-label="Notes"></textarea>
      <div contenteditable="true" aria-label="Editor" data-detour-id="ce">hello</div>
      <div role="button" data-detour-id="rb">Role button</div>
      <div role="switch" aria-checked="true" aria-label="Dark" data-detour-id="sw"></div>
      <a data-detour-id="nolink">not a link</a>`);
    const roles = Object.fromEntries(
      ["a", "b", "t", "e", "s", "pw", "cb", "rd", "sub", "num", "rng", "sel", "ta", "ce", "rb", "sw", "nolink"].map((id) => [id, byId(p, id).role]),
    );
    expect(roles).toEqual({
      a: "link",
      b: "button",
      t: "textbox",
      e: "textbox",
      s: "searchbox",
      pw: "textbox",
      cb: "checkbox",
      rd: "radio",
      sub: "button",
      num: "spinbutton",
      rng: "slider",
      sel: "combobox",
      ta: "textbox",
      ce: "textbox",
      rb: "button",
      sw: "switch",
      nolink: "generic",
    });
    for (const id of ["a", "b", "t", "cb", "sel", "rb", "sw"]) expect(byId(p, id).actionable).toBe(true);
    expect(byId(p, "nolink").actionable).toBe(false);
  });

  it("does not make options inside a native select into separate nodes", () => {
    const p = pageFrom(`<select aria-label="Size" data-detour-id="sel"><option>S</option><option>M</option></select>`);
    expect(Object.values(p.nodes).filter((n) => n.role === "option")).toHaveLength(0);
    expect(byId(p, "sel").children).toEqual([]);
  });

  it("computes names from aria-label, aria-labelledby, alt, label and contents", () => {
    const p = pageFrom(`
      <button aria-label="Close dialog" data-detour-id="n1">X</button>
      <span id="lbl">Delivery date</span><input aria-labelledby="lbl" data-detour-id="n2">
      <a href="/home" data-detour-id="n3"><img alt="Northwind home"></a>
      <label for="em">Email address</label><input id="em" data-detour-id="n4">
      <button data-detour-id="n5">  Add   to
        cart </button>
      <img alt="Trail jacket in blue" data-detour-id="n6">
      <h2 aria-label="Overridden" data-detour-id="n7">Visible</h2>
      <input type="submit" value="Pay now" data-detour-id="n8">`);
    expect(byId(p, "n1").name).toBe("Close dialog");
    expect(byId(p, "n2").name).toBe("Delivery date");
    expect(byId(p, "n3").name).toBe("Northwind home");
    expect(byId(p, "n4").name).toBe("Email address");
    expect(byId(p, "n5").name).toBe("Add to cart");
    expect(byId(p, "n6")).toMatchObject({ role: "img", name: "Trail jacket in blue" });
    expect(byId(p, "n7").name).toBe("Overridden");
    expect(byId(p, "n8").name).toBe("Pay now");
  });

  it("skips decorative images (alt empty, missing, or presentation role)", () => {
    const p = pageFrom(`<img alt=""><img src="x.png"><img alt="Hero" role="presentation"><img alt="Real" data-detour-id="ok">`);
    expect(p.readingOrder).toEqual(["ok"]);
  });

  it("keeps interactive descendants out of the reading order", () => {
    const p = pageFrom(`<a href="/x" data-detour-id="lk"><span>Shop</span> <b>now</b><img alt="icon"></a>`);
    expect(p.readingOrder).toEqual(["lk"]);
    expect(byId(p, "lk").children).toEqual([]);
    expect(byId(p, "lk").name).toContain("Shop now");
  });
});

describe("states", () => {
  it("reports checked / not checked for native and aria checkables", () => {
    const p = pageFrom(`
      <input type="checkbox" checked aria-label="A" data-detour-id="a">
      <input type="checkbox" aria-label="B" data-detour-id="b">
      <input type="radio" checked aria-label="C" data-detour-id="c">
      <input type="radio" aria-label="D" data-detour-id="d">
      <div role="checkbox" aria-checked="true" tabindex="0" aria-label="E" data-detour-id="e"></div>
      <div role="checkbox" aria-checked="false" tabindex="0" aria-label="F" data-detour-id="f"></div>
      <div role="checkbox" tabindex="0" aria-label="G" data-detour-id="g"></div>`);
    expect(["a", "b", "c", "d", "e", "f", "g"].map((i) => byId(p, i).states)).toEqual([
      ["checked"],
      ["not checked"],
      ["checked"],
      ["not checked"],
      ["checked"],
      ["not checked"],
      ["not checked"],
    ]);
    expect(byId(p, "a").announcement).toBe("check box, checked, A");
  });

  it("reports expanded / collapsed, pressed, selected, required, invalid and disabled", () => {
    const p = pageFrom(`
      <button aria-expanded="true" data-detour-id="x1">Menu</button>
      <button aria-expanded="false" data-detour-id="x2">Menu2</button>
      <details open><summary data-detour-id="x3">Open one</summary>body text</details>
      <details><summary data-detour-id="x4">Closed one</summary>hidden body</details>
      <button aria-pressed="true" data-detour-id="x5">Bold</button>
      <button aria-pressed="false" data-detour-id="x5b">Italic</button>
      <div role="tab" aria-selected="true" tabindex="0" data-detour-id="x6">Tab</div>
      <input required aria-label="Name" data-detour-id="x7">
      <input aria-required="true" aria-label="Name2" data-detour-id="x7b">
      <input aria-invalid="true" aria-label="Zip" data-detour-id="x8">
      <button disabled data-detour-id="x9">Pay</button>
      <button aria-disabled="true" data-detour-id="x10">Soft</button>
      <fieldset disabled><input aria-label="Inner" data-detour-id="x11"></fieldset>`);
    expect(byId(p, "x1").states).toEqual(["expanded"]);
    expect(byId(p, "x2").states).toEqual(["collapsed"]);
    expect(byId(p, "x3").states).toEqual(["expanded"]);
    expect(byId(p, "x4").states).toEqual(["collapsed"]);
    expect(byId(p, "x5").states).toEqual(["pressed"]);
    expect(byId(p, "x5b").states).toEqual([]);
    expect(byId(p, "x6").states).toEqual(["selected"]);
    expect(byId(p, "x7").states).toEqual(["required"]);
    expect(byId(p, "x7b").states).toEqual(["required"]);
    expect(byId(p, "x8").states).toEqual(["invalid"]);
    expect(byId(p, "x9").states).toEqual(["disabled"]);
    expect(byId(p, "x10").states).toEqual(["disabled"]);
    expect(byId(p, "x11").states).toEqual(["disabled"]);
    expect(byId(p, "x7").announcement).toBe("edit, Name, required, blank");
    expect(byId(p, "x9").announcement).toBe("button, Pay, unavailable");
  });
});

describe("hidden content", () => {
  it("excludes display:none, hidden, aria-hidden, inert and closed details bodies", () => {
    const p = pageFrom(`
      <style>.gone{display:none}</style>
      <p data-detour-id="vis">Visible</p>
      <p style="display:none" data-detour-id="h1">inline none</p>
      <p class="gone" data-detour-id="h2">class none</p>
      <p hidden data-detour-id="h3">hidden attr</p>
      <div aria-hidden="true"><button data-detour-id="h4">aria hidden</button><p data-detour-id="h5">deep</p></div>
      <div inert><button data-detour-id="h6">inert</button></div>
      <details><summary>More</summary><a href="/secret" data-detour-id="h7">secret</a></details>
      <div style="display:none"><div><button data-detour-id="h8">nested</button></div></div>
      <dialog><button data-detour-id="h9">closed dialog</button></dialog>`);
    for (const id of ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9"]) expect(p.nodes[id]).toBeUndefined();
    expect(p.readingOrder.map((id) => p.nodes[id].name)).toEqual(["Visible", "More"]);
    expect(p.focusOrder).toHaveLength(1); // only the <summary>
  });

  it("excludes visibility:hidden but keeps a visibility:visible descendant", () => {
    const p = pageFrom(`
      <div style="visibility:hidden">
        <p data-detour-id="a">hidden text</p>
        <button data-detour-id="b">hidden button</button>
        <p style="visibility:visible" data-detour-id="c">shown again</p>
      </div>
      <p data-detour-id="d">plain</p>`);
    expect(p.nodes.a).toBeUndefined();
    expect(p.nodes.b).toBeUndefined();
    expect(p.nodes.c).toBeDefined();
    expect(p.readingOrder).toEqual(["c", "d"]);
  });

  it("drops presentational wrappers with nothing semantic inside", () => {
    const p = pageFrom(`<div><div><span></span></div></div><div class="spacer"></div><script>var a=1</script><style>p{}</style>`);
    expect(Object.keys(p.nodes)).toEqual([p.root]);
    expect(p.readingOrder).toEqual([]);
  });

  it("flattens single-child wrappers and keeps tree links consistent", () => {
    const p = pageFrom(`<div><div><div><a href="/x" data-detour-id="only">Only</a></div></div></div>`);
    expect(byId(p, "only").parentId).toBe(p.root);
    expect(p.nodes[p.root].children).toEqual(["only"]);
  });
});
