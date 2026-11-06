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
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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
    // No main landmark and no h1: land on the first stop after the leading run of repetitive blocks.
    const first = blocks.find((b) => stopsIn(page, tree, b).length > 0);
    if (!first) return null;
    let after = tree.end.get(first) as number;
    for (;;) {
      let best = Infinity;
      to = undefined;
      for (const r of page.readingOrder) {
        const i = tree.idx.get(r);
        if (i !== undefined && i > after && i < best) {
          best = i;
          to = r;
        }
      }
      if (to === undefined) break;
      // If that stop sits inside another block, keep going past it.
      const inner = blocks.find((b) => (tree.idx.get(b) as number) <= best && best <= (tree.end.get(b) as number));
      if (!inner) break;
      after = tree.end.get(inner) as number;
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
      rationale: `Lets keyboard users skip ${plural(focusBefore, "Tab stop")} and screen-reader users skip ${plural(readingBefore, "item")} before the main content.`,
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

// Component-level grouping: nodes that share a styleKey come from one component, so a developer
// fixes them in one change and the optimiser treats them as one fix.

/** Group ids by key, keeping first-appearance order. A missing key makes the id its own group. */
function groupByKey(ids: NodeId[], keyOf: (id: NodeId) => string | undefined): NodeId[][] {
  const groups = new Map<string, NodeId[]>();
  for (const id of ids) {
    const key = keyOf(id);
    const k = key === undefined || key === "" ? `\0${id}` : key;
    groups.set(k, [...(groups.get(k) ?? []), id]);
  }
  return [...groups.values()];
}

/** Component identity for grouping. Equal styleKeys always match; on top of that, elements whose class
 *  attribute starts with the same base class (BEM-style: "icon-btn icon-cart" and "icon-btn icon-search",
 *  "thumb" and "thumb is-active") and share tag, font size and weight are one component with variants. */
export function componentKey(n: A11yNode): string | undefined {
  const key = n.hints.styleKey;
  if (!key) return undefined;
  const base = n.hints.className?.trim().split(/\s+/)[0];
  if (!base) return key;
  const [head, ...style] = key.split("|");
  return [`${head.split(".")[0]}.${base}`, ...style].join("|");
}

/** First CSS class of the component ("section-title"), from hints.className or the styleKey. */
function componentClass(n: A11yNode): string | undefined {
  const fromAttr = n.hints.className?.trim().split(/\s+/)[0];
  if (fromAttr) return fromAttr;
  const fromKey = n.hints.styleKey?.split("|")[0].split(".")[1];
  return fromKey || undefined;
}

/** `tag.class-a.class-b` selector for a component, or the node's own selector when no classes are known. */
function componentSelector(n: A11yNode): string {
  const classes = n.hints.className?.trim().split(/\s+/).filter(Boolean) ?? [];
  return classes.length ? `${n.tag}.${classes.join(".")}` : n.selector;
}

const HAS_WORDS = /\p{L}{2,}/u;

/** Level for a group: the most common suggested level (shallowest on ties), pushed down so it is never
 *  higher than one level below the nearest real heading before the group's first node. */
function inferHeadingLevel(page: PageModel, tree: Tree, ids: NodeId[]): 1 | 2 | 3 | 4 | 5 | 6 {
  const counts = new Map<number, number>();
  for (const id of ids) {
    const l = page.nodes[id].hints.looksLikeHeading?.suggestedLevel ?? 2;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let mode = 6;
  let best = 0;
  for (const [l, c] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (c > best) {
      mode = l;
      best = c;
    }
  }
  const at = tree.idx.get(ids[0]) as number;
  let floor = 1;
  let nearest = -1;
  for (const h of page.headings) {
    const hi = tree.idx.get(h);
    const lvl = page.nodes[h]?.level;
    if (hi !== undefined && hi < at && hi > nearest && lvl !== undefined) {
      nearest = hi;
      floor = lvl + 1;
    }
  }
  return Math.min(6, Math.max(mode, floor)) as 1 | 2 | 3 | 4 | 5 | 6;
}

function promoteHeadingCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const eligible = tree.order.filter((id) => {
    const n = page.nodes[id];
    // Never turn a control (a large link or button) into a heading; bare numbers and prices are not headings.
    return !!n.hints.looksLikeHeading && n.role !== "heading" && !n.focusable && !n.actionable && HAS_WORDS.test(textOf(page, tree, id));
  });
  const out: FixSpec[] = [];
  for (const ids of groupByKey(eligible, (id) => componentKey(page.nodes[id]))) {
    const first = page.nodes[ids[0]];
    const n = ids.length;
    const level = inferHeadingLevel(page, tree, ids);
    const text = textOf(page, tree, ids[0]);
    const before = page.readingOrder.filter((r) => (tree.idx.get(r) ?? Infinity) < (tree.idx.get(ids[0]) as number)).length;
    const cls = componentClass(first);
    const params: FixSpec["params"] = { level, text: abbreviate(text, 80), count: n };
    const key = componentKey(first);
    if (n > 1 && key) params.styleKey = key;
    out.push({
      id: n > 1 && key ? `promote-heading:style:${key}` : `promote-heading:${ids[0]}`,
      kind: "promote-heading",
      title: n === 1 ? `Make ${quote(abbreviate(text, 50))} a level-${level} heading` : `Make the ${n} ${quote(cls ?? "styled")} blocks real <h${level}> headings`,
      rationale:
        n > 1
          ? `Screen-reader users can jump between these ${n} titles with the H key instead of stepping through everything between them.`
          : before > 0
            ? `Screen-reader users can reach ${quote(abbreviate(text, 50))} with the H key instead of stepping through the ${before} items before it.`
            : `Exposes ${quote(abbreviate(text, 50))} as a heading so screen-reader users can navigate to it by heading.`,
      targets: ids,
      params,
      patch:
        n === 1
          ? {
              selector: first.selector,
              before: renderElement(first, { inner: abbreviate(text), className: first.hints.className }),
              after: renderElement(first, { tag: `h${level}`, inner: abbreviate(text), className: first.hints.className }),
            }
          : {
              selector: componentSelector(first),
              before: renderElement(first, { inner: abbreviate(text), className: first.hints.className, bare: true }),
              after: renderElement(first, { tag: `h${level}`, inner: abbreviate(text), className: first.hints.className, bare: true }),
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

const labelOf = (n: A11yNode) => capitalizeFirst(n.hints.visualLabel ?? "");
const labelKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function addLabelCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const eligible = tree.order.filter((id) => page.nodes[id].hints.unlabeled && labelOf(page.nodes[id]) !== "");
  const out: FixSpec[] = [];
  for (const group of groupByKey(eligible, (id) => componentKey(page.nodes[id]))) {
    // Each target gets its own label; targets whose label is shared with another target of the group
    // cannot be told apart by name, so they are left for manual or LLM repair.
    const seen = new Map<string, number>();
    for (const id of group) seen.set(labelKey(labelOf(page.nodes[id])), (seen.get(labelKey(labelOf(page.nodes[id]))) ?? 0) + 1);
    const ids = group.filter((id) => seen.get(labelKey(labelOf(page.nodes[id]))) === 1);
    if (!ids.length) continue;

    const first = page.nodes[ids[0]];
    const n = ids.length;
    const labels = ids.map((id) => labelOf(page.nodes[id]));
    const roleWord = ids.every((id) => page.nodes[id].role === first.role) && first.role !== "generic" ? first.role : "control";
    const cls = componentClass(first);
    const params: FixSpec["params"] = n === 1 ? { label: labels[0] } : { count: n };
    if (n > 1) ids.forEach((id, i) => (params[`label:${id}`] = labels[i]));
    const aria = `aria-label="${labels[0].replace(/"/g, "&quot;")}"`;
    out.push({
      id: n > 1 && componentKey(first) ? `add-label:style:${componentKey(first)}` : `add-label:${ids[0]}`,
      kind: "add-label",
      title: n === 1 ? `Label the unlabeled ${roleWord} ${quote(abbreviate(labels[0], 40))}` : `Label the ${n} unlabeled ${cls ? `${quote(cls)} ` : ""}${roleWord}s: ${listNames(labels)}`,
      rationale:
        n === 1
          ? `Screen readers announce this ${roleWord} with no name; ${quote(abbreviate(labels[0], 40))} tells users what it does.`
          : `Screen readers announce these ${n} ${roleWord}s with no name; a label on each tells users what it does.`,
      targets: ids,
      params,
      patch:
        n === 1
          ? {
              selector: first.selector,
              before: renderElement(first, { inner: "…", className: first.hints.className }),
              after: renderElement(first, { inner: "…", className: first.hints.className, trailing: [aria] }),
            }
          : {
              selector: componentSelector(first),
              before: renderElement(first, { inner: "…", className: first.hints.className, bare: true }),
              after: renderElement(first, { inner: "…", className: first.hints.className, bare: true, trailing: [aria] }),
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

/** Fake buttons that belong together: siblings under one parent, or nodes with the same styleKey
 *  (one component), transitively. Groups and members are in document order. */
function fakeButtonGroups(page: PageModel, tree: Tree): NodeId[][] {
  const fake = tree.order.filter((id) => page.nodes[id].hints.fakeButton);
  const root = new Map<NodeId, NodeId>(fake.map((id) => [id, id]));
  const find = (id: NodeId): NodeId => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r) as NodeId;
    return r;
  };
  const union = (a: NodeId, b: NodeId) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root.set(rb, ra);
  };
  const firstBy = new Map<string, NodeId>();
  for (const id of fake) {
    const n = page.nodes[id];
    for (const key of [n.parentId ? `parent:${n.parentId}` : "", componentKey(n) ? `style:${componentKey(n)}` : ""]) {
      if (!key) continue;
      const seen = firstBy.get(key);
      if (seen === undefined) firstBy.set(key, id);
      else union(seen, id);
    }
  }
  return groupByKey(fake, (id) => find(id));
}

function realButtonCandidates(page: PageModel, tree: Tree): FixSpec[] {
  const out: FixSpec[] = [];
  for (const ids of fakeButtonGroups(page, tree)) {
    const first = page.nodes[ids[0]];
    const n = ids.length;
    const names = ids.map((id) => textOf(page, tree, id)).filter(Boolean);
    const noun = groupNoun(ids);
    const cls = componentClass(first);
    const pressed = n > 1;
    const component = n > 1 && !!componentKey(first);
    const title = noun
      ? `Make the ${noun} options real buttons`
      : n === 1
        ? `Make ${names.length ? quote(abbreviate(names[0], 40)) : "the clickable element"} a real button`
        : cls && component
          ? `Make the ${n} ${quote(cls)} elements real buttons`
          : names.length
            ? `Make ${listNames(names)} real buttons`
            : `Make ${n} clickable elements real buttons`;
    const parent = first.parentId;
    const siblings = parent !== null && ids.every((id) => page.nodes[id].parentId === parent);
    const el = { className: first.hints.className, bare: component };
    out.push({
      id: siblings ? `real-button:${parent}` : `real-button:style:${first.id}`,
      kind: "real-button",
      title,
      rationale: `${n} clickable ${n === 1 ? "element has" : "elements have"} no keyboard focus, so keyboard users cannot operate ${n === 1 ? "it" : "them"} and screen readers announce ${n === 1 ? "it" : "them"} only as “clickable”.`,
      targets: ids,
      params: { count: n, pressed },
      patch: {
        selector: component ? componentSelector(first) : first.selector,
        before: renderElement(first, el),
        after: renderElement(first, { ...el, tag: "button", leading: [`type="button"`], trailing: pressed ? [`aria-pressed="false"`] : [] }),
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
