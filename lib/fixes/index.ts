// Detour fixes layer: candidate generation, pure transforms on a PageModel, and the optimiser.

export { generateCandidates } from "./candidates";
export { applyFix, applyFixes } from "./apply";
export { validatePage } from "./validate";
export { planFixes, defaultObjective, exhaustivePoolSize } from "./plan";
export type { FixPlanWithPool } from "./plan";
