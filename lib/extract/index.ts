// Document -> PageModel. The extraction layer: walks a live DOM in document order, resolves roles, names,
// states, focus order and browse-mode reading stops, and attaches heuristic hints for the fix generator.
//
// Reading-order model (NVDA browse mode, simplified):
//  - every interactive element is one stop; headings, images with alt text, fake buttons are stops;
//  - every block of non-interactive text is one stop (the block element itself when it holds only text,
//    otherwise one synthetic "text" node per run of text between controls/blocks);
//  - landmarks and lists are never stops, their entry phrase is spoken with the first stop inside them.

import { announce, type AnnounceContext } from "@/lib/a11y/announce";
import type { A11yNode, PageModel, Rect, SkipLink } from "@/lib/contracts";
import {
  computeVisible,
  createEnv,
  type Env,
  isElement,
  isHiddenSubtree,
  isInline,
  isSkippedTag,
  NO_WALK_TAGS,
  norm,
  TEXT_NODE,
  visibleText,
} from "./dom";
import { isTabStop, orderFocus, tabIndexAttr } from "./focus";
import { hasSemanticDescendants, isClickTarget, looksLikeHeadingHint, styleKeyOf, visualLabelFor } from "./hints";
import {
  canBeFakeButtonRole,
  CONTAINER_ROLES,
  containerRoleOf,
  headingLevelOf,
  interactiveRoleOf,
  isTextRole,
  landmarkOf,
  roleOf,
  safeName,
  statesOf,
  textRoleOf,
} from "./roles";
import { attrSelector, cssPath } from "./selector";

export interface ExtractOptions {
  /** URL recorded on the model (defaults to the document URL). */
  url?: string;
  /** Attribute carrying author-assigned stable ids (default "data-detour-id"). */
  idAttr?: string;
}

type Enter = NonNullable<AnnounceContext["enter"]>;

interface Draft {
  node: A11yNode;
  /** Source element (the parent element for synthetic text runs). */
  el: Element;
  /** Document-order anchor used to resolve skip-link targets. */
  anchor: Node;
  children: Draft[];
  stop: boolean;
  synthetic: boolean;
  /** Items spoken in "list with N items". */
  listItems: number;
}

interface Run {
  parts: string[];
  first: Text | null;
  last: Text | null;
}

interface Ctx {
  items: Draft[];
  run: Run | null;
  /** Inside an interactive element/heading: only nested controls and headings become nodes. */
  suppress: boolean;
  /** Element that owns this context's items. */
  cont: Element;
}

interface DraftInit {
  role: string;
  name: string;
  stop: boolean;
  /** Role used to derive ARIA states (defaults to `role`). */
  stateRole?: string | null;
  level?: number;
  actionable?: boolean;
  landmark?: A11yNode["landmark"];
  anchor?: Node;
}

/** Tags always kept as container nodes (when they hold something), even if they have a single child. */
const KEEP_TAGS = new Set(["nav", "header", "footer", "main", "aside", "section", "article", "form", "ul", "ol", "details"]);

const round2 = (n: number) => Math.round(n * 100) / 100;

class Extractor {
  /** Unlabeled controls whose visualLabel is only nearby sibling text (siblings may share it). */
  private readonly weakLabels: Draft[] = [];

  constructor(private readonly env: Env) {}

  // ---------- geometry ----------

  private toRect(r: DOMRect): Rect {
    const win = this.env.win;
    const sx = win?.scrollX ?? win?.pageXOffset ?? 0;
    const sy = win?.scrollY ?? win?.pageYOffset ?? 0;
    return { x: round2(r.left + sx), y: round2(r.top + sy), w: round2(r.width), h: round2(r.height) };
  }

  private rectOf(el: Element): Rect | null {
    if (!this.env.layout) return null;
    try {
      return this.toRect(el.getBoundingClientRect());
    } catch {
      return null;
    }
  }

  private rectOfRange(first: Text, last: Text): Rect | null {
    if (!this.env.layout) return null;
    try {
      const range = this.env.doc.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      return this.toRect(range.getBoundingClientRect());
    } catch {
      return null;
    }
  }

  // ---------- drafts ----------

  private draft(el: Element, init: DraftInit): Draft {
    const tabbable = isTabStop(el);
    const node: A11yNode = {
      id: "",
      role: init.role,
      name: init.name,
      states: statesOf(el, init.stateRole === undefined ? init.role : init.stateRole),
      focusable: tabbable,
      tabIndex: tabIndexAttr(el),
      actionable: init.actionable ?? false,
      rect: this.rectOf(el),
      parentId: null,
      children: [],
      announcement: "",
      selector: "",
      tag: el.localName,
      hints: {},
    };
    if (init.level !== undefined) node.level = init.level;
    if (init.landmark) node.landmark = init.landmark;
    return { node, el, anchor: init.anchor ?? el, children: [], stop: init.stop, synthetic: false, listItems: 0 };
  }

  private isClickable(el: Element): boolean {
    const html = el as HTMLElement;
    return el.hasAttribute("onclick") || typeof html.onclick === "function" || this.env.style(el).cursor === "pointer";
  }

  // ---------- text runs ----------

  private addText(ctx: Ctx, text: Text) {
    const run = (ctx.run ??= { parts: [], first: null, last: null });
    run.parts.push(text.data);
    if (/\S/.test(text.data)) {
      run.first ??= text;
      run.last = text;
    }
  }

  private flush(ctx: Ctx) {
    const run = ctx.run;
    ctx.run = null;
    if (!run || !run.first || !run.last) return;
    const name = norm(run.parts.join(""));
    if (!name) return;
    const node: A11yNode = {
      id: "",
      role: "text",
      name,
      states: [],
      focusable: false,
      tabIndex: null,
      actionable: false,
      rect: this.rectOfRange(run.first, run.last),
      parentId: null,
      children: [],
      announcement: "",
      selector: "",
      tag: ctx.cont.localName,
      hints: {},
    };
    ctx.items.push({ node, el: ctx.cont, anchor: run.first, children: [], stop: true, synthetic: true, listItems: 0 });
  }

  // ---------- walking ----------

  private walkChildren(parent: Element, ctx: Ctx) {
    let kids: ChildNode[] = Array.from(parent.childNodes);
    if (parent.localName === "details" && !parent.hasAttribute("open")) {
      // Closed disclosure: only the first <summary> is rendered.
      const summary = Array.from(parent.children).find((c) => c.localName === "summary");
      kids = summary ? [summary] : [];
    }
    const textVisible = this.env.visible.get(parent) !== false;
    for (const child of kids) {
      if (child.nodeType === TEXT_NODE) {
        if (!ctx.suppress && textVisible) this.addText(ctx, child as Text);
      } else if (isElement(child)) {
        this.visit(child, ctx);
      }
    }
  }

  private visit(el: Element, ctx: Ctx) {
    const env = this.env;
    if (isSkippedTag(el) || isHiddenSubtree(el, env)) return;
    const tag = el.localName;
    const vis = computeVisible(el, env);
    env.visible.set(el, vis);
    if (!vis) {
      // visibility:hidden removes the element itself, but a descendant may set visibility:visible.
      if (!NO_WALK_TAGS.has(tag)) this.walkChildren(el, ctx);
      return;
    }

    const role = roleOf(el);

    const interactive = interactiveRoleOf(el, role);
    if (interactive) return this.visitInteractive(el, interactive, ctx);
    if (role === "heading") return this.visitHeading(el, ctx);
    if (tag === "br") {
      if (!ctx.suppress && ctx.run) ctx.run.parts.push(" ");
      return;
    }
    if (tag === "label" && !ctx.suppress && this.labelsReadingStop(el)) {
      // The label text is part of its control's name: browse mode reads control and label as one item.
      this.flush(ctx);
      this.walkChildren(el, { items: ctx.items, run: null, suppress: true, cont: ctx.cont });
      return;
    }
    if (ctx.suppress) {
      if (!NO_WALK_TAGS.has(tag)) this.walkChildren(el, ctx);
      return;
    }
    if (role === "img") return this.visitImage(el, ctx);
    if (tag === "svg" || tag === "math") return;
    if (canBeFakeButtonRole(role) && isClickTarget(el, env) && !hasSemanticDescendants(el)) {
      if (this.visitFakeButton(el, role, ctx)) return;
    }

    const hasOwnId = el.hasAttribute(env.idAttr);
    const inlineFlow = isInline(el, env) && !hasOwnId && !isTabStop(el) && !(role && CONTAINER_ROLES.has(role));
    if (inlineFlow) {
      this.walkChildren(el, ctx);
      return;
    }
    this.flush(ctx);
    ctx.items.push(...this.buildBlock(el, role));
  }

  private markUnlabeled(d: Draft) {
    d.node.hints.unlabeled = true;
    const label = visualLabelFor(d.el);
    d.node.hints.visualLabel = label.text;
    if (label.weak) this.weakLabels.push(d);
  }

  /** True when `label` names a rendered form control that will be a reading stop of its own. */
  private labelsReadingStop(label: Element): boolean {
    const env = this.env;
    const forId = label.getAttribute("for");
    const control = forId ? env.doc.getElementById(forId) : label.querySelector("input:not([type=hidden]), select, textarea, button");
    if (!control || !["input", "select", "textarea", "button"].includes(control.localName)) return false;
    if (isSkippedTag(control) || !interactiveRoleOf(control, roleOf(control))) return false;
    const v = env.style(control).visibility;
    if (v === "hidden" || v === "collapse") return false;
    for (let e: Element | null = control; e; e = e.parentElement) if (isHiddenSubtree(e, env)) return false;
    return true;
  }

  private visitInteractive(el: Element, role: string, ctx: Ctx) {
    if (!ctx.suppress) this.flush(ctx);
    let name = safeName(el);
    const tag = el.localName;
    if (!name && (tag === "input" || tag === "textarea")) name = norm(el.getAttribute("placeholder") ?? "");
    const d = this.draft(el, { role, name, stop: true, actionable: true });
    if (!name) {
      this.markUnlabeled(d);
    }
    if (!NO_WALK_TAGS.has(tag)) {
      const sub: Ctx = { items: [], run: null, suppress: true, cont: el };
      this.walkChildren(el, sub);
      d.children = sub.items;
    }
    ctx.items.push(d);
  }

  private visitHeading(el: Element, ctx: Ctx) {
    if (!ctx.suppress) this.flush(ctx);
    const d = this.draft(el, { role: "heading", name: safeName(el), stop: true, level: headingLevelOf(el) });
    const sub: Ctx = { items: [], run: null, suppress: true, cont: el };
    this.walkChildren(el, sub);
    d.children = sub.items;
    ctx.items.push(d);
  }

  private visitImage(el: Element, ctx: Ctx) {
    const name = safeName(el);
    if (!name) return; // decorative
    this.flush(ctx);
    const d = this.draft(el, { role: "img", name, stop: true });
    if (isClickTarget(el, this.env)) {
      d.node.hints.fakeButton = true;
      d.node.actionable = true;
    }
    ctx.items.push(d);
  }

  /** Returns false when the element should be treated as ordinary content instead. */
  private visitFakeButton(el: Element, role: string | null, ctx: Ctx): boolean {
    const name = safeName(el) || visibleText(el, this.env) || norm(el.getAttribute("title") ?? "");
    if (!name && this.env.layout) {
      const r = this.rectOf(el);
      if (r && r.w * r.h === 0) return false;
    }
    this.flush(ctx);
    const d = this.draft(el, { role: textRoleOf(el, role), name, stop: true, stateRole: role, actionable: true });
    d.node.hints.fakeButton = true;
    if (!name) {
      this.markUnlabeled(d);
    }
    ctx.items.push(d);
    return true;
  }

  private countListItems(el: Element, fallback: number): number {
    let n = 0;
    for (const c of Array.from(el.children)) {
      if (isSkippedTag(c) || isHiddenSubtree(c, this.env)) continue;
      if (roleOf(c) === "listitem") n++;
    }
    return n || fallback;
  }

  /** A block-level element: either a text node of its own, a container, or flattened into its parent. */
  private buildBlock(el: Element, role: string | null): Draft[] {
    const env = this.env;
    const sub: Ctx = { items: [], run: null, suppress: false, cont: el };
    this.walkChildren(el, sub);
    this.flush(sub);
    const items = sub.items;
    if (items.length === 0) return [];

    const landmark = landmarkOf(role);
    const tabbable = isTabStop(el);
    const structural = !!role && CONTAINER_ROLES.has(role);

    // Only text inside: the element itself is the text stop.
    if (items.length === 1 && items[0].synthetic && !landmark && (!structural || isTextRole(role))) {
      const name = items[0].node.name;
      const d = this.draft(el, {
        role: textRoleOf(el, role),
        name,
        stop: true,
        stateRole: role,
        actionable: tabbable && this.isClickable(el),
      });
      d.anchor = items[0].anchor;
      if (d.node.role === "generic" || d.node.role === "paragraph" || d.node.role === "legend" || d.node.role === "caption") {
        const h = looksLikeHeadingHint(el, name, env);
        if (h) d.node.hints.looksLikeHeading = h;
      }
      return [d];
    }

    const keep = !!landmark || structural || tabbable || KEEP_TAGS.has(el.localName) || el.hasAttribute(env.idAttr);
    if (!keep && items.length < 2) return items;

    const cRole = landmark ?? containerRoleOf(el, role);
    const named = CONTAINER_ROLES.has(cRole) && !isTextRole(cRole);
    const d = this.draft(el, {
      role: cRole,
      name: named ? safeName(el) : "",
      stop: false,
      stateRole: role,
      landmark,
      actionable: tabbable && this.isClickable(el),
    });
    d.children = items;
    if (cRole === "list") d.listItems = this.countListItems(el, items.length);
    return [d];
  }

  // ---------- model assembly ----------

  extract(opts: ExtractOptions): PageModel {
    const env = this.env;
    const doc = env.doc;
    const body = doc.body;
    const win = env.win;
    const viewport = { w: win?.innerWidth || 1280, h: win?.innerHeight || 800 };
    const docHeight = doc.documentElement?.scrollHeight || 0;
    const url = opts.url ?? doc.URL ?? "";
    const title = doc.title ?? "";

    if (!body) {
      const id = "n0";
      const node: A11yNode = {
        id,
        role: "document",
        name: "",
        states: [],
        focusable: false,
        tabIndex: null,
        actionable: false,
        rect: null,
        parentId: null,
        children: [],
        announcement: "",
        selector: "body",
        tag: "body",
        hints: {},
      };
      return { version: 1, url, title, viewport, docHeight, root: id, nodes: { [id]: node }, readingOrder: [], focusOrder: [], headings: [], landmarks: [], skipLinks: [] };
    }

    const rootCtx: Ctx = { items: [], run: null, suppress: false, cont: body };
    env.visible.set(body, computeVisible(body, env));
    if (!isHiddenSubtree(body, env)) {
      this.walkChildren(body, rootCtx);
      this.flush(rootCtx);
    }
    const root = this.draft(body, { role: "document", name: "", stop: false, stateRole: null });
    root.node.focusable = false;
    root.node.hints = {};
    root.children = rootCtx.items;

    return this.assemble(root, { url, title, viewport, docHeight }, body);
  }

  private assemble(root: Draft, meta: Pick<PageModel, "url" | "title" | "viewport" | "docHeight">, body: Element): PageModel {
    const env = this.env;
    const idAttr = env.idAttr;

    // Author ids: first holder of each value wins; generated ids must avoid every author id.
    const authorIds = new Map<Element, string>();
    const seenAuthor = new Set<string>();
    const collect = (d: Draft) => {
      if (!d.synthetic) {
        const v = d.el.getAttribute(idAttr);
        if (v && v.trim() && !seenAuthor.has(v)) {
          seenAuthor.add(v);
          authorIds.set(d.el, v);
        }
      }
      d.children.forEach(collect);
    };
    collect(root);

    const attrCounts = new Map<string, number>();
    for (const el of env.index.keys()) {
      const v = el.getAttribute(idAttr);
      if (v && v.trim()) attrCounts.set(v, (attrCounts.get(v) ?? 0) + 1);
    }

    const used = new Set<string>();
    const runCounter = new Map<Element, number>();
    const selectorFor = (el: Element): string => {
      const v = el.getAttribute(idAttr);
      if (v && attrCounts.get(v) === 1) return attrSelector(idAttr, v);
      return cssPath(el, body);
    };
    const assignId = (d: Draft): string => {
      const author = d.synthetic ? undefined : authorIds.get(d.el);
      if (author) {
        used.add(author);
        return author;
      }
      const idx = env.index.get(d.el) ?? 0;
      let base = `n${idx}`;
      if (d.synthetic) {
        const k = runCounter.get(d.el) ?? 0;
        runCounter.set(d.el, k + 1);
        base = `n${idx}t${k}`;
      }
      let id = base;
      for (let k = 2; used.has(id) || seenAuthor.has(id); k++) id = `${base}-${k}`;
      used.add(id);
      return id;
    };

    // Nearby-text labels are only trusted when no sibling control in the same parent would get the same text.
    const byParent = new Map<Element, Map<string, Draft[]>>();
    for (const d of this.weakLabels) {
      const parent = d.el.parentElement;
      if (!parent) continue;
      const text = d.node.hints.visualLabel ?? "";
      const texts = byParent.get(parent) ?? new Map<string, Draft[]>();
      texts.set(text, [...(texts.get(text) ?? []), d]);
      byParent.set(parent, texts);
    }
    for (const texts of byParent.values()) {
      for (const group of texts.values()) if (group.length > 1) for (const d of group) d.node.hints.visualLabel = "";
    }

    const nodes: Record<string, A11yNode> = {};
    const readingOrder: string[] = [];
    const headings: string[] = [];
    const landmarks: string[] = [];
    const focusStops: A11yNode[] = [];
    const stops: Draft[] = [];
    const hashLinks: Draft[] = [];

    const visit = (d: Draft, parent: Draft | null, pending: Enter): number => {
      const n = d.node;
      n.id = assignId(d);
      n.parentId = parent ? parent.node.id : null;
      n.selector = selectorFor(d.el);
      if (!d.synthetic && (n.hints.looksLikeHeading || n.hints.fakeButton || n.hints.unlabeled)) {
        n.hints.className = d.el.getAttribute("class") ?? "";
        n.hints.styleKey = styleKeyOf(d.el, env, !!n.hints.looksLikeHeading);
      }
      nodes[n.id] = n;
      if (n.landmark) landmarks.push(n.id);
      if (n.role === "heading") headings.push(n.id);
      if (n.focusable) focusStops.push(n);
      if (!d.synthetic && n.role === "link" && (d.el.getAttribute("href") ?? "").startsWith("#")) hashLinks.push(d);

      const enter: Enter = [...pending];
      if (n.landmark) enter.push({ kind: "landmark", role: n.landmark, ...(n.name ? { name: n.name } : {}) });
      if (n.role === "list") enter.push({ kind: "list", items: d.listItems });

      let carry: Enter;
      if (d.stop) {
        n.announcement = announce(n, { enter });
        readingOrder.push(n.id);
        stops.push(d);
        carry = [];
      } else {
        carry = enter;
      }

      let links = n.role === "link" ? 1 : 0;
      for (const c of d.children) {
        links += visit(c, d, carry);
        carry = [];
      }
      n.children = d.children.map((c) => c.node.id);

      const tag = n.tag;
      const container = tag === "nav" || tag === "header" || tag === "footer" || n.landmark === "navigation" || n.landmark === "banner" || n.landmark === "contentinfo";
      if (container && links >= 10) n.hints.repetitiveBlock = true;
      return links;
    };
    visit(root, null, []);

    const firstStopAtOrAfter = (target: Element): Draft | undefined => {
      for (const s of stops) {
        if (s.anchor === target) return s;
        if (target.compareDocumentPosition(s.anchor) & 4 /* FOLLOWING (includes descendants) */) return s;
      }
      return undefined;
    };
    const skipLinks: SkipLink[] = [];
    for (const link of hashLinks) {
      const raw = (link.el.getAttribute("href") ?? "").slice(1);
      if (!raw) continue;
      let frag = raw;
      try {
        frag = decodeURIComponent(raw);
      } catch {
        frag = raw;
      }
      const target = env.doc.getElementById(frag) ?? Array.from(env.doc.getElementsByName(frag))[0] ?? null;
      if (!target) continue;
      const to = firstStopAtOrAfter(target);
      if (to) skipLinks.push({ from: link.node.id, to: to.node.id });
    }

    return {
      version: 1,
      url: meta.url,
      title: meta.title,
      viewport: meta.viewport,
      docHeight: meta.docHeight,
      root: root.node.id,
      nodes,
      readingOrder,
      focusOrder: orderFocus(focusStops),
      headings,
      landmarks,
      skipLinks,
    };
  }
}

/** Build the PageModel (what assistive technology sees) from a live or parsed Document. */
export function extractPage(doc: Document, opts: ExtractOptions = {}): PageModel {
  const idAttr = opts.idAttr ?? "data-detour-id";
  return new Extractor(createEnv(doc, idAttr)).extract({ ...opts, idAttr });
}
