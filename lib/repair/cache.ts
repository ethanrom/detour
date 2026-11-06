// Recorded reports for the demo sites (fixtures/repair). Served by POST /api/repair so the demo sites cost
// no Bedrock call. A recorded report is only served for a page it still describes.

import type { PageModel } from "@/lib/contracts";
import { DEMO_REPAIR_REPORTS } from "@/fixtures/repair";
import { needsProposedLabel } from "./labels";
import { collapse } from "./text";
import type { RepairReport } from "./types";

/** The recorded report for a demo site when `page` is that site's page, otherwise null. "Is that page" means
 *  every renamed heading still has its recorded wording and every labelled control still needs a name. */
export function cachedRepairReport(siteId: string, page: PageModel, reports: Record<string, RepairReport> = DEMO_REPAIR_REPORTS): RepairReport | null {
  const report = Object.hasOwn(reports, siteId) ? reports[siteId] : undefined;
  if (!report) return null;
  const headingsMatch = report.headings.every((h) => {
    const node = page.nodes[h.nodeId];
    return !!node && collapse(node.name).toLowerCase() === h.original.toLowerCase();
  });
  const labelsMatch = report.labels.every((l) => {
    const node = page.nodes[l.nodeId];
    return !!node && needsProposedLabel(node);
  });
  return headingsMatch && labelsMatch ? report : null;
}
