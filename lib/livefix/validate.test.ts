import { describe, expect, it } from "vitest";
import { MAX_EDIT_HTML, type EditOp, type FixRequestItem, type FixTargetContext } from "./types";
import { validateEdits } from "./validate";

function target(nodeId: string, selector: string, outerHTML = `<div id="${nodeId}">Play</div>`): FixTargetContext {
  return {
    nodeId,
    selector,
    outerHTML,
    parentHTML: "<section><!-- target --></section>",
    nearbyText: [],
    style: { display: "", fontSize: "", fontWeight: "", color: "", background: "", border: "", padding: "", margin: "", cursor: "" },
  };
}

const item: FixRequestItem = {
  fixId: "real-button:play",
  kind: "real-button",
  title: "Make “Play” a real button",
  params: { count: 1, pressed: false },
  wcag: ["4.1.2 Name, Role, Value"],
  targets: [target("play", "#play")],
};

const note = "Render this control as a real button in its component.";
const check = (edits: EditOp[], css?: string, forItem: FixRequestItem = item) => validateEdits(forItem, { edits, css, note });
const errorsOf = (r: ReturnType<typeof check>): string => ("errors" in r ? r.errors.join(" | ") : "");

describe("validateEdits", () => {
  it("accepts a real-button wrapChildren edit with scoped CSS", () => {
    const r = check(
      [{ op: "wrapChildren", selector: "#play", tag: "button", attributes: { type: "button", class: "detour-fix-btn" } }],
      ".detour-fix-btn{font:inherit;background:none;border:0}.detour-fix-btn:focus-visible{outline:2px solid #00f}",
    );
    expect(r).toMatchObject({ ok: { fixId: "real-button:play", note } });
  });

  it("rejects script tags and event handlers in HTML", () => {
    expect(errorsOf(check([{ op: "insert", selector: "#play", position: "beforeend", html: "<b>hi</b><script>alert(1)</script>" }]))).toContain("<script>");
    expect(errorsOf(check([{ op: "replace", selector: "#play", html: `<div id="play" onclick="x()">Play</div>` }]))).toContain("onclick");
  });

  it("rejects a selector that is not a target", () => {
    expect(errorsOf(check([{ op: "setAttributes", selector: "#other", attributes: { role: "button" } }]))).toContain("not one of the fix's selectors");
  });

  it("rejects script URLs in HTML and in setAttributes", () => {
    expect(errorsOf(check([{ op: "insert", selector: "#play", position: "afterend", html: `<a href="java&#115;cript:alert(1)">x</a>` }]))).toContain("script URL");
    expect(errorsOf(check([{ op: "setAttributes", selector: "#play", attributes: { href: "javascript:alert(1)" } }]))).toContain("href");
  });

  it("rejects oversize HTML and too many edits", () => {
    const html = `<p>${"x".repeat(MAX_EDIT_HTML)}</p>`;
    expect(errorsOf(check([{ op: "insert", selector: "#play", position: "beforeend", html }]))).toContain("characters");
    const many: EditOp[] = Array.from({ length: 9 }, () => ({ op: "setAttributes", selector: "#play", attributes: { role: "button" } }));
    expect(errorsOf(check(many))).toContain("too many");
  });

  it("allows only listed attributes", () => {
    expect(errorsOf(check([{ op: "setAttributes", selector: "#play", attributes: { style: "display:none" } }]))).toContain('"style" is not allowed');
    expect(errorsOf(check([{ op: "setAttributes", selector: "#play", attributes: { tabindex: "3" } }]))).toContain("tabindex");
    expect(errorsOf(check([{ op: "removeAttributes", selector: "#play", names: ["class"] }]))).toContain("cannot be removed");
    expect(check([{ op: "setAttributes", selector: "#play", attributes: { tabindex: "0", "aria-pressed": "false" } }])).toHaveProperty("ok");
  });

  it("rejects CSS that fetches, injects or styles by tag", () => {
    const edit: EditOp[] = [{ op: "setAttributes", selector: "#play", attributes: { class: "a" } }];
    expect(errorsOf(check(edit, ".a{background:url(https://x.test/a.png)}"))).toContain("url(");
    expect(errorsOf(check(edit, "@import 'x.css';.a{color:red}"))).toContain("@import");
    expect(errorsOf(check(edit, "button{color:red}"))).toContain("scoped to a class");
  });

  it("checks add-label names with the same rules as /api/repair", () => {
    const labelItem: FixRequestItem = { ...item, kind: "add-label", params: { label: "Search" } };
    const bad = validateEdits(labelItem, { edits: [{ op: "setAttributes", selector: "#play", attributes: { "aria-label": "button" } }], note });
    expect(errorsOf(bad)).toContain("does not say what the control does");
    const good = validateEdits(labelItem, { edits: [{ op: "setAttributes", selector: "#play", attributes: { "aria-label": "Search." } }], note });
    expect(good).toMatchObject({ ok: { edits: [{ attributes: { "aria-label": "Search" } }] } });
  });
});
