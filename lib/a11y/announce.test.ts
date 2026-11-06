import { describe, expect, it } from "vitest";
import { announce, wordCount } from "./announce";

describe("announce", () => {
  it("prints links, buttons and headings like NVDA browse mode", () => {
    expect(announce({ role: "link", name: "Shop all", states: [] })).toBe("link, Shop all");
    expect(announce({ role: "link", name: "Home", states: ["visited"] })).toBe("visited link, Home");
    expect(announce({ role: "button", name: "Menu", states: ["collapsed"] })).toBe("button, Menu, collapsed");
    expect(announce({ role: "heading", name: "Reviews", level: 2, states: [] })).toBe("heading, level 2, Reviews");
  });

  it("puts check state before the name for checkable controls", () => {
    expect(announce({ role: "radio", name: "Medium", states: ["not checked"] })).toBe(
      "radio button, not checked, Medium",
    );
  });

  it("says blank for empty edit fields and unavailable for disabled", () => {
    expect(announce({ role: "textbox", name: "Email", states: ["required"] })).toBe("edit, Email, required, blank");
    expect(announce({ role: "button", name: "Pay", states: ["disabled"] })).toBe("button, Pay, unavailable");
  });

  it("announces unlabeled controls by role only", () => {
    expect(announce({ role: "button", name: "", states: [] })).toBe("button");
  });

  it("marks role-less click targets as clickable", () => {
    expect(announce({ role: "generic", name: "M", states: [], hints: { fakeButton: true } })).toBe("clickable, M");
  });

  it("prefixes container entry phrases", () => {
    expect(
      announce(
        { role: "link", name: "Men", states: [] },
        { enter: [{ kind: "landmark", role: "navigation" }, { kind: "list", items: 12 }] },
      ),
    ).toBe("navigation landmark, list with 12 items, link, Men");
  });
});

describe("wordCount", () => {
  it("counts spoken words and ignores punctuation", () => {
    expect(wordCount("heading, level 2, Reviews")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(wordCount("  , ")).toBe(0);
  });
});
