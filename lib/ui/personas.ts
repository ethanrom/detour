import type { PersonaId, StrategyId } from "@/lib/contracts";

export type MarkerShape = "circle" | "square" | "diamond";

export interface PersonaMeta {
  id: PersonaId;
  label: string;
  /** "a blind screen-reader user" */
  who: string;
  /** CSS variable for the colour. */
  color: string;
  tint: string;
  /** Utility class that fills a bar with the persona colour plus a distinguishing pattern. */
  pattern: string;
  shape: MarkerShape;
  blurb: string;
}

export const PERSONAS: readonly PersonaMeta[] = [
  {
    id: "mouse",
    label: "Mouse",
    who: "a mouse user",
    color: "var(--mouse)",
    tint: "var(--mouse-tint)",
    pattern: "pattern-mouse",
    shape: "circle",
    blurb: "Points and clicks. Time is Fitts's law plus KLM mental and button operators.",
  },
  {
    id: "keyboard",
    label: "Keyboard",
    who: "a keyboard-only user",
    color: "var(--keyboard)",
    tint: "var(--keyboard-tint)",
    pattern: "pattern-keyboard",
    shape: "square",
    blurb: "Tab, Shift+Tab and skip links only. Anything that cannot take focus cannot be reached.",
  },
  {
    id: "screenreader",
    label: "Screen reader",
    who: "a blind screen-reader user",
    color: "var(--screenreader)",
    tint: "var(--screenreader-tint)",
    pattern: "pattern-screenreader",
    shape: "diamond",
    blurb: "Listens to every stop. Time is keystrokes plus speech on a shortest path through the page.",
  },
] as const;

export const PERSONA_BY_ID: Record<PersonaId, PersonaMeta> = {
  mouse: PERSONAS[0],
  keyboard: PERSONAS[1],
  screenreader: PERSONAS[2],
};

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  point: "Point and click",
  tab: "Tab key only",
  headings: "Jump by headings",
  linear: "Read line by line",
  find: "Find on page",
  landmarks: "Jump by landmarks",
};

/** Short key names for event ticks, keyed by CommandId. */
export const COMMAND_KEY: Record<string, string> = {
  think: "Think",
  point: "Point",
  click: "Click",
  scroll: "Scroll",
  tab: "Tab",
  shiftTab: "Shift+Tab",
  next: "↓",
  prev: "↑",
  nextHeading: "H",
  nextLandmark: "D",
  find: "Find",
  activate: "Enter",
  type: "Type",
};

export function commandKey(command: string): string {
  return COMMAND_KEY[command] ?? command;
}
