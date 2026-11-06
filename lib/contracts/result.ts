import type { NodeId, PageModel } from "./page";
import type { Task } from "./task";

export type PersonaId = "mouse" | "keyboard" | "screenreader";

/** mouse: point-and-click. tab: Tab/Shift+Tab (and skip links). For screen readers: headings
 *  (H / Shift+H then arrows), linear (down arrow only), find (browser/AT find), landmarks (D/R),
 *  tab (Tab only). */
export type StrategyId = "point" | "tab" | "headings" | "linear" | "find" | "landmarks";

export type CommandId =
  | "think" // KLM M: mental preparation
  | "point" // move pointer (Fitts)
  | "click" // mouse button press+release
  | "scroll"
  | "tab"
  | "shiftTab"
  | "next" // browse-mode down arrow
  | "prev"
  | "nextHeading"
  | "nextLandmark"
  | "find" // open find, type query, jump
  | "activate" // Enter / Space on the current item
  | "type"; // typing characters into a field

/** Speech the user hears (screen reader persona only). */
export interface Utterance {
  nodeId: NodeId;
  text: string;
  /** Seconds of speech actually listened to. */
  seconds: number;
  /** True when the user skips ahead before the announcement finishes (non-target items). */
  truncated: boolean;
}

/** One event on a persona's timeline. The UI animates these in order. */
export interface TraceEvent {
  /** Start time in seconds from task start. */
  t: number;
  /** Duration in seconds. */
  dt: number;
  command: CommandId;
  /** Node the cursor/focus/pointer is on after this event (null for think). */
  nodeId: NodeId | null;
  utterance?: Utterance;
  /** Short deterministic label: "Tab → link, Men", "H → heading level 2, Reviews". */
  label: string;
}

export interface CommandUse {
  command: CommandId;
  count: number;
}

export interface StepTrace {
  stepIndex: number;
  target: NodeId;
  seconds: number;
  commands: CommandUse[];
  events: TraceEvent[];
}

export interface Blocked {
  stepIndex: number;
  /** Deterministic reason: "The size picker is not reachable with the keyboard (div with a click handler, no tabindex)." */
  reason: string;
}

export interface StrategyResult {
  strategy: StrategyId;
  /** Point estimate at nominal parameters. Meaningless when blocked. */
  seconds: number;
  steps: StepTrace[];
  blocked?: Blocked;
}

export interface PersonaResult {
  persona: PersonaId;
  /** Strategy-weighted mixture at nominal parameters (blocked strategies are renormalised out). */
  seconds: number;
  /** 90% interval [p05, p95] from Monte Carlo over parameter ranges and strategy draws. */
  interval: [number, number];
  strategies: StrategyResult[];
  weights: Partial<Record<StrategyId, number>>;
  /** Strategy whose trace the UI animates: the highest-weight unblocked strategy. */
  representative: StrategyId;
  /** Set when every strategy for this persona is blocked. */
  blocked?: Blocked;
}

export interface TaskResult {
  taskId: string;
  personas: Record<PersonaId, PersonaResult>;
  /** Deterministic plain-English sentences explaining the biggest costs. Never LLM-written. */
  explanation: string[];
}

export interface EvaluateOptions {
  /** Monte Carlo samples for intervals (default 400; 0 disables intervals → interval = [s, s]). */
  samples?: number;
  seed?: number;
  personas?: PersonaId[];
}

export type Evaluate = (page: PageModel, tasks: Task[], opts?: EvaluateOptions) => TaskResult[];

/** Seconds charged to an objective when a persona cannot complete a task at all. */
export const BLOCKED_PENALTY_SECONDS = 300;
