// The sentence the race answers first: who can't finish, or who is slowest. Built from the lanes, no model involved.

import type { PersonaId } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { PERSONA_BY_ID } from "@/lib/ui/personas";
import type { Lane } from "@/lib/ui/timeline";

export interface RaceFinding {
  text: string;
  /** Somebody cannot finish: the sentence is drawn in the blocked colour. */
  blocked: boolean;
}

/** "Mouse user", "Keyboard user", "screen-reader user": how the slowest person is named in a sentence. */
const SLOWEST_NAME: Record<PersonaId, string> = {
  mouse: "mouse user",
  keyboard: "keyboard user",
  screenreader: "screen-reader user",
};

export function raceFinding(lanes: readonly Lane[]): RaceFinding {
  const blocked = lanes.filter((l) => l.blocked);
  if (blocked.length > 0) {
    // "Keyboard", "Keyboard and screen reader", "Mouse, keyboard and screen reader".
    const names = blocked.map((l, i) => {
      const label = PERSONA_BY_ID[l.persona].label;
      return i === 0 ? label : label.toLowerCase();
    });
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return { text: `${who} can’t finish this task.`, blocked: true };
  }
  if (lanes.length === 0) return { text: "", blocked: false };
  const slowest = lanes.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  return { text: `Everyone finishes. The slowest is the ${SLOWEST_NAME[slowest.persona]} at ${fmtSeconds(slowest.seconds)}.`, blocked: false };
}
