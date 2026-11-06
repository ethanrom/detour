import type { NodeId, PageModel } from "@/lib/contracts";
import { buildTree } from "./graph";

/** Invariant violations of a PageModel; an empty array means the model is consistent.
 *  Checks the rules the extractor, the builder and the fix transforms all promise to keep. */
export function validatePage(page: PageModel): string[] {
  const errs: string[] = [];
  const has = (id: NodeId) => Object.prototype.hasOwnProperty.call(page.nodes, id);

  if (!has(page.root)) {
    errs.push(`root "${page.root}" does not exist`);
    return errs;
  }

  // Tree structure.
  for (const [key, n] of Object.entries(page.nodes)) {
    if (n.id !== key) errs.push(`node keyed "${key}" has id "${n.id}"`);
    if (n.parentId !== null && !has(n.parentId)) errs.push(`node "${key}" has unknown parent "${n.parentId}"`);
    const seenKids = new Set<NodeId>();
    for (const c of n.children) {
      if (!has(c)) {
        errs.push(`node "${key}" has unknown child "${c}"`);
        continue;
      }
      if (seenKids.has(c)) errs.push(`node "${key}" lists child "${c}" twice`);
      seenKids.add(c);
      if (page.nodes[c].parentId !== key) errs.push(`child "${c}" of "${key}" has parentId "${page.nodes[c].parentId}"`);
    }
  }
  if (page.nodes[page.root].parentId !== null) errs.push(`root "${page.root}" has a parent`);
  const tree = buildTree(page);
  for (const id of Object.keys(page.nodes)) {
    if (!tree.idx.has(id)) errs.push(`node "${id}" is not reachable from the root`);
  }

  const dupes = (label: string, ids: NodeId[]) => {
    const seen = new Set<NodeId>();
    for (const id of ids) {
      if (seen.has(id)) errs.push(`${label} lists "${id}" twice`);
      seen.add(id);
    }
  };

  // readingOrder
  dupes("readingOrder", page.readingOrder);
  const reading = new Set(page.readingOrder);
  for (const id of page.readingOrder) {
    if (!has(id)) {
      errs.push(`readingOrder references unknown node "${id}"`);
    } else if (!page.nodes[id].announcement.trim()) {
      errs.push(`reading stop "${id}" has an empty announcement`);
    }
  }

  // focusOrder
  dupes("focusOrder", page.focusOrder);
  for (const id of page.focusOrder) {
    if (!has(id)) errs.push(`focusOrder references unknown node "${id}"`);
    else if (!page.nodes[id].focusable) errs.push(`focusOrder entry "${id}" is not focusable`);
  }

  // headings
  dupes("headings", page.headings);
  for (const id of page.headings) {
    if (!has(id)) {
      errs.push(`headings references unknown node "${id}"`);
      continue;
    }
    const n = page.nodes[id];
    if (!reading.has(id)) errs.push(`heading "${id}" is not in readingOrder`);
    if (n.role !== "heading") errs.push(`heading "${id}" has role "${n.role}"`);
    if (!Number.isInteger(n.level) || (n.level as number) < 1 || (n.level as number) > 6) errs.push(`heading "${id}" has no valid level`);
  }
  const headingSet = new Set(page.headings);
  for (const id of tree.order) {
    if (page.nodes[id].role === "heading" && reading.has(id) && !headingSet.has(id)) errs.push(`heading node "${id}" is missing from headings`);
  }
  const inDocOrder = (label: string, ids: NodeId[]) => {
    let last = -1;
    for (const id of ids) {
      const i = tree.idx.get(id);
      if (i === undefined) continue;
      if (i < last) {
        errs.push(`${label} is not in document order at "${id}"`);
        return;
      }
      last = i;
    }
  };
  inDocOrder("headings", page.headings);

  // landmarks
  dupes("landmarks", page.landmarks);
  for (const id of page.landmarks) {
    if (!has(id)) errs.push(`landmarks references unknown node "${id}"`);
    else if (!page.nodes[id].landmark) errs.push(`landmark "${id}" has no landmark role`);
  }
  const landmarkSet = new Set(page.landmarks);
  for (const id of tree.order) {
    if (page.nodes[id].landmark && !landmarkSet.has(id)) errs.push(`landmark node "${id}" is missing from landmarks`);
  }
  inDocOrder("landmarks", page.landmarks);

  // skipLinks
  for (const s of page.skipLinks) {
    if (!has(s.from)) errs.push(`skipLink from unknown node "${s.from}"`);
    if (!has(s.to)) errs.push(`skipLink to unknown node "${s.to}"`);
    else if (!reading.has(s.to)) errs.push(`skipLink target "${s.to}" is not a reading stop`);
  }

  return errs;
}
