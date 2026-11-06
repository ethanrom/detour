import { describe, expect, it } from "vitest";
import { diffHtml, diffLines, prettyHtml } from "./diff";

describe("prettyHtml", () => {
  it("puts tags on their own lines but keeps <tag>text</tag> together", () => {
    expect(prettyHtml('<div class="sizes"><div class="size">M</div><div class="size">L</div></div>')).toEqual([
      '<div class="sizes">',
      '  <div class="size">M</div>',
      '  <div class="size">L</div>',
      "</div>",
    ]);
  });
  it("handles void elements and empty elements", () => {
    expect(prettyHtml('<p><img src="a.png"><span></span></p>')).toEqual(['<p>', '  <img src="a.png">', "  <span></span>", "</p>"]);
  });
  it("leaves multi-line snippets alone apart from the common indent", () => {
    expect(prettyHtml("  <ul>\n    <li>a</li>\n  </ul>")).toEqual(["<ul>", "  <li>a</li>", "</ul>"]);
  });
});

describe("diffLines", () => {
  it("marks removed, added and unchanged lines", () => {
    const d = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(d).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "ctx", text: "c" },
    ]);
  });
  it("reconstructs both sides from the diff", () => {
    const before = ["1", "2", "3", "4"];
    const after = ["1", "3", "5"];
    const d = diffLines(before, after);
    expect(d.filter((l) => l.kind !== "add").map((l) => l.text)).toEqual(before);
    expect(d.filter((l) => l.kind !== "del").map((l) => l.text)).toEqual(after);
  });
});

describe("diffHtml", () => {
  it("shows a div -> button swap as one deletion and one addition", () => {
    const d = diffHtml('<div class="size">M</div>', '<button type="button" class="size">M</button>');
    expect(d.map((l) => l.kind)).toEqual(["del", "add"]);
  });
});
