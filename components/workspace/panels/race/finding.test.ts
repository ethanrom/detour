import { describe, expect, it } from "vitest";
import type { PersonaId } from "@/lib/contracts";
import type { Lane } from "@/lib/ui/timeline";
import { raceFinding } from "./finding";

const lane = (persona: PersonaId, seconds: number, blocked = false): Lane => ({
  persona,
  strategy: "tab",
  events: [],
  duration: seconds,
  seconds,
  interval: [seconds, seconds],
  blocked: blocked ? { reason: "No focus.", stepIndex: 0, at: seconds } : undefined,
});

describe("raceFinding", () => {
  it("names who can't finish, first word capitalised", () => {
    expect(raceFinding([lane("mouse", 4), lane("keyboard", 9, true), lane("screenreader", 20)])).toEqual({
      text: "Keyboard can’t finish this task.",
      blocked: true,
    });
    expect(raceFinding([lane("mouse", 4), lane("keyboard", 9, true), lane("screenreader", 20, true)]).text).toBe(
      "Keyboard and screen reader can’t finish this task.",
    );
  });

  it("names the slowest person when everyone finishes", () => {
    const f = raceFinding([lane("mouse", 4.4), lane("keyboard", 9), lane("screenreader", 28.2)]);
    expect(f).toEqual({ text: "Everyone finishes. The slowest is the screen-reader user at 28 s.", blocked: false });
  });
});
