// Pick mode inside the preview iframe. The iframe is same-origin, so we can add a highlight box to its document,
// follow the pointer and capture clicks (preventDefault, so links and buttons of the page do nothing).
// Everything added here is removed again by the returned cleanup functions; the extractor never sees it.

import type { A11yNode, PageModel } from "@/lib/contracts";
import { createPickIndex, elementForNode, nodeForElement } from "./pick";

const MARK = "data-detour-overlay";

export interface Overlay {
  /** Outline the node (its recorded box, else its element's box). */
  show(node: A11yNode): void;
  hide(): void;
  destroy(): void;
}

/** Box position in document coordinates (scroll offset included). */
function boxOf(doc: Document, node: A11yNode): { x: number; y: number; w: number; h: number } | null {
  if (node.rect && node.rect.w > 0 && node.rect.h > 0) return node.rect;
  const el = elementForNode(doc, node);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const win = doc.defaultView;
  return { x: r.left + (win?.scrollX ?? 0), y: r.top + (win?.scrollY ?? 0), w: r.width, h: r.height };
}

/**
 * A highlight box in the page. The preview is drawn at a fraction of its size, so the border is scaled up to stay
 * about 3 screen pixels wide; `scale()` is read on every move.
 */
export function createOverlay(doc: Document, scale: () => number): Overlay {
  const box = doc.createElement("div");
  box.setAttribute(MARK, "");
  box.setAttribute("aria-hidden", "true");
  Object.assign(box.style, {
    position: "absolute",
    display: "none",
    zIndex: "2147483647",
    pointerEvents: "none",
    boxSizing: "border-box",
    background: "rgba(210, 248, 74, 0.38)",
    borderStyle: "solid",
    borderColor: "#0d1522",
    borderRadius: "2px",
    margin: "0",
    padding: "0",
  });
  doc.documentElement.appendChild(box);
  return {
    show(node) {
      const r = boxOf(doc, node);
      if (!r) return box.style.setProperty("display", "none");
      const bw = Math.max(2, Math.round(3 / Math.max(scale(), 0.1)));
      box.style.borderWidth = `${bw}px`;
      box.style.left = `${r.x - bw}px`;
      box.style.top = `${r.y - bw}px`;
      box.style.width = `${Math.max(r.w, 2) + bw * 2}px`;
      box.style.height = `${Math.max(r.h, 2) + bw * 2}px`;
      box.style.display = "block";
    },
    hide() {
      box.style.display = "none";
    },
    destroy() {
      box.remove();
    },
  };
}

/** Scroll the previewed page so `node` is in view (instant: no animation inside the preview). */
export function scrollNodeIntoView(doc: Document, node: A11yNode): void {
  const win = doc.defaultView;
  const r = boxOf(doc, node);
  if (!win || !r) return;
  const top = win.scrollY;
  const bottom = top + win.innerHeight;
  if (r.y >= top + 40 && r.y + r.h <= bottom - 40) return;
  win.scrollTo({ top: Math.max(0, r.y - win.innerHeight / 3), behavior: "instant" });
}

/**
 * Belt and braces for previews of typed-in pages: the preview is already inert, but a link in the page must never
 * be able to navigate the frame (an in-page "#anchor" resolves against the page's <base> and would load the real
 * site). Clicks and form submits inside the document do nothing.
 */
export function lockNavigation(doc: Document): () => void {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  doc.addEventListener("click", stop, true);
  doc.addEventListener("auxclick", stop, true);
  doc.addEventListener("submit", stop, true);
  return () => {
    doc.removeEventListener("click", stop, true);
    doc.removeEventListener("auxclick", stop, true);
    doc.removeEventListener("submit", stop, true);
  };
}

export interface PickerOptions {
  doc: Document;
  page: PageModel;
  scale: () => number;
  /** The node under the pointer, or null when the pointer is over nothing choosable. */
  onHover: (node: A11yNode | null) => void;
  onPick: (node: A11yNode) => void;
  onCancel?: () => void;
}

/** Start pick mode on `doc`. Returns the function that ends it and removes everything it added. */
export function startPicking({ doc, page, scale, onHover, onPick, onCancel }: PickerOptions): () => void {
  const index = createPickIndex(page);
  const overlay = createOverlay(doc, scale);
  const style = doc.createElement("style");
  style.setAttribute(MARK, "");
  style.textContent = "html, html * { cursor: crosshair !important; }";
  (doc.head ?? doc.documentElement).appendChild(style);

  let current: A11yNode | null = null;
  const resolve = (e: MouseEvent): A11yNode | null => {
    const win = doc.defaultView;
    const target = e.target instanceof (win?.Element ?? Element) ? (e.target as Element) : null;
    const point = { x: e.clientX + (win?.scrollX ?? 0), y: e.clientY + (win?.scrollY ?? 0) };
    return nodeForElement(index, doc, target, point);
  };

  const move = (e: MouseEvent) => {
    const node = resolve(e);
    if (node?.id === current?.id) return;
    current = node;
    if (node) overlay.show(node);
    else overlay.hide();
    onHover(node);
  };
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const click = (e: MouseEvent) => {
    stop(e);
    const node = resolve(e);
    if (node) onPick(node);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel?.();
  };
  const leave = () => {
    current = null;
    overlay.hide();
    onHover(null);
  };

  const opts = { capture: true } as const;
  doc.addEventListener("mousemove", move, opts);
  doc.addEventListener("click", click, opts);
  doc.addEventListener("auxclick", stop, opts);
  doc.addEventListener("mousedown", stop, opts);
  doc.addEventListener("submit", stop, opts);
  doc.addEventListener("keydown", key, opts);
  doc.documentElement.addEventListener("mouseleave", leave);

  return () => {
    doc.removeEventListener("mousemove", move, opts);
    doc.removeEventListener("click", click, opts);
    doc.removeEventListener("auxclick", stop, opts);
    doc.removeEventListener("mousedown", stop, opts);
    doc.removeEventListener("submit", stop, opts);
    doc.removeEventListener("keydown", key, opts);
    doc.documentElement.removeEventListener("mouseleave", leave);
    overlay.destroy();
    style.remove();
    onHover(null);
  };
}
