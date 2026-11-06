// Shared types for LLM repair with model verification.

import type { NodeId } from "@/lib/contracts";
import type { ConverseSend, Env } from "@/lib/llm/bedrock";

/** "llm": proposed by the model and validated. "fallback": deterministic, used when the LLM is not
 *  configured, fails, or returns something that fails validation twice. */
export type ProposalSource = "llm" | "fallback";

export interface Proposal {
  text: string;
  source: ProposalSource;
}

export interface LlmOptions {
  /** Test seam: replaces the real Bedrock client (also pass `env` so the tier resolves). */
  send?: ConverseSend;
  /** Test seam: replaces process.env. */
  env?: Env;
}

export interface RepairOptions extends LlmOptions {
  /** Cap on vague headings sent for a proposal (default 8). */
  maxHeadings?: number;
}

export interface HeadingRepair {
  nodeId: NodeId;
  original: string;
  proposed: string;
  source: ProposalSource;
  /** Search seconds over all tasks before this rename (renames accepted earlier are already applied). */
  before: number;
  /** Search seconds over all tasks with this rename applied. */
  after: number;
  savedSeconds: number;
  /** True only when the scent model says the rename saves more than MIN_SAVED_SECONDS. */
  accepted: boolean;
}

export interface LabelRepair {
  nodeId: NodeId;
  proposed: string;
  source: ProposalSource;
}

export interface RepairReport {
  /** True when the page had fewer than 2 real headings and the promote-heading fixes were applied first. */
  promoted: boolean;
  headings: HeadingRepair[];
  labels: LabelRepair[];
  /** Set by POST /api/repair, never by repairPage. True when a demo site's report was recorded from one real
   *  run (fixtures/repair/<siteId>.json) instead of calling the model. */
  cached?: true;
  /** Set by POST /api/repair. True when this IP is over its rate limit, so the proposals are the offline fallback. */
  limited?: true;
}
