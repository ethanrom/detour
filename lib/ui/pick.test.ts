// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/extract";
import { createPickIndex, filterOptions, nodeForElement, pickOptions, taskForNode } from "./pick";

const HTML = `
<header><a href="/" id="logo-link">Northbank</a></header>
<main>
  <h1 id="title">Opening hours</h1>
  <p id="intro">We are open every day except <a href="/holidays" id="hol">public holidays</a> and Sundays.</p>
  <a href="/card" id="card"><h2 id="card-h">Apply for a library card</h2></a>
  <section id="empty"><div id="deep"><div id="deeper"></div></div></section>
  <button id="cart" aria-label="Open cart"><svg id="icon"><path id="p"/></svg></button>
  <button id="ghost"><svg id="ghost-icon"></svg></button>
  <p id="two">Alpha beta<br><span id="s1">gamma</span> delta <a href="/x">link</a> epsilon</p>
</main>`;

function setup() {
  document.body.innerHTML = HTML;
  const page = extractPage(document, { url: "https://example.test/" });
  const index = createPickIndex(page);
  const el = (id: string) => document.getElementById(id)!;
  const pick = (id: string, point?: { x: number; y: number }) => nodeForElement(index, document, el(id), point);
  return { page, index, pick };
}

describe("nodeForElement", () => {
  it("climbs from a child element to the control that contains it", () => {
    const { pick } = setup();
    expect(pick("icon")).toMatchObject({ role: "button", name: "Open cart", actionable: true });
    expect(pick("p")).toMatchObject({ role: "button", name: "Open cart" });
  });

  it("maps a link, a heading and a text block to their own nodes", () => {
    const { pick } = setup();
    expect(pick("hol")).toMatchObject({ role: "link", name: "public holidays" });
    expect(pick("title")).toMatchObject({ role: "heading", name: "Opening hours" });
  });

  it("prefers the link around a heading over the heading", () => {
    const { pick } = setup();
    const n = pick("card-h");
    expect(n).toMatchObject({ role: "link", actionable: true });
    expect(n?.name).toContain("Apply for a library card");
  });

  it("finds a reading stop for plain text and keeps an unlabeled control pickable", () => {
    const { pick, page } = setup();
    expect(pick("intro")).not.toBeNull();
    expect(pick("intro")?.actionable).toBe(false);
    const ghost = pick("ghost-icon");
    expect(ghost).toMatchObject({ role: "button", actionable: true });
    expect(page.readingOrder).toContain(ghost!.id);
  });

  it("returns null over empty containers without a point, and ignores unknown elements", () => {
    const { pick } = setup();
    expect(pick("deeper")).toBeNull();
    const stray = document.createElement("div");
    document.body.appendChild(stray);
    const { index } = setup();
    expect(nodeForElement(index, document, null)).toBeNull();
  });

  it("tells the text runs of one element apart by the pointer position", () => {
    const { page, index } = setup();
    // jsdom has no layout, so give the two text runs of <p id="two"> boxes by hand.
    const runs = Object.values(page.nodes).filter((n) => n.role === "text" && n.selector.includes("p:nth-of-type") && n.name.includes("Alpha"));
    expect(runs.length).toBeGreaterThan(0);
    const run = runs[0];
    run.rect = { x: 10, y: 100, w: 200, h: 20 };
    const hit = nodeForElement(index, document, document.getElementById("two"), { x: 50, y: 110 });
    expect(hit?.id).toBe(run.id);
  });
});

describe("taskForNode", () => {
  it("reaches and activates controls, finds and reads content", () => {
    const { page, pick } = setup();
    const btn = pick("cart")!;
    expect(taskForNode(page, "url:https://example.test/", btn.id)).toEqual({
      id: `pick-${btn.id}`,
      siteId: "url:https://example.test/",
      label: "Reach and activate “Open cart”",
      steps: [{ target: btn.id, action: "activate" }],
      grounding: "fixture",
    });
    const h = pick("title")!;
    expect(taskForNode(page, "s", h.id)).toMatchObject({ label: "Find and read “Opening hours”", steps: [{ target: h.id, action: "read" }] });
    expect(taskForNode(page, "s", "nope")).toBeNull();
  });

  it("names an unlabeled control by what it looks like, else by its role", () => {
    const { page, pick } = setup();
    expect(taskForNode(page, "s", pick("ghost")!.id)?.label).toMatch(/^Reach and activate “/);
  });
});

describe("the keyboard list of targets", () => {
  it("offers controls and headings in reading order, and searches by name", () => {
    const { page } = setup();
    const options = pickOptions(page);
    const names = options.map((o) => o.name);
    expect(names).toContain("Open cart");
    expect(names).toContain("Opening hours");
    expect(names).not.toContain("We are open every day except");
    const { shown, total } = filterOptions(options, "open");
    expect(total).toBe(shown.length);
    expect(shown.map((o) => o.name)[0]).toMatch(/^Open/);
    expect(filterOptions(options, "heading 2 library").shown.map((o) => o.role)).toEqual(["heading 2"]);
    expect(filterOptions(options, "button").shown.every((o) => o.role === "button")).toBe(true);
    expect(filterOptions(options, "zzzz").total).toBe(0);
    expect(filterOptions(options, "", 2).shown).toHaveLength(2);
  });
});
