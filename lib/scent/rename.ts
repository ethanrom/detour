// What-if on a heading's text: the same page with one heading renamed and re-announced.

import { announce } from "@/lib/a11y/announce";
import type { NodeId, PageModel } from "@/lib/contracts";

/** A copy of `page` whose heading `id` is named `text`. The announcement is rebuilt with announce();
 *  any container-entry phrase already spoken before the heading ("main landmark, ...") is kept. */
export function withHeadingText(page: PageModel, id: NodeId, text: string): PageModel {
  const out = structuredClone(page);
  const n = out.nodes[id];
  if (!n || n.role !== "heading") throw new Error(`withHeadingText: ${id} is not a heading`);
  const oldCore = announce(n);
  const prefix = n.announcement.endsWith(oldCore) ? n.announcement.slice(0, n.announcement.length - oldCore.length) : "";
  n.name = text;
  n.announcement = prefix + announce(n);
  return out;
}
