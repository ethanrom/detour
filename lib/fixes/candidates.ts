// Candidate fix generation. Pure and deterministic: ids and order depend only on the page and tasks.
// Order: skip-link, promote-heading (document order), add-landmark, add-label, real-button, remove-positive-tabindex.

import type { A11yNode, FixSpec, NodeId, PageModel, Task } from "@/lib/contracts";
import { ancestorChain, buildTree, firstStopAtOrAfter, stopsIn, textOf, type Tree } from "./graph";
import { abbreviate, parseSelector, renderElement } from "./html";

export const SKIP_LINK_ID = "fix-skip-link";
export const SKIP_LINK_NAME = "Skip to main content";
export const MAIN_CONTENT_ANCHOR = "main-content";

const NATIVE_FOCUS_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const NATIVE_FOCUS_ROLES = new Set(["link", "button", "textbox", "searchbox", "checkbox", "radio", "combobox", "switch", "option", "slider", "spinbutton"]);

/** Elements that are focusable without a tabindex attribute. */
export function isNativelyFocusable(n: A11yNode): boolean {
  return NATIVE_FOCUS_TAGS.has(n.tag) || NATIVE_FOCUS_ROLES.has(n.role);
}

export function capitalizeFirst(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

const quote = (s: string) => `“${s}”`;

// ---------------------------------------------------------------------------------------------
// skip link

export interface SkipTarget {
  /** Element that receives the anchor id (main landmark, h1, or the first stop after the block). */
  element: NodeId;
  /** First reading stop at or after `element`: where the skip link lands. */
  to: NodeId;
}

function isBlock(n: A11yNode): boolean {
  return !!n.hints.repetitiveBlock || n.landmark === "navigation";
}

/** Where a skip link should land, or null when there is nothing to bypass. */
export function findSkipTarget(page: PageModel, tree: Tree): SkipTarget | null {
  const readingSet = new Set(page.readingOrder);
  const blocks = tree.order.filter((id) => id !== SKIP_LINK_ID && isBlock(page.nodes[id]));
  const isH1 = (id: NodeId) => page.nodes[id]?.role === "heading" && page.nodes[id].level === 1 && tree.idx.has(id);

  let element: NodeId | undefined = tree.order.find((id) => page.nodes[id].landmark === "main");
  if (!element) element = page.headings.find(isH1) ?? tree.order.find((id) => isH1(id) && readingSet.has(id));

  let to: NodeId | undefined;
  if (element) {
    to = firstStopAtOrAfter(page, tree, element);
  } else {
    const first = blocks[0];
    if (!first) return null;
    const after = tree.end.get(first) as number;
    let best = Infinity;
    for (const r of page.readingOrder) {
      const i = tree.idx.get(r);
      if (i !== undefined && i > after && i < best) {
        best = i;
        to = r;
      }
    }
    element = to;
  }
  if (!element || !to) return null;

  // Something must lie entirely before the target for the link to save anything.
  const toIdx = tree.idx.get(to) as number;
  const bypasses = blocks.some((b) => (tree.end.get(b) as number) < toIdx && stopsIn(page, tree, b).length > 0);
  return bypasses ? { element, to } : null;
}

function skipLinkCandidates(page: PageModel, tree: Tree): FixSpec[] {
  if (page.skipLinks.length > 0 || page.nodes[SKIP_LINK_ID]) return [];
  const target = findSkipTarget(page, tree);
  if (!target) return [];
  const el = page.nodes[target.element];
  const toIdx = tree.idx.get(target.to) as number;
  const readingBefore = page.readingOrder.filter((r) => (tree.idx.get(r) ?? Infinity) < toIdx).length;
  const focusBefore = page.focusOrder.filter((f) => (tree.idx.get(f) ?? Infinity) < toIdx).length;
  const anchor = parseSelector(el.selector).id ?? MAIN_CONTENT_ANCHOR;
  const link = `<a class="skip-link" href="#${anchor}">${SKIP_LINK_NAME}</a>`;
  const elBefore = renderElement(el, { inner: el.name.trim() ? abbreviate(el.name) : "…" });
  const elAfter = renderElement(el, { inner: el.name.trim() ? abbreviate(el.name) : "…", leading: anchor === MAIN_CONTENT_ANCHOR ? [`id="${anchor}"`] : [] });
  return [
    {
      id: "skip-link:main",
      kind: "skip-link",
      title: `Add a ${quote(SKIP_LINK_NAME)} link`,
      rationale: `Lets keyboard users skip ${focusBefore} Tab stops and screen-reader users skip ${readingBefore} items before the main content.`,
      targets: [target.element],
      params: { target: target.element, stop: target.to, anchor, linkId: SKIP_LINK_ID, label: SKIP_LINK_NAME },
      patch: {
        selector: "body",
        before: `<body>\n  …\n  ${elBefore}`,
        after: `<body>\n  ${link}\n  …\n  ${elAfter}`,
      },
      wcag: ["2.4.1 Bypass Blocks"],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// promote-heading

function promoteHeadingCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const out: FixSpec[] = [];
  for (const id of tree.order) {
    const n = page.nodes[id];
    const hint = n.hints.looksLikeHeading;
    if (!hint || n.role === "heading") continue;
    const text = textOf(page, tree, id);
    if (!text) continue;
    const level = hint.suggestedLevel;
    const before = page.readingOrder.filter((r) => (tree.idx.get(r) ?? Infinity) < (tree.idx.get(id) as number)).length;
    out.push({
      id: `promote-heading:${id}`,
      kind: "promote-heading",
      title: `Make ${quote(abbreviate(text, 50))} a level-${level} heading`,
      rationale:
        before > 0
          ? `Screen-reader users can reach ${quote(abbreviate(text, 50))} with the H key instead of stepping through the ${before} items before it.`
          : `Exposes ${quote(abbreviate(text, 50))} as a heading so screen-reader users can navigate to it by heading.`,
      targets: [id],
      params: { level, text: abbreviate(text, 80) },
      patch: {
        selector: n.selector,
        before: renderElement(n, { inner: abbreviate(text) }),
        after: renderElement(n, { tag: `h${level}`, inner: abbreviate(text) }),
      },
      wcag: ["1.3.1 Info and Relationships", "2.4.6 Headings and Labels"],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// add-landmark

const SECTIONING_TAGS = new Set(["article", "section", "aside", "main", "nav"]);
const CONTAINER_ROLES = new Set(["generic", "group", "region", "article"]);

/** Page-level header/footer/navigation chrome that must not end up inside <main>. */
function isChrome(page: PageModel, id: NodeId): boolean {
  const n = page.nodes[id];
  if (n.landmark === "banner" || n.landmark === "contentinfo" || n.hints.repetitiveBlock) return true;
  if (n.tag === "header" || n.tag === "footer") {
    return !ancestorChain(page, id).slice(0, -1).some((a) => SECTIONING_TAGS.has(a.tag));
  }
  return false;
}

function lowestCommonAncestor(page: PageModel, ids: NodeId[]): NodeId | undefined {
  const chains = ids.map((id) => ancestorChain(page, id));
  let common: NodeId | undefined;
  for (let depth = 0; ; depth++) {
    const first = chains[0][depth];
    if (!first || !chains.every((c) => c[depth]?.id === first.id)) break;
    common = first.id;
  }
  return common;
}

function chooseMainContainer(page: PageModel, tree: Tree, tasks: Task[]): NodeId | undefined {
  // Prefix counts over preorder: chrome nodes and reading stops.
  const stopSet = new Set(page.readingOrder);
  const chrome: number[] = [];
  const stops: number[] = [];
  tree.order.forEach((id, i) => {
    chrome[i] = (chrome[i - 1] ?? 0) + (isChrome(page, id) ? 1 : 0);
    stops[i] = (stops[i - 1] ?? 0) + (stopSet.has(id) ? 1 : 0);
  });
  const range = (pre: number[], id: NodeId) => pre[tree.end.get(id) as number] - (pre[(tree.idx.get(id) as number) - 1] ?? 0);

  const valid = (id: NodeId): boolean => {
    const n = page.nodes[id];
    if (id === page.root || n.parentId === null || n.landmark || n.children.length === 0 || n.actionable || !CONTAINER_ROLES.has(n.role)) return false;
    if (range(chrome, id) > 0 || range(stops, id) === 0) return false;
    return !ancestorChain(page, id).slice(0, -1).some((a) => a.landmark);
  };

  const h1 = page.headings.find((h) => page.nodes[h]?.level === 1 && tree.idx.has(h)) ?? tree.order.find((id) => page.nodes[id].role === "heading" && page.nodes[id].level === 1);
  if (h1) {
    const targets = tasks.flatMap((t) => t.steps.map((s) => s.target)).filter((id) => tree.idx.has(id));
    const anchors = [...new Set([h1, ...targets])];
    let c = lowestCommonAncestor(page, anchors);
    // The container must be a proper ancestor of every anchor; climb past non-container roles (lists, text).
    while (c && (anchors.includes(c) || (c !== page.root && !CONTAINER_ROLES.has(page.nodes[c].role)))) c = page.nodes[c].parentId ?? undefined;
    if (c && valid(c)) return c;
  }

  // Fallback: the container with the most reading stops (outermost on ties) that holds no chrome.
  let best: NodeId | undefined;
  let bestCount = 0;
  for (const id of tree.order) {
    if (!valid(id)) continue;
    const count = range(stops, id);
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

function chooseFooter(page: PageModel, tree: Tree, main: NodeId | undefined): NodeId | undefined {
  if (tree.order.some((id) => page.nodes[id].landmark === "contentinfo")) return undefined;
  const isFooter = (id: NodeId) => {
    const n = page.nodes[id];
    return !!n.hints.repetitiveBlock && !n.landmark && (n.tag === "footer" || /footer/i.test(`${n.id} ${n.selector}`)) && stopsIn(page, tree, id).length > 0;
  };
  const footers = tree.order.filter(isFooter);
  const last = footers[footers.length - 1];
  if (!last) return undefined;
  // Outermost footer-like ancestor-or-self of the last one.
  const outer = ancestorChain(page, last).find((a) => isFooter(a.id))?.id ?? last;
  if (main && (tree.idx.get(outer) as number) >= (tree.idx.get(main) as number) && (tree.idx.get(outer) as number) <= (tree.end.get(main) as number)) return undefined;
  if (ancestorChain(page, outer).slice(0, -1).some((a) => a.landmark)) return undefined;
  return outer;
}

function addLandmarkCandidates(page: PageModel, tree: Tree, tasks: Task[]): FixSpec[] {
  const hasMain = tree.order.some((id) => page.nodes[id].landmark === "main");
  const main = hasMain ? undefined : chooseMainContainer(page, tree, tasks);
  const footer = chooseFooter(page, tree, main);
  if (!main && !footer) return [];

  const params: Record<string, string> = {};
  const targets: NodeId[] = [];
  const selectors: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  if (main) {
    const n = page.nodes[main];
    params.main = main;
    targets.push(main);
    selectors.push(n.selector);
    before.push(renderElement(n, { inner: "…" }));
    after.push(n.tag === "main" ? renderElement(n, { leading: [`role="main"`], inner: "…" }) : renderElement(n, { tag: "main", inner: "…" }));
  }
  if (footer) {
    const n = page.nodes[footer];
    params.contentinfo = footer;
    targets.push(footer);
    selectors.push(n.selector);
    before.push(renderElement(n, { inner: "…" }));
    after.push(renderElement(n, { leading: [`role="contentinfo"`], omit: ["role"], inner: "…" }));
  }
  const title = main && footer ? "Mark the main content and footer as landmarks" : main ? "Mark the main content as a main landmark" : "Mark the footer as a content info landmark";
  return [
    {
      id: `add-landmark:${targets.join("+")}`,
      kind: "add-landmark",
      title,
      rationale: `Screen-reader users can jump to the ${main && footer ? "main content or footer" : main ? "main content" : "footer"} with the landmark key instead of stepping through everything before it.`,
      targets,
      params,
      patch: { selector: selectors.join(", "), before: before.join("\n"), after: after.join("\n") },
      wcag: ["1.3.1 Info and Relationships", "2.4.1 Bypass Blocks"],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// add-label

function addLabelCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const out: FixSpec[] = [];
  for (const id of tree.order) {
    const n = page.nodes[id];
    const label = capitalizeFirst(n.hints.visualLabel ?? "");
    if (!n.hints.unlabeled || !label) continue;
    out.push({
      id: `add-label:${id}`,
      kind: "add-label",
      title: `Label the unlabeled ${n.role} ${quote(abbreviate(label, 40))}`,
      rationale: `Screen readers announce this ${n.role} with no name; ${quote(abbreviate(label, 40))} tells users what it does.`,
      targets: [id],
      params: { label },
      patch: {
        selector: n.selector,
        before: renderElement(n, { inner: "…" }),
        after: renderElement(n, { inner: "…", trailing: [`aria-label="${label.replace(/"/g, "&quot;")}"`] }),
      },
      wcag: ["4.1.2 Name, Role, Value", "2.5.3 Label in Name"],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// real-button

const GENERIC_WORDS = new Set(["div", "span", "item", "node", "btn", "button", "link", "control", "option", "el", "elem", "element", "generic"]);

/** Shared leading word of the ids of a group ("size-xs", "size-s" → "size"), when it reads as a noun. */
function groupNoun(ids: string[]): string | null {
  if (ids.length < 2) return null;
  const firsts = ids.map((i) => i.split(/[-_:.\s]+/)[0]?.toLowerCase() ?? "");
  const w = firsts[0];
  if (w.length < 3 || /\d/.test(w) || GENERIC_WORDS.has(w) || !firsts.every((f) => f === w)) return null;
  return w;
}

function listNames(names: string[]): string {
  const q = names.map((s) => quote(abbreviate(s, 24)));
  if (q.length <= 3) return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
  return `${q[0]}, ${q[1]} and ${q.length - 2} more`;
}

function realButtonCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const groups = new Map<NodeId, NodeId[]>();
  for (const id of tree.order) {
    const n = page.nodes[id];
    if (!n.hints.fakeButton) continue;
    const key = n.parentId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const out: FixSpec[] = [];
  for (const [parent, ids] of groups) {
    const first = page.nodes[ids[0]];
    const names = ids.map((id) => textOf(page, tree, id)).filter(Boolean);
    const noun = groupNoun(ids);
    const pressed = ids.length > 1;
    const title = noun
      ? `Make the ${noun} options real buttons`
      : ids.length === 1
        ? `Make ${names.length ? quote(abbreviate(names[0], 40)) : "the clickable element"} a real button`
        : names.length
          ? `Make ${listNames(names)} real buttons`
          : `Make ${ids.length} clickable elements real buttons`;
    const n = ids.length;
    out.push({
      id: `real-button:${parent || first.id}`,
      kind: "real-button",
      title,
      rationale: `${n} clickable ${n === 1 ? "element has" : "elements have"} no keyboard focus, so keyboard users cannot operate ${n === 1 ? "it" : "them"} and screen readers announce ${n === 1 ? "it" : "them"} only as “clickable”.`,
      targets: ids,
      params: { count: n, pressed },
      patch: {
        selector: first.selector,
        before: renderElement(first),
        after: renderElement(first, { tag: "button", leading: [`type="button"`], trailing: pressed ? [`aria-pressed="false"`] : [] }),
      },
      wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// remove-positive-tabindex

function removePositiveTabindexCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const ids = tree.order.filter((id) => (page.nodes[id].tabIndex ?? 0) > 0);
  if (ids.length === 0) return [];
  const first = page.nodes[ids[0]];
  const n = ids.length;
  const max = Math.max(...ids.map((id) => page.nodes[id].tabIndex as number));
  const fixed = (node: A11yNode) => (isNativelyFocusable(node) ? [] : [`tabindex="0"`]);
  return [
    {
      id: "remove-positive-tabindex",
      kind: "remove-positive-tabindex",
      title: `Remove positive tabindex from ${n} element${n === 1 ? "" : "s"}`,
      rationale: `Positive tabindex values make Tab jump around the page out of reading order; removing ${n === 1 ? "it" : "them"} restores page order.`,
      targets: ids,
      params: { count: n, maxTabIndex: max },
      patch: {
        selector: first.selector,
        before: renderElement(first, { trailing: [`tabindex="${first.tabIndex}"`], omit: ["tabindex"] }),
        after: renderElement(first, { trailing: fixed(first), omit: ["tabindex"] }),
      },
      wcag: ["2.4.3 Focus Order"],
    },
  ];
}

// ---------------------------------------------------------------------------------------------

/** Every candidate fix for a page, in a deterministic order. `tasks` only steers where the main
 *  landmark goes (nearest common ancestor of the h1 and the task targets). */
export function generateCandidates(page: PageModel, tasks: Task[] = []): FixSpec[] {
  const tree = buildTree(page);
  return [
    ...skipLinkCandidates(page, tree),
    ...promoteHeadingCandidates(page, tree),
    ...addLandmarkCandidates(page, tree, tasks),
    ...addLabelCandidates(page, tree),
    ...realButtonCandidates(page, tree),
    ...removePositiveTabindexCandidates(page, tree),
  ];
}
