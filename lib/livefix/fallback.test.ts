import { describe, expect, it } from "vitest";
import type { FixKind } from "@/lib/contracts";
import { fallbackEdits } from "./fallback";
import type { FixRequestItem, FixTargetContext } from "./types";
import { validateEdits } from "./validate";

function target(nodeId: string, selector: string, outerHTML: string): FixTargetContext {
  return {
    nodeId,
    selector,
    outerHTML,
    parentHTML: "<div><!-- target --></div>",
    nearbyText: [],
    style: { display: "", fontSize: "", fontWeight: "", color: "", background: "", border: "", padding: "", margin: "", cursor: "" },
  };
}

function make(kind: FixKind, params: FixRequestItem["params"], targets: FixTargetContext[], extra: Partial<FixRequestItem> = {}): FixRequestItem {
  return { fixId: `${kind}:test`, kind, title: kind, params, wcag: [], targets, ...extra };
}

const ITEMS: FixRequestItem[] = [
  make("skip-link", { target: "main", stop: "h1", anchor: "main-content", linkId: "fix-skip-link", label: "Skip to main content" }, [target("main", "div.content", `<div class="content">Hi</div>`)], { extraSelectors: ["body"] }),
  make("promote-heading", { level: 2, text: "Reviews", count: 2 }, [target("h-a", "div.t:nth-of-type(1)", "<div class=t>A</div>"), target("h-b", "div.t:nth-of-type(2)", "<div class=t>B</div>")]),
  make("add-landmark", { main: "wrap", contentinfo: "foot" }, [target("wrap", "div.wrap", "<div class=wrap></div>"), target("foot", "div.foot", "<div class=foot></div>")]),
  make("add-label", { count: 2, "label:b1": "Add to wishlist", "label:b2": "A very long invented label that goes on and on" }, [target("b1", "#b1", `<button id="b1"></button>`), target("b2", "#b2", `<button id="b2"></button>`)]),
  make("real-button", { count: 1, pressed: true }, [target("play", "#play", `<div id="play">Play</div>`)]),
  make("remove-positive-tabindex", { count: 1, maxTabIndex: 5 }, [target("f", "#f", `<input id="f" tabindex="5">`)]),
];

describe("fallbackEdits", () => {
  it.each(ITEMS.map((i) => [i.kind, i] as const))("%s yields edits that pass the validator", (_kind, item) => {
    const edits = fallbackEdits(item);
    expect(edits.source).toBe("fallback");
    expect(edits.fixId).toBe(item.fixId);
    const checked = validateEdits(item, edits);
    expect(checked, JSON.stringify(checked)).toHaveProperty("ok");
  });

  it("skip-link links to an id the target already has and does not set another", () => {
    const item = make("skip-link", { target: "main", anchor: "main-content" }, [target("main", "main", `<main id="content">x</main>`)], { extraSelectors: ["body"] });
    const edits = fallbackEdits(item);
    expect(edits.edits[0]).toMatchObject({ op: "insert", selector: "body", position: "afterbegin" });
    expect(JSON.stringify(edits.edits[0])).toContain('href=\\"#content\\"');
    expect(edits.edits[1]).toEqual({ op: "setAttributes", selector: "main", attributes: { tabindex: "-1" } });
  });

  it("add-label keeps the labels that pass and shortens the ones that do not", () => {
    const edits = fallbackEdits(ITEMS[3]).edits;
    expect(edits[0]).toMatchObject({ attributes: { "aria-label": "Add to wishlist" } });
    expect(edits[1]).toMatchObject({ attributes: { "aria-label": "A very long invented" } });
  });
});
