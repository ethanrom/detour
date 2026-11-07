import type { CSSProperties } from "react";
import { PersonaIcon } from "@/components/icons";
import type { PersonaId } from "@/lib/contracts";

const COLOURS: Record<PersonaId, { tint: string; ink: string }> = {
  mouse: { tint: "var(--mouse-tint)", ink: "var(--mouse)" },
  keyboard: { tint: "var(--keyboard-tint)", ink: "var(--keyboard)" },
  screenreader: { tint: "var(--screenreader-tint)", ink: "var(--screenreader)" },
};

/** A small inline frame inside a statement: the persona's icon on its tint. Part of the line, never floating. */
export function Chip({ persona, order }: { persona: PersonaId; order: number }) {
  const c = COLOURS[persona];
  return (
    <span className="hm-chip" data-ui aria-hidden="true" style={{ background: c.tint, color: c.ink, "--c": order } as CSSProperties}>
      <PersonaIcon persona={persona} className="hm-chip-icon" />
    </span>
  );
}
