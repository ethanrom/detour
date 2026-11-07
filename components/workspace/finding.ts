// The sentence the race answers first: who cannot finish, or who is slowest. Built from the lanes, no model involved.

import { fmtSeconds } from "@/lib/ui/format";
import { PERSONA_BY_ID } from "@/lib/ui/personas";
import type { Lane } from "@/lib/ui/timeline";

const label = (l: Lane) => PERSONA_BY_ID[l.persona].label;

/** "Keyboard can’t finish this task." / "Everyone finishes. The slowest is the screen-reader user at 28 s." */
export function raceFinding(lanes: readonly Lane[]): string {
  const blocked = lanes.filter((l) => l.blocked);
  if (blocked.length > 0) {
    const names = blocked.map(label);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${who} can’t finish this task.`;
  }
  const slowest = lanes.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  const who = slowest.persona === "screenreader" ? "screen-reader" : label(slowest).toLowerCase();
  return `Everyone finishes. The slowest is the ${who} user at ${fmtSeconds(slowest.seconds)}.`;
}
