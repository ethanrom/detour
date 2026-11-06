// Recorded /api/repair reports for the demo sites, so the public demo never spends a Bedrock call on them.
// Each file is the exact RepairReport that repairPage returned in one real LIVE run against Claude (the
// proposals are Claude's; the before/after numbers are the scent model's). Regenerate with the one-off
// script described in docs/OPERATIONS.md. Keyed by siteId.

import type { RepairReport } from "@/lib/repair/types";
import alpine from "./alpine.json";
import northwind from "./northwind.json";
import riverside from "./riverside.json";

export const DEMO_REPAIR_REPORTS: Record<string, RepairReport> = {
  northwind: northwind as RepairReport,
  riverside: riverside as RepairReport,
  alpine: alpine as RepairReport,
};
