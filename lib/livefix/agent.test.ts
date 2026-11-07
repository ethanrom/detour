import { describe, expect, it } from "vitest";
import { completeCss } from "./agent";
import { FIX_BUTTON_CLASS, SKIP_LINK_CLASS } from "./fallback";
import type { FixRequestItem } from "./types";

const item = (kind: FixRequestItem["kind"]): FixRequestItem => ({
  fixId: `${kind}:x`,
  kind,
  title: kind,
  params: {},
  wcag: [],
  targets: [],
});

describe("completeCss", () => {
  it("adds the hidden-until-focus CSS to an agent skip link that came without any", () => {
    const out = completeCss(item("skip-link"), {
      fixId: "skip-link:x",
      note: "n",
      edits: [{ op: "insert", selector: "body", position: "afterbegin", html: `<a class="${SKIP_LINK_CLASS}" href="#main">Skip to main content</a>` }],
    });
    expect(out.css).toContain(`.${SKIP_LINK_CLASS}{position:absolute`);
  });

  it("gives an agent's real button the reset class and CSS, keeping its own class", () => {
    const out = completeCss(item("real-button"), {
      fixId: "real-button:x",
      note: "n",
      edits: [{ op: "wrapChildren", selector: "#a", tag: "button", attributes: { type: "button", class: "agent-btn" } }],
    });
    const op = out.edits[0];
    expect(op.op === "wrapChildren" && op.attributes.class).toBe(`agent-btn ${FIX_BUTTON_CLASS}`);
    expect(out.css).toContain(`.${FIX_BUTTON_CLASS}{`);
  });

  it("leaves an edit alone when its own CSS already covers the class", () => {
    const css = `.${FIX_BUTTON_CLASS}{border:0}`;
    const out = completeCss(item("real-button"), {
      fixId: "real-button:x",
      note: "n",
      css,
      edits: [{ op: "wrapChildren", selector: "#a", tag: "button", attributes: { type: "button", class: FIX_BUTTON_CLASS } }],
    });
    expect(out.css).toBe(css);
  });
});
