// LLM repair with model verification: the LLM proposes better wording, the deterministic information-scent
// model proves the change saves time before it is shown. See ./verify.ts for the acceptance rule.

import type { NodeId, PageModel, Task } from "@/lib/contracts";
import { applyFixes, generateCandidates } from "@/lib/fixes";
import { findVagueHeadings, isGenericHeadingText, proposeHeading } from "./headings";
import { needsProposedLabel, proposeLabels } from "./labels";
import { collapse } from "./text";
import type { HeadingRepair, LabelRepair, RepairOptions, RepairReport } from "./types";
import { isAccepted, renameNode, verifyRename } from "./verify";

export { fallbackHeading, findVagueHeadings, isGenericHeadingText, proposeHeading, sectionStops, sectionText } from "./headings";
export { checkLabel, fallbackLabel, needsProposedLabel, proposeLabels } from "./labels";
export { isAccepted, MIN_SAVED_SECONDS, renameNode, verifyRename, type RenameVerification, type TaskDelta } from "./verify";
export type { HeadingRepair, LabelRepair, LlmOptions, Proposal, ProposalSource, RepairOptions, RepairReport } from "./types";

const MAX_LABELS = 30;

/**
 * Repairs a page. With fewer than two real headings, every promote-heading fix is applied first (a
 * heading search only means something once the headings are real). Then each vague heading gets a
 * proposed rewrite and is verified against the tasks, one after another, so a rename is judged with the
 * renames accepted before it already in place: `before` of one entry is `after` of the last accepted one.
 * Finally unlabeled controls with no visible hint get proposed accessible names (not time-verified).
 * Works without an LLM: every proposal then has `source: "fallback"`.
 */
export async function repairPage(page: PageModel, tasks: Task[], opts: RepairOptions = {}): Promise<RepairReport> {
  let work = page;
  let promoted = false;
  if (page.headings.length < 2) {
    const fixes = generateCandidates(page, tasks).filter((f) => f.kind === "promote-heading");
    if (fixes.length) {
      work = applyFixes(page, fixes);
      promoted = true;
    }
  }

  // The scent model only sees real headings, so only those can be verified.
  const vague: NodeId[] = findVagueHeadings(work).filter((id) => work.nodes[id].role === "heading");
  const ordered = [...vague.filter((id) => isGenericHeadingText(work.nodes[id].name)), ...vague.filter((id) => !isGenericHeadingText(work.nodes[id].name))];
  const targets = ordered.slice(0, opts.maxHeadings ?? 8);
  const proposals = await Promise.all(targets.map((id) => proposeHeading(work, id, opts)));

  const headings: HeadingRepair[] = [];
  let current = work;
  targets.forEach((id, i) => {
    const original = collapse(current.nodes[id].name);
    const { text, source } = proposals[i];
    if (!text || text.toLowerCase() === original.toLowerCase()) return; // nothing to propose
    const v = verifyRename(current, tasks, id, text);
    const accepted = isAccepted(v);
    headings.push({ nodeId: id, original, proposed: text, source, before: v.before, after: v.after, savedSeconds: v.savedSeconds, accepted });
    if (accepted) current = renameNode(current, id, text);
  });

  const needy = Object.keys(work.nodes)
    .filter((id) => needsProposedLabel(work.nodes[id]))
    .slice(0, MAX_LABELS);
  const proposed = await proposeLabels(work, needy, opts);
  const labels: LabelRepair[] = needy.filter((id) => proposed[id]).map((id) => ({ nodeId: id, proposed: proposed[id].text, source: proposed[id].source }));

  return { promoted, headings, labels };
}
