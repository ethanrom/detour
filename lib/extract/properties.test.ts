// @vitest-environment jsdom
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extractPage } from "./index";
import { docFrom } from "./testing";

type Tree = { tag: string; attrs: string; kids: Array<Tree | string> };

const TAGS = ["div", "span", "p", "a", "button", "ul", "li", "nav", "header", "footer", "main", "h2", "section", "b", "label", "input", "img", "select", "details", "summary"];
const ATTRS = [
  "",
  'href="/x"',
  'href="#t1"',
  'tabindex="0"',
  'tabindex="-1"',
  'tabindex="3"',
  "hidden",
  'aria-hidden="true"',
  'aria-label="Named"',
  'style="cursor:pointer"',
  'style="display:none"',
  'style="font-size:24px;font-weight:700"',
  'onclick="x()"',
  'role="button"',
  'id="t1"',
  "disabled",
  'alt="pic"',
];

const treeArb: fc.Arbitrary<Tree> = fc.letrec<{ tree: Tree; kid: Tree | string }>((tie) => ({
  tree: fc.record({
    tag: fc.constantFrom(...TAGS),
    attrs: fc.constantFrom(...ATTRS),
    kids: fc.array(tie("kid"), { maxLength: 4 }),
  }),
  kid: fc.oneof({ depthSize: "small", withCrossShrink: true }, fc.constantFrom("Some text", " ", "Buy now", "x"), tie("tree")),
})).tree;

const VOID = new Set(["input", "img"]);
const render = (t: Tree | string): string => {
  if (typeof t === "string") return t;
  const open = `<${t.tag}${t.attrs ? " " + t.attrs : ""}>`;
  return VOID.has(t.tag) ? open : `${open}${t.kids.map(render).join("")}</${t.tag}>`;
};

describe("extractPage invariants on random documents", () => {
  it("always yields a consistent, deterministic model", () => {
    fc.assert(
      fc.property(fc.array(treeArb, { minLength: 1, maxLength: 4 }), (trees) => {
        const html = trees.map(render).join("");
        const doc = docFrom(html);
        const p = extractPage(doc);

        // tree consistency
        const seen = new Set<string>();
        const walk = (id: string, parent: string | null) => {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
          const n = p.nodes[id];
          expect(n).toBeDefined();
          expect(n.parentId).toBe(parent);
          expect(n.id).toBe(id);
          n.children.forEach((c) => walk(c, id));
        };
        walk(p.root, null);
        expect(seen.size).toBe(Object.keys(p.nodes).length);

        // lists reference real nodes, without duplicates
        for (const list of [p.readingOrder, p.focusOrder, p.headings, p.landmarks]) {
          expect(new Set(list).size).toBe(list.length);
          for (const id of list) expect(p.nodes[id]).toBeDefined();
        }
        // announcements exist exactly for reading stops
        for (const id of p.readingOrder) expect(p.nodes[id].announcement.length).toBeGreaterThan(0);
        for (const n of Object.values(p.nodes)) if (!p.readingOrder.includes(n.id)) expect(n.announcement).toBe("");
        for (const id of p.headings) expect(p.readingOrder).toContain(id);
        for (const id of p.focusOrder) {
          expect(p.nodes[id].focusable).toBe(true);
          expect((p.nodes[id].tabIndex ?? 0) >= 0).toBe(true);
        }
        // focus order: positive tabindex ascending first
        const tabs = p.focusOrder.map((id) => p.nodes[id].tabIndex ?? 0);
        const firstZero = tabs.findIndex((t) => t <= 0);
        const positives = firstZero === -1 ? tabs : tabs.slice(0, firstZero);
        expect([...positives].sort((a, b) => a - b)).toEqual(positives);
        if (firstZero !== -1) expect(tabs.slice(firstZero).every((t) => t <= 0)).toBe(true);
        // skip links point at stops
        for (const s of p.skipLinks) {
          expect(p.nodes[s.from].role).toBe("link");
          expect(p.readingOrder).toContain(s.to);
        }
        // selectors resolve to one element of the right tag
        for (const n of Object.values(p.nodes)) {
          const hits = doc.querySelectorAll(n.selector);
          if (n.role !== "text") {
            expect(hits).toHaveLength(1);
            expect(hits[0].localName).toBe(n.tag);
          }
        }
        // deterministic
        expect(extractPage(docFrom(html))).toEqual(p);
      }),
      { numRuns: 120 },
    );
  });
});
