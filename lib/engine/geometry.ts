// Viewport and scrolling geometry shared by the mouse and keyboard models.

import type { PageModel, Rect } from "@/lib/contracts";

export interface ScrollMove {
  /** Whole viewports scrolled: ceil(|dy| / viewport height). */
  count: number;
  direction: "down" | "up";
  /** Scroll position after the move. */
  scrollY: number;
}

export function viewportHeight(page: PageModel): number {
  return Math.max(1, page.viewport.h);
}

export function centreY(r: Rect): number {
  return r.y + r.h / 2;
}

function maxScroll(page: PageModel, r: Rect): number {
  return Math.max(0, Math.max(page.docHeight, r.y + r.h) - viewportHeight(page));
}

/**
 * Scrolling needed to bring `r` into view from `scrollY`, or null when its centre is already
 * visible. The page is scrolled so the target sits mid-viewport (clamped to the document).
 */
export function scrollTo(page: PageModel, scrollY: number, r: Rect): ScrollMove | null {
  const vh = viewportHeight(page);
  const cy = centreY(r);
  if (cy >= scrollY && cy <= scrollY + vh) return null;
  const dy = cy - (scrollY + vh / 2);
  const next = Math.min(Math.max(scrollY + dy, 0), maxScroll(page, r));
  return { count: Math.max(1, Math.ceil(Math.abs(dy) / vh)), direction: dy > 0 ? "down" : "up", scrollY: next };
}
