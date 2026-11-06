// Fix transforms. Every transform is pure at the API boundary (the input page is cloned, never
// mutated), idempotent (re-applying a fix is a no-op) and leaves the model valid (see validatePage).
// Derived arrays and announcements are rebuilt by `recompute` in ./graph.

import type { ApplyFix, FixKind, FixSpec, LandmarkRole, NodeId, PageModel, A11yNode } from "@/lib/contracts";
import { buildTree, firstStopAtOrAfter, firstStopIn, recompute, textOf } from "./graph";
import { MAIN_CONTENT_ANCHOR, SKIP_LINK_ID, SKIP_LINK_NAME, capitalizeFirst, findSkipTarget, isNativelyFocusable } from "./candidates";

type Applier = (draft: PageModel, fix: FixSpec) => void;

function withoutHint<K extends keyof A11yNode["hints"]>(n: A11yNode, key: K): void {
  const hints = { ...n.hints };
  delete hints[key];
  n.hints = hints;
}

const clampLevel = (v: unknown): 1 | 2 | 3 | 4 | 5 | 6 => {
  const n = typeof v === "number" ? Math.round(v) : 2;
  return Math.min(6, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5 | 6;
};

const promoteHeading: Applier = (draft, fix) => {
  const tree = buildTree(draft);
  const done: NodeId[] = [];
  for (const id of fix.targets) {
    const n = draft.nodes[id];
    if (!n || n.role === "heading" || n.focusable || n.actionable || !tree.idx.has(id)) continue;
    // The level was inferred for the whole group at generation time; fall back to the node's own hint.
    const level = typeof fix.params.level === "number" ? clampLevel(fix.params.level) : (n.hints.looksLikeHeading?.suggestedLevel ?? 2);
    const text = textOf(draft, tree, id);
    if (!text) continue;
    n.role = "heading";
    n.level = level;
    n.tag = `h${level}`;
    if (!n.name.trim()) n.name = text;
    withoutHint(n, "looksLikeHeading");
    done.push(id);
  }
  if (done.length) recompute(draft, { addStops: done, reannounce: done });
};

const addLabel: Applier = (draft, fix) => {
  const done: NodeId[] = [];
  for (const id of fix.targets) {
    const n = draft.nodes[id];
    if (!n || !n.hints.unlabeled) continue;
    const fromParams = fix.params[`label:${id}`] ?? fix.params.label;
    const label = capitalizeFirst(n.hints.visualLabel ?? (typeof fromParams === "string" ? fromParams : ""));
    if (!label) continue;
    n.name = label;
    withoutHint(n, "unlabeled");
    done.push(id);
  }
  if (done.length) recompute(draft, { reannounce: done });
};

const realButton: Applier = (draft, fix) => {
  const done: NodeId[] = [];
  const toggle = fix.params.pressed === true;
  for (const id of fix.targets) {
    const n = draft.nodes[id];
    if (!n || !n.hints.fakeButton) continue;
    n.role = "button";
    n.tag = "button";
    n.focusable = true;
    n.actionable = true;
    if ((n.tabIndex ?? 0) < 0) n.tabIndex = null;
    let states = n.states.filter((s) => s !== "not pressed");
    if (toggle) {
      if (states.includes("selected")) states = states.map((s) => (s === "selected" ? "pressed" : s));
      else if (!states.includes("pressed")) states = [...states, "not pressed"];
    }
    n.states = states;
    withoutHint(n, "fakeButton");
    done.push(id);
  }
  if (done.length) recompute(draft, { addStops: done, addFocus: done, reannounce: done });
};

const addLandmark: Applier = (draft, fix) => {
  const wanted: Array<[unknown, LandmarkRole]> = [
    [fix.params.main, "main"],
    [fix.params.contentinfo, "contentinfo"],
  ];
  const marked: NodeId[] = [];
  for (const [value, role] of wanted) {
    if (typeof value !== "string") continue;
    const n = draft.nodes[value];
    if (!n || n.landmark) continue;
    if (role === "main" && Object.values(draft.nodes).some((x) => x.landmark === "main")) continue;
    if (role === "contentinfo" && Object.values(draft.nodes).some((x) => x.landmark === "contentinfo")) continue;
    n.landmark = role;
    n.role = role;
    if (role === "main") n.tag = "main";
    marked.push(value);
  }
  if (!marked.length) return;
  const tree = buildTree(draft);
  const firsts = marked.map((id) => firstStopIn(draft, tree, id)).filter((x): x is NodeId => x !== undefined);
  recompute(draft, { reannounce: firsts });
};

const skipLink: Applier = (draft, fix) => {
  if (draft.nodes[SKIP_LINK_ID]) return;
  const tree = buildTree(draft);
  // Target recorded at generation time (so fixes compose in any order); recomputed if it is gone.
  const wantedEl = typeof fix.params.target === "string" && tree.idx.has(fix.params.target) && fix.params.target !== draft.root ? fix.params.target : undefined;
  const element = wantedEl ?? findSkipTarget(draft, tree)?.element;
  if (!element) return;
  const to = firstStopAtOrAfter(draft, tree, element);
  if (!to) return;
  const root = draft.nodes[draft.root];
  const node: A11yNode = {
    id: SKIP_LINK_ID,
    role: "link",
    name: SKIP_LINK_NAME,
    states: [],
    focusable: true,
    tabIndex: null,
    actionable: true,
    rect: null,
    parentId: root.id,
    children: [],
    announcement: "",
    selector: `a.skip-link[href="#${typeof fix.params.anchor === "string" ? fix.params.anchor : MAIN_CONTENT_ANCHOR}"]`,
    tag: "a",
    hints: {},
  };
  draft.nodes[SKIP_LINK_ID] = node;
  root.children = [SKIP_LINK_ID, ...root.children];
  recompute(draft, { addStops: [SKIP_LINK_ID], addFocus: [SKIP_LINK_ID], addSkipLinks: [{ from: SKIP_LINK_ID, to }], reannounce: [SKIP_LINK_ID] });
};

const removePositiveTabindex: Applier = (draft, fix) => {
  let changed = false;
  for (const id of fix.targets) {
    const n = draft.nodes[id];
    if (!n || (n.tabIndex ?? 0) <= 0) continue;
    // Natively focusable elements drop the attribute; custom widgets keep tabindex="0" so they stay focusable.
    n.tabIndex = isNativelyFocusable(n) ? null : 0;
    changed = true;
  }
  if (changed) recompute(draft, { resortFocus: true });
};

const APPLIERS: Record<FixKind, Applier> = {
  "skip-link": skipLink,
  "promote-heading": promoteHeading,
  "add-landmark": addLandmark,
  "add-label": addLabel,
  "real-button": realButton,
  "remove-positive-tabindex": removePositiveTabindex,
};

function applyInPlace(draft: PageModel, fix: FixSpec): void {
  APPLIERS[fix.kind]?.(draft, fix);
}

/** Apply one fix. Returns a new page; the input is never mutated. Unknown or stale fixes are no-ops. */
export const applyFix: ApplyFix = (page, fix) => {
  const draft = structuredClone(page);
  applyInPlace(draft, fix);
  return draft;
};

/** Apply fixes left to right on a single clone. */
export function applyFixes(page: PageModel, fixes: FixSpec[]): PageModel {
  const draft = structuredClone(page);
  for (const f of fixes) applyInPlace(draft, f);
  return draft;
}

