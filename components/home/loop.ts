/**
 * The five stages of one Detour run, in order. `seconds` is how long the stage really took, read from the app's
 * User Timing measures (detour:read, race, plan, fix) in one production run on a real page; see LOOP_SOURCE.
 * Fix is the agent's own time on the fix card; Re-check is the rest of detour:fix. Never put in a guess: a null
 * value makes the bar draw equal segments with no duration text.
 */
export interface LoopStage {
  id: "read" | "race" | "plan" | "fix" | "recheck";
  label: string;
  clause: string;
  seconds: number | null;
}

export const LOOP: readonly LoopStage[] = [
  { id: "read", label: "Read", clause: "First, Detour reads the page the way assistive technology does.", seconds: 0.3 },
  { id: "race", label: "Race", clause: "Then it times three people on one clock.", seconds: 1.1 },
  { id: "plan", label: "Plan", clause: "Next it picks the smallest set of fixes that saves the most time.", seconds: 2.1 },
  { id: "fix", label: "Fix", clause: "Then one AI agent per fix writes the edit on your page.", seconds: 1.9 },
  { id: "recheck", label: "Re-check", clause: "Last, it re-reads the fixed page and times everyone again.", seconds: 1.7 },
];

/** Where the durations come from, shown under the bar. */
export const LOOP_SOURCE =
  "Timed in one run on news.ycombinator.com in a production build: 751 elements read, one fix written by Claude on the fast (Haiku) tier plus 10 verified wording edits, about 7 seconds end to end.";

/** True only when every stage has a measured duration. Otherwise the bar uses equal widths. */
export function loopIsMeasured(stages: readonly LoopStage[] = LOOP): boolean {
  return stages.every((s) => s.seconds !== null);
}

/** Duration in words for a stage, or null while it is unmeasured. */
export function durationText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`;
}
