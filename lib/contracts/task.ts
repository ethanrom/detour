import type { NodeId } from "./page";

/** activate: click/press a link or button. type: enter text into a field. select: choose an option
 *  (radio, swatch, dropdown item). read: reach a piece of content and listen to/look at it fully. */
export type StepAction = "activate" | "type" | "select" | "read";

export interface TaskStep {
  target: NodeId;
  action: StepAction;
  /** Text to type for action "type". */
  text?: string;
  /** Human-readable description of the step ("Choose size M"). */
  note?: string;
}

export interface Task {
  id: string;
  siteId: string;
  /** The task as a user would say it: "Add the Trail Jacket in size M to the cart". */
  label: string;
  steps: TaskStep[];
  /** fixture: pinned by hand via data-detour-id. llm: grounded by /api/ground and validated. */
  grounding: "fixture" | "llm";
}
