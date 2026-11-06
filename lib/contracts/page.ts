// The page model: what assistive technology "sees" on a rendered page.
// Produced by lib/extract (from a live Document) or by fixtures/pagemodels/builder.ts (in tests).
// Consumed by lib/engine (cost models) and lib/fixes (transforms). Frozen: change only via the lead.

export type NodeId = string;

/** CSS pixels in document coordinates (scroll offset already added), at extraction viewport size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LandmarkRole =
  | "banner"
  | "navigation"
  | "main"
  | "complementary"
  | "contentinfo"
  | "search"
  | "form"
  | "region";

export interface NodeHints {
  /** Styled like a heading (large and/or bold, short) but not exposed as role=heading. */
  looksLikeHeading?: {
    fontSizeRatio: number; // element font-size / body font-size
    fontWeight: number; // computed numeric weight
    suggestedLevel: 1 | 2 | 3 | 4 | 5 | 6;
  };
  /** Behaves like a control (pointer cursor, click handler, role-less) but is not focusable. */
  fakeButton?: boolean;
  /** Interactive control whose accessible name is empty. */
  unlabeled?: boolean;
  /** Best visible/contextual text for an unlabeled control (title, svg <title>, class/icon hint, nearby text). May be "". */
  visualLabel?: string;
  /** A large group a sighted user skims past but an AT user must traverse (mega menu, long footer). */
  repetitiveBlock?: boolean;
}

export interface A11yNode {
  /** Stable id. Equals the element's data-detour-id when present, otherwise a generated path id. */
  id: NodeId;
  /** Computed ARIA role: "link", "button", "heading", "navigation", "list", "listitem", "textbox",
   *  "radio", "checkbox", "combobox", "img", "paragraph", "generic", "text", ... */
  role: string;
  /** Accessible name (W3C accname). For plain text nodes, the text itself. */
  name: string;
  /** Heading level (1-6) when role === "heading". */
  level?: number;
  /** ARIA-style states: "checked" | "not checked" | "expanded" | "collapsed" | "disabled" | "required" |
   *  "selected" | "pressed" | "visited" | "invalid". */
  states: string[];
  /** Reachable by sequential focus navigation (Tab). */
  focusable: boolean;
  /** Value of the tabindex attribute, or null when absent. */
  tabIndex: number | null;
  /** Can be activated or edited (link, button, form control, or a fakeButton with a click handler). */
  actionable: boolean;
  /** Layout box; null when layout is unavailable (jsdom). */
  rect: Rect | null;
  /** Set when this node IS a landmark. */
  landmark?: LandmarkRole;
  parentId: NodeId | null;
  children: NodeId[];
  /** What an NVDA-like screen reader says when the browse-mode cursor lands here sequentially,
   *  including container-entry phrases ("navigation landmark, list with 12 items, link, Men").
   *  Built with lib/a11y/announce.ts. Empty for nodes that are not reading stops. */
  announcement: string;
  /** CSS selector that uniquely identifies the element in the source document. */
  selector: string;
  /** Lower-case tag name of the source element. */
  tag: string;
  hints: NodeHints;
}

export interface SkipLink {
  /** The in-page link (href="#...") node. */
  from: NodeId;
  /** First reading stop at or after the link's target element. */
  to: NodeId;
}

export interface PageModel {
  version: 1;
  url: string;
  title: string;
  viewport: { w: number; h: number };
  docHeight: number;
  root: NodeId;
  nodes: Record<NodeId, A11yNode>;
  /** Browse-mode virtual-cursor stops (down-arrow order). Every interactive element is its own stop;
   *  non-interactive text is one stop per block; headings and images with alt text are stops. */
  readingOrder: NodeId[];
  /** Sequential focus navigation order (positive tabindex ascending first, then DOM order;
   *  excludes tabindex=-1, disabled, hidden and inert). */
  focusOrder: NodeId[];
  /** role=heading nodes in document order (all are also in readingOrder). */
  headings: NodeId[];
  /** Landmark nodes in document order. */
  landmarks: NodeId[];
  skipLinks: SkipLink[];
}
