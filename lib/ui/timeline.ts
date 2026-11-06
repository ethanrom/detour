// Turns engine results into animatable lanes, and maps wall-clock time to model time.
// Pure functions only: the React layer (components/race) just calls these on every frame.

import type { PersonaId, PersonaResult, StepTrace, StrategyId, TraceEvent } from "@/lib/contracts";

export interface LaneEvent extends TraceEvent {
  /** Position in the flattened lane. */
  index: number;
  stepIndex: number;
  /** Seconds from task start (normalised so events never overlap or restart at 0). */
  start: number;
  end: number;
}

export interface LaneBlock {
  reason: string;
  stepIndex: number;
  /** Model seconds at which the lane stops. */
  at: number;
}

export interface Lane {
  persona: PersonaId;
  strategy: StrategyId;
  /** Share of users of this persona that follow the strategy (after renormalisation), if known. */
  weight?: number;
  events: LaneEvent[];
  /** Model seconds the animated trace spans (completion time, or the blocking point). */
  duration: number;
  /** Headline estimate (strategy mixture) and its 90% interval. */
  seconds: number;
  interval: [number, number];
  blocked?: LaneBlock;
}

/** Flatten the steps of one strategy into a single gap-free event list. */
export function flattenEvents(steps: readonly StepTrace[]): LaneEvent[] {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const out: LaneEvent[] = [];
  let cursor = 0;
  let offset = 0;
  for (const step of ordered) {
    for (const ev of step.events) {
      let start = ev.t + offset;
      if (start < cursor - 1e-6) {
        // Events restarted at 0 for a new step (or overlap): shift the rest of the trace after the cursor.
        offset += cursor - start;
        start = cursor;
      }
      const end = start + ev.dt;
      cursor = Math.max(cursor, end);
      out.push({ ...ev, index: out.length, stepIndex: step.stepIndex, start, end });
    }
  }
  return out;
}

export function buildLane(result: PersonaResult): Lane {
  const strategy =
    result.strategies.find((s) => s.strategy === result.representative) ??
    result.strategies.find((s) => !s.blocked) ??
    result.strategies[0];
  const events = strategy ? flattenEvents(strategy.steps) : [];
  const duration = events.length ? events[events.length - 1].end : 0;
  const blockedInfo = result.blocked ?? undefined;
  return {
    persona: result.persona,
    strategy: strategy?.strategy ?? result.representative,
    weight: result.weights[result.representative],
    events,
    duration,
    seconds: result.seconds,
    interval: result.interval,
    blocked: blockedInfo ? { reason: blockedInfo.reason, stepIndex: blockedInfo.stepIndex, at: duration } : undefined,
  };
}

// ----- Playback ---------------------------------------------------------------------------------

export type RaceSpeed = "fast" | "real";

/** The longest lane should take about this long on screen in "fast" mode. */
export const FAST_TARGET_SECONDS = 8;

/** Model seconds advanced per wall-clock second. "real" is 1x. "fast" compresses the longest lane
 *  to ~8 s but never plays slower than real time. */
export function playbackRate(longestLaneSeconds: number, speed: RaceSpeed, target: number = FAST_TARGET_SECONDS): number {
  if (speed === "real") return 1;
  if (!(longestLaneSeconds > 0) || !(target > 0)) return 1;
  return Math.max(1, longestLaneSeconds / target);
}

/** Wall-clock seconds the whole race takes at `rate`. */
export function wallDuration(longestLaneSeconds: number, rate: number): number {
  return rate > 0 ? longestLaneSeconds / rate : 0;
}

export type LaneState = "ready" | "running" | "finished" | "blocked";

export interface LaneFrame {
  state: LaneState;
  /** Model seconds shown on the lane's clock (never beyond the lane's end). */
  clock: number;
  /** Index of the event in progress or last completed; -1 before the first event starts. */
  activeIndex: number;
}

export function laneFrame(lane: Lane, elapsed: number): LaneFrame {
  const clock = Math.min(Math.max(elapsed, 0), lane.duration);
  const over = elapsed >= lane.duration;
  let state: LaneState;
  if (over) state = lane.blocked ? "blocked" : "finished";
  else state = elapsed > 0 ? "running" : "ready";
  return { state, clock, activeIndex: activeEventIndex(lane.events, clock) };
}

/** Index of the last event whose start is <= t; -1 when none has started. Binary search. */
export function activeEventIndex(events: readonly { start: number }[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].start <= t + 1e-9) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Event whose start time is closest to t. -1 for an empty list. */
export function nearestEventIndex(events: readonly { start: number }[], t: number): number {
  if (!events.length) return -1;
  const after = activeEventIndex(events, t);
  if (after < 0) return 0;
  if (after === events.length - 1) return after;
  return t - events[after].start <= events[after + 1].start - t ? after : after + 1;
}

/** Longest lane duration, i.e. the span of the shared time axis. */
export function longestDuration(lanes: readonly { duration: number }[]): number {
  return lanes.reduce((m, l) => Math.max(m, l.duration), 0);
}

export interface Axis {
  /** Seconds at the right edge of the track. */
  max: number;
  step: number;
  ticks: number[];
}

const AXIS_STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300];

/** Gridlines for the shared time axis: at most `maxTicks` labelled steps of a round size. */
export function axis(maxSeconds: number, maxTicks = 8): Axis {
  const max = Math.max(maxSeconds, 1);
  const step = AXIS_STEPS.find((s) => max / s <= maxTicks) ?? AXIS_STEPS[AXIS_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { max, step, ticks };
}

/** Sorted persona order used everywhere: mouse, keyboard, screen reader. */
export const PERSONA_ORDER: readonly PersonaId[] = ["mouse", "keyboard", "screenreader"];
