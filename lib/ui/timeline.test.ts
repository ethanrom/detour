import { describe, expect, it } from "vitest";
import type { PersonaResult, StepTrace, TraceEvent } from "@/lib/contracts";
import {
  FAST_TARGET_SECONDS,
  activeEventIndex,
  axis,
  buildLane,
  flattenEvents,
  laneFrame,
  longestDuration,
  nearestEventIndex,
  playbackRate,
  wallDuration,
} from "./timeline";

const ev = (t: number, dt: number, label = "x"): TraceEvent => ({ t, dt, command: "tab", nodeId: null, label });
const step = (stepIndex: number, events: TraceEvent[]): StepTrace => ({ stepIndex, target: "n", seconds: 0, commands: [], events });

describe("playbackRate (timeline compression)", () => {
  it("plays the longest lane in about 8 s in fast mode", () => {
    const rate = playbackRate(52, "fast");
    expect(wallDuration(52, rate)).toBeCloseTo(FAST_TARGET_SECONDS, 10);
    expect(rate).toBeCloseTo(6.5, 10);
  });
  it("is exactly real time in 1x mode", () => {
    expect(playbackRate(52, "real")).toBe(1);
    expect(wallDuration(52, 1)).toBe(52);
  });
  it("never plays slower than real time", () => {
    expect(playbackRate(4.3, "fast")).toBe(1);
    expect(playbackRate(0, "fast")).toBe(1);
  });
});

describe("flattenEvents", () => {
  it("keeps absolute times from the engine untouched", () => {
    const evs = flattenEvents([step(0, [ev(0, 1), ev(1, 2)]), step(1, [ev(3, 1)])]);
    expect(evs.map((e) => [e.start, e.end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 4],
    ]);
    expect(evs.map((e) => e.index)).toEqual([0, 1, 2]);
  });
  it("is defensive when each step restarts at t = 0", () => {
    const evs = flattenEvents([step(0, [ev(0, 1), ev(1, 1)]), step(1, [ev(0, 2), ev(2, 1)])]);
    expect(evs.map((e) => e.start)).toEqual([0, 1, 2, 4]);
    expect(evs[evs.length - 1].end).toBe(5);
  });
  it("orders steps by stepIndex", () => {
    const evs = flattenEvents([step(1, [ev(2, 1, "b")]), step(0, [ev(0, 2, "a")])]);
    expect(evs.map((e) => e.label)).toEqual(["a", "b"]);
  });
});

function persona(over: Partial<PersonaResult>): PersonaResult {
  return {
    persona: "keyboard",
    seconds: 3,
    interval: [2, 4],
    strategies: [{ strategy: "tab", seconds: 3, steps: [step(0, [ev(0, 1), ev(1, 2)])] }],
    weights: { tab: 1 },
    representative: "tab",
    ...over,
  };
}

describe("buildLane", () => {
  it("animates the representative strategy", () => {
    const lane = buildLane(persona({}));
    expect(lane.strategy).toBe("tab");
    expect(lane.duration).toBe(3);
    expect(lane.weight).toBe(1);
    expect(lane.blocked).toBeUndefined();
  });
  it("stops a blocked lane where its trace ends and keeps the reason", () => {
    const lane = buildLane(persona({ blocked: { stepIndex: 0, reason: "No focus." } }));
    expect(lane.blocked).toEqual({ reason: "No focus.", stepIndex: 0, at: 3 });
    expect(laneFrame(lane, 99).state).toBe("blocked");
    expect(laneFrame(lane, 99).clock).toBe(3);
  });
  it("survives a persona with no events", () => {
    const lane = buildLane(persona({ strategies: [{ strategy: "tab", seconds: 0, steps: [] }] }));
    expect(lane.duration).toBe(0);
    expect(lane.events).toEqual([]);
    expect(laneFrame(lane, 0).state).toBe("finished");
  });
});

describe("laneFrame", () => {
  const lane = buildLane(persona({}));
  it("moves ready -> running -> finished and clamps the clock", () => {
    expect(laneFrame(lane, 0).state).toBe("ready");
    expect(laneFrame(lane, 1.5)).toMatchObject({ state: "running", clock: 1.5, activeIndex: 1 });
    expect(laneFrame(lane, 3)).toMatchObject({ state: "finished", clock: 3 });
    expect(laneFrame(lane, 10).clock).toBe(3);
  });
});

describe("event lookup", () => {
  const starts = [{ start: 0 }, { start: 1 }, { start: 4 }, { start: 9 }];
  it("finds the event in progress", () => {
    expect(activeEventIndex(starts, -1)).toBe(-1);
    expect(activeEventIndex(starts, 0)).toBe(0);
    expect(activeEventIndex(starts, 3.9)).toBe(1);
    expect(activeEventIndex(starts, 100)).toBe(3);
  });
  it("finds the nearest tick for hover", () => {
    expect(nearestEventIndex(starts, 2)).toBe(1);
    expect(nearestEventIndex(starts, 2.6)).toBe(2);
    expect(nearestEventIndex(starts, 50)).toBe(3);
    expect(nearestEventIndex([], 1)).toBe(-1);
  });
});

describe("axis", () => {
  it("picks round steps with at most 8 labels", () => {
    const a = axis(52);
    expect(a.step).toBe(10);
    expect(a.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(axis(4.3).ticks.length).toBeLessThanOrEqual(9);
    expect(axis(0).max).toBe(1);
  });
  it("longestDuration spans the shared axis", () => {
    expect(longestDuration([{ duration: 4 }, { duration: 52 }, { duration: 12 }])).toBe(52);
    expect(longestDuration([])).toBe(0);
  });
});
