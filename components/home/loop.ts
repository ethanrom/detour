/**
 * The five stages of one Detour run, in order. `seconds` is how long the stage really takes. Durations are NOT
 * measured yet, so every value is null: the bar then draws equal segments and shows no duration text.
 * The lead fills these in later (plain numbers of seconds); never put in a guess.
 */
export interface LoopStage {
  id: "read" | "race" | "plan" | "fix" | "recheck";
  label: string;
  clause: string;
  seconds: number | null;
}

export const LOOP: readonly LoopStage[] = [
  { id: "read", label: "Read", clause: "First, Detour reads the page the way assistive technology does.", seconds: null },
  { id: "race", label: "Race", clause: "Then it times three people on one clock.", seconds: null },
  { id: "plan", label: "Plan", clause: "Next it picks the smallest set of fixes that saves the most time.", seconds: null },
  { id: "fix", label: "Fix", clause: "Then one AI agent per fix writes the edit on your page.", seconds: null },
  { id: "recheck", label: "Re-check", clause: "Last, it re-reads the fixed page and times everyone again.", seconds: null },
];

/** True only when every stage has a measured duration. Otherwise the bar uses equal widths. */
export function loopIsMeasured(stages: readonly LoopStage[] = LOOP): boolean {
  return stages.every((s) => s.seconds !== null);
}

/** Duration in words for a stage, or null while it is unmeasured. */
export function durationText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`;
}
