// Deterministic edits for a fix: used when no recording matches and no agent can run (no keys, the guard says
// no, the kill switch is on, or the agent failed twice). Same edit vocabulary as the agent, and the same
// validator: every result passes validateEdits. Edits keep the original element (attributes, wrapped children,
// an inserted link) so the site's own listeners stay attached and the page looks the same.

import { parseFragment } from "parse5";
import { checkLabel } from "@/lib/repair/labels";
import { stripDecoration } from "@/lib/repair/text";
import type { EditOp, FixEdits, FixRequestItem, FixTargetContext } from "./types";

export const SKIP_LINK_CLASS = "detour-skip-link";
export const FIX_BUTTON_CLASS = "detour-fix-btn";
const SKIP_LINK_TEXT = "Skip to main content";
const DEFAULT_ANCHOR = "main-content";

export const SKIP_LINK_CSS =
  `.${SKIP_LINK_CLASS}{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}` +
  `.${SKIP_LINK_CLASS}:focus{clip:auto;width:auto;height:auto;margin:0;padding:8px 14px;overflow:visible;top:8px;left:8px;z-index:2147483647;` +
  `background:#fff;color:#111;outline:3px solid #1a56db;text-decoration:underline;font:600 16px/1.2 system-ui,sans-serif}`;

export const BUTTON_CSS =
  `.${FIX_BUTTON_CLASS}{font:inherit;color:inherit;text-align:inherit;letter-spacing:inherit;text-transform:inherit;background:none;border:0;padding:0;margin:0;` +
  `width:100%;height:100%;cursor:inherit;box-sizing:border-box;appearance:none}` +
  `.${FIX_BUTTON_CLASS}:focus-visible{outline:3px solid #1a56db;outline-offset:2px}`;

function str(v: string | number | boolean | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function escapeAttribute(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The id attribute of the first element in a target's outer HTML, if it has one. */
function existingId(target: FixTargetContext): string | undefined {
  for (const node of parseFragment(target.outerHTML).childNodes) {
    if ("attrs" in node) {
      const id = node.attrs.find((a) => a.name === "id")?.value.trim();
      return id ? id : undefined;
    }
  }
  return undefined;
}

/** A label that passes checkLabel: cleaned, or cut to 4 words / 40 characters; null when nothing usable remains. */
function usableLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const direct = checkLabel(raw);
  if ("ok" in direct) return direct.ok;
  const cut = stripDecoration(raw).split(" ").slice(0, 4).join(" ").slice(0, 40).trim();
  const second = checkLabel(cut);
  return "ok" in second ? second.ok : null;
}

function setAttributes(selector: string, attributes: Record<string, string>): EditOp {
  return { op: "setAttributes", selector, attributes };
}

function skipLink(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  const target = item.targets[0];
  const asked = str(item.params.anchor);
  const anchor = asked && /^[A-Za-z][\w:.-]*$/.test(asked) ? asked : DEFAULT_ANCHOR;
  const had = existingId(target);
  const id = had ?? anchor;
  const edits: EditOp[] = [
    {
      op: "insert",
      selector: "body",
      position: "afterbegin",
      html: `<a class="${SKIP_LINK_CLASS}" href="#${escapeAttribute(id)}">${SKIP_LINK_TEXT}</a>`,
    },
    setAttributes(target.selector, had ? { tabindex: "-1" } : { id, tabindex: "-1" }),
  ];
  return {
    edits,
    css: SKIP_LINK_CSS,
    note: `Add a visually hidden "${SKIP_LINK_TEXT}" link as the first element of your page layout, pointing at the id of the main content container.`,
  };
}

function promoteHeading(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  const asked = Number(item.params.level);
  const level = Number.isInteger(asked) && asked >= 1 && asked <= 6 ? asked : 2;
  return {
    edits: item.targets.map((t) => setAttributes(t.selector, { role: "heading", "aria-level": String(level) })),
    note: `Render this text as a real <h${level}> element (or add role="heading" and aria-level="${level}") in the component that outputs it.`,
  };
}

function addLandmark(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  const byId = (id: string | undefined) => (id ? item.targets.find((t) => t.nodeId === id) : undefined);
  const main = byId(str(item.params.main));
  const footer = byId(str(item.params.contentinfo));
  const edits: EditOp[] = [];
  if (main) edits.push(setAttributes(main.selector, { role: "main" }));
  if (footer) edits.push(setAttributes(footer.selector, { role: "contentinfo" }));
  // The params named no target we hold: mark the first target as main, as the plan's single-landmark fixes do.
  if (edits.length === 0 && item.targets[0]) edits.push(setAttributes(item.targets[0].selector, { role: str(item.params.contentinfo) ? "contentinfo" : "main" }));
  return {
    edits,
    note: `Use <main> for the page's main content${footer ? " and <footer> for the site footer" : ""} in your layout template.`,
  };
}

function addLabel(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  const edits: EditOp[] = [];
  for (const t of item.targets) {
    const label = usableLabel(str(item.params[`label:${t.nodeId}`]) ?? str(item.params.label));
    if (label) edits.push(setAttributes(t.selector, { "aria-label": label }));
  }
  return {
    edits,
    note: "Give each of these controls an aria-label (or visible text) that says what it does, in the component that renders it.",
  };
}

function realButton(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  const pressed = item.params.pressed === true || item.params.pressed === "true";
  const attributes: Record<string, string> = { type: "button", class: FIX_BUTTON_CLASS };
  if (pressed) attributes["aria-pressed"] = "false";
  return {
    edits: item.targets.map((t): EditOp => ({ op: "wrapChildren", selector: t.selector, tag: "button", attributes: { ...attributes } })),
    css: BUTTON_CSS,
    note: "Render this control as a real <button type=\"button\"> in its component instead of a clickable <div> or <span>.",
  };
}

function removePositiveTabindex(item: FixRequestItem): Pick<FixEdits, "edits" | "css" | "note"> {
  return {
    edits: item.targets.map((t) => setAttributes(t.selector, { tabindex: "0" })),
    note: "Remove the positive tabindex values in the component and let the DOM order set the Tab order (tabindex=\"0\" where a control needs focus).",
  };
}

/** Deterministic edits for one fix (source "fallback"). Never throws; a fix with nothing to edit yields no edits,
 *  which validateEdits refuses. */
export function fallbackEdits(item: FixRequestItem): FixEdits {
  const body = (() => {
    if (item.targets.length === 0) return { edits: [] as EditOp[], css: undefined, note: "There was no element to edit." };
    switch (item.kind) {
      case "skip-link":
        return skipLink(item);
      case "promote-heading":
        return promoteHeading(item);
      case "add-landmark":
        return addLandmark(item);
      case "add-label":
        return addLabel(item);
      case "real-button":
        return realButton(item);
      case "remove-positive-tabindex":
        return removePositiveTabindex(item);
    }
  })();
  return { fixId: item.fixId, edits: body.edits, ...(body.css ? { css: body.css } : {}), note: body.note, source: "fallback" };
}
