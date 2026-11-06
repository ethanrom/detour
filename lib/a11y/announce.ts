// Deterministic NVDA-style browse-mode announcement printer.
// Shared by lib/extract (initial model) and lib/fixes (re-announcing patched nodes).
// The exact wording approximates NVDA 2024 defaults; what matters for the cost model is the word count.

import type { A11yNode } from "@/lib/contracts";

export type AnnounceInput = Pick<A11yNode, "role" | "name" | "level" | "states"> & {
  hints?: Pick<A11yNode["hints"], "fakeButton">;
};

export interface AnnounceContext {
  /** Containers entered when arriving at this node, outermost first. */
  enter?: Array<
    | { kind: "landmark"; role: string; name?: string }
    | { kind: "list"; items: number }
    | { kind: "table"; rows: number; cols: number }
  >;
}

const ROLE_WORDS: Record<string, string> = {
  link: "link",
  button: "button",
  heading: "heading",
  textbox: "edit",
  searchbox: "search edit",
  checkbox: "check box",
  radio: "radio button",
  combobox: "combo box",
  listbox: "list box",
  option: "option",
  img: "graphic",
  switch: "toggle button",
  tab: "tab",
  menuitem: "menu item",
  slider: "slider",
  spinbutton: "spin button",
};

const LANDMARK_WORDS: Record<string, string> = {
  banner: "banner landmark",
  navigation: "navigation landmark",
  main: "main landmark",
  complementary: "complementary landmark",
  contentinfo: "content info landmark",
  search: "search landmark",
  form: "form landmark",
  region: "region",
};

const STATE_WORDS: Record<string, string> = {
  checked: "checked",
  "not checked": "not checked",
  expanded: "expanded",
  collapsed: "collapsed",
  disabled: "unavailable",
  required: "required",
  selected: "selected",
  pressed: "pressed",
  visited: "visited",
  invalid: "invalid entry",
};

const CHECKABLE = new Set(["checkbox", "radio", "switch"]);

function enterPhrase(ctx: AnnounceContext | undefined): string[] {
  const out: string[] = [];
  for (const c of ctx?.enter ?? []) {
    if (c.kind === "landmark") {
      const w = LANDMARK_WORDS[c.role] ?? `${c.role} landmark`;
      out.push(c.name ? `${c.name} ${w}` : w);
    } else if (c.kind === "list") {
      out.push(`list with ${c.items} item${c.items === 1 ? "" : "s"}`);
    } else {
      out.push(`table with ${c.rows} rows and ${c.cols} columns`);
    }
  }
  return out;
}

/** The phrase spoken when the browse-mode cursor reaches `node`. */
export function announce(node: AnnounceInput, ctx?: AnnounceContext): string {
  const parts = enterPhrase(ctx);
  const name = node.name.trim().replace(/\s+/g, " ");
  const states = node.states.map((s) => STATE_WORDS[s] ?? s);

  if (node.role === "heading") {
    parts.push(`heading, level ${node.level ?? 2}`);
    if (name) parts.push(name);
    return parts.join(", ");
  }

  const roleWord = ROLE_WORDS[node.role];
  if (roleWord) {
    if (node.role === "link" && states.includes("visited")) {
      parts.push("visited link");
    } else {
      parts.push(roleWord);
    }
    const rest = states.filter((s) => !(node.role === "link" && s === "visited"));
    if (CHECKABLE.has(node.role)) {
      // NVDA: "radio button, not checked, Medium"
      parts.push(...rest);
      if (name) parts.push(name);
    } else {
      // NVDA: "button, collapsed, Menu" / "edit, Email, required, blank"
      if (name) parts.push(name);
      parts.push(...rest);
      if (node.role === "textbox" || node.role === "searchbox") parts.push("blank");
    }
    return parts.join(", ");
  }

  // Non-semantic content. A role-less element with a click handler is announced "clickable".
  if (node.hints?.fakeButton) parts.push("clickable");
  if (name) parts.push(name);
  parts.push(...states);
  return parts.join(", ");
}

/** Words spoken, for speech-time estimates. Punctuation is not spoken. */
export function wordCount(text: string): number {
  const t = text.replace(/[,.;:!?()"“”]/g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}
