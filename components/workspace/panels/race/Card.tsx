import type { ReactNode } from "react";

/** Height of the two cards under the lanes. Whatever does not fit scrolls inside the card. */
export const CARD_HEIGHT = 280;

/** A bordered 280px card: a 14/600 heading, then a scroll area that fills the rest (the caller renders it). */
export function RaceCard({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-rule" style={{ height: CARD_HEIGHT }}>
      <div className="shrink-0 px-3 pb-2 pt-3">
        <h3 id={id} className="text-sm font-semibold leading-5">
          {title}
        </h3>
        {note && <p className="text-xs leading-4 text-muted">{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** Classes for a card scroll area. `relative` keeps its sr-only text inside it; the focus ring sits inside, so the card does not clip it. */
export const CARD_SCROLL = "relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-3px]";
