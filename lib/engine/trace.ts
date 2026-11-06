// Builds a StrategyResult event by event while a planner walks its path, and keeps the running
// total of cost recipes so Monte Carlo can later re-cost the same path under other parameters
// without redoing the search.

import type { Blocked, CommandId, CommandUse, NodeId, StepTrace, StrategyId, StrategyResult, TraceEvent } from "@/lib/contracts";
import { addCost, costOf, speechSeconds, zeroCost, type CostInput, type CostVec } from "./cost";
import type { Params } from "./params";

/** A strategy's nominal-optimal path: the contract result plus its summed cost recipe. */
export interface Planned {
  result: StrategyResult;
  /** costOf(total, params) re-costs the whole path under any parameter set. */
  total: CostVec;
}

export interface EventExtra {
  utterance?: { nodeId: NodeId; text: string; truncated: boolean };
  /** False for passive time (reading, hearing the page title) that is not a user command. */
  counted?: boolean;
}

export class TraceBuilder {
  private readonly total = zeroCost();
  private readonly steps: StepTrace[] = [];
  private events: TraceEvent[] = [];
  private counts = new Map<CommandId, number>();
  private stepIndex = 0;
  private target: NodeId = "";
  private t = 0;

  constructor(
    readonly strategy: StrategyId,
    readonly p: Params,
  ) {}

  /** Start a step; its first event begins at the current time. */
  begin(stepIndex: number, target: NodeId): void {
    this.stepIndex = stepIndex;
    this.target = target;
    this.events = [];
    this.counts = new Map();
  }

  event(command: CommandId, nodeId: NodeId | null, label: string, c: CostInput, extra?: EventExtra): void {
    const dt = costOf(c, this.p);
    addCost(this.total, c);
    const u = extra?.utterance;
    const ev: TraceEvent = u
      ? { t: this.t, dt, command, nodeId, utterance: { nodeId: u.nodeId, text: u.text, seconds: speechSeconds(c, this.p), truncated: u.truncated }, label }
      : { t: this.t, dt, command, nodeId, label };
    this.events.push(ev);
    if (extra?.counted !== false) this.counts.set(command, (this.counts.get(command) ?? 0) + 1);
    this.t += dt;
  }

  /**
   * Fast path for the most frequent screen-reader event: `keys` keystrokes, then speech of `words`
   * words (heard in full at the target, otherwise only listenFraction of it). Same arithmetic as
   * `event()` with { K: keys, spkFull | spkPart: words }, without allocating a recipe.
   */
  heard(command: CommandId, nodeId: NodeId, label: string, keys: number, words: number, full: boolean, text: string): void {
    const p = this.p;
    const seconds = ((full ? words : words * p.listenFraction) * 60) / p.speechWpm;
    const dt = keys * p.K + seconds;
    this.total.K += keys;
    if (full) this.total.spkFull += words;
    else this.total.spkPart += words;
    this.events.push({ t: this.t, dt, command, nodeId, utterance: { nodeId, text, seconds, truncated: !full }, label });
    this.counts.set(command, (this.counts.get(command) ?? 0) + 1);
    this.t += dt;
  }

  /** Finish the current step. */
  end(): void {
    const commands: CommandUse[] = [];
    for (const [command, count] of this.counts) commands.push({ command, count });
    let seconds = 0;
    for (const e of this.events) seconds += e.dt;
    this.steps.push({ stepIndex: this.stepIndex, target: this.target, seconds, commands, events: this.events });
    this.events = [];
  }

  /** The finished plan. A step begun but not ended (a block discovered mid-step) is dropped. */
  done(blocked?: Blocked): Planned {
    let seconds = 0;
    for (const s of this.steps) seconds += s.seconds;
    const result: StrategyResult = { strategy: this.strategy, seconds, steps: this.steps };
    if (blocked) result.blocked = blocked;
    return { result, total: this.total };
  }
}
