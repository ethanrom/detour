// Tiny builder for hand-written PageModels in tests. Computes reading order, focus order,
// headings, landmarks, skip links and announcements the same way lib/extract is expected to,
// so engine and fixes tests do not depend on a DOM.

import { announce, type AnnounceContext } from "@/lib/a11y/announce";
import type { A11yNode, LandmarkRole, NodeHints, PageModel, Rect } from "@/lib/contracts";

export interface Spec {
  id: string;
  role: string;
  name?: string;
  level?: number;
  states?: string[];
  focusable?: boolean;
  tabIndex?: number | null;
  actionable?: boolean;
  rect?: Rect | null;
  landmark?: LandmarkRole;
  tag?: string;
  hints?: NodeHints;
  /** In-page link target id (makes this a skip link when role is "link"). */
  href?: string;
  /** Whether this node is a browse-mode reading stop (default: leaf nodes are). */
  stop?: boolean;
  children?: Spec[];
}

const INTERACTIVE = new Set(["link", "button", "textbox", "searchbox", "checkbox", "radio", "combobox", "switch", "option"]);

export function buildPage(root: Spec, opts: { url?: string; title?: string; viewport?: { w: number; h: number } } = {}): PageModel {
  const nodes: Record<string, A11yNode> = {};
  const readingOrder: string[] = [];
  const domFocusable: string[] = [];
  const headings: string[] = [];
  const landmarks: string[] = [];
  const hrefs: Array<{ from: string; target: string }> = [];
  let docHeight = 0;

  const walk = (s: Spec, parentId: string | null, pending: NonNullable<AnnounceContext["enter"]>) => {
    const interactive = INTERACTIVE.has(s.role) || !!s.hints?.fakeButton;
    const focusable = s.focusable ?? (INTERACTIVE.has(s.role) && !(s.states ?? []).includes("disabled"));
    const node: A11yNode = {
      id: s.id,
      role: s.role,
      name: s.name ?? "",
      level: s.level,
      states: s.states ?? [],
      focusable,
      tabIndex: s.tabIndex ?? null,
      actionable: s.actionable ?? interactive,
      rect: s.rect ?? null,
      landmark: s.landmark,
      parentId,
      children: (s.children ?? []).map((c) => c.id),
      announcement: "",
      selector: `[data-detour-id="${s.id}"]`,
      tag: s.tag ?? "div",
      hints: s.hints ?? {},
    };
    nodes[s.id] = node;
    if (s.rect) docHeight = Math.max(docHeight, s.rect.y + s.rect.h);
    if (s.landmark) landmarks.push(s.id);
    if (s.role === "heading") headings.push(s.id);
    if (focusable && (s.tabIndex ?? 0) >= 0) domFocusable.push(s.id);
    if (s.href) hrefs.push({ from: s.id, target: s.href });

    const enter = [...pending];
    if (s.landmark) enter.push({ kind: "landmark", role: s.landmark });
    if (s.role === "list") enter.push({ kind: "list", items: (s.children ?? []).length });

    const isStop = s.stop ?? (!s.children?.length || interactive || s.role === "heading");
    if (isStop) {
      node.announcement = announce(node, { enter });
      readingOrder.push(s.id);
      enter.length = 0;
    }
    let carry = isStop ? [] : enter;
    for (const c of s.children ?? []) {
      walk(c, s.id, carry);
      carry = [];
    }
  };
  walk(root, null, []);

  const positive = domFocusable.filter((id) => (nodes[id].tabIndex ?? 0) > 0).sort((a, b) => nodes[a].tabIndex! - nodes[b].tabIndex!);
  const zero = domFocusable.filter((id) => (nodes[id].tabIndex ?? 0) <= 0);
  const firstStopAtOrAfter = (id: string): string | undefined => {
    const order = Object.keys(nodes);
    const start = order.indexOf(id);
    return readingOrder.find((r) => order.indexOf(r) >= start);
  };

  return {
    version: 1,
    url: opts.url ?? "fixture://page",
    title: opts.title ?? "Fixture page",
    viewport: opts.viewport ?? { w: 1280, h: 800 },
    docHeight,
    root: root.id,
    nodes,
    readingOrder,
    focusOrder: [...positive, ...zero],
    headings,
    landmarks,
    skipLinks: hrefs
      .filter((h) => nodes[h.target])
      .map((h) => ({ from: h.from, to: firstStopAtOrAfter(h.target)! }))
      .filter((s) => s.to),
  };
}
