"use client";

import { useEffect, useRef } from "react";
import { LITERATURE } from "@/lib/params/literature";
import { commandKey } from "@/lib/ui/personas";
import { splitUtterance } from "@/lib/ui/speech";
import { laneFrame, type Lane } from "@/lib/ui/timeline";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import type { RaceClock } from "./useRaceClock";
import type { HearIt } from "./useHearIt";

/**
 * The scrolling list of what the listener hears, without a card, a heading or a button. It follows the race
 * clock (or the spoken line while `hear` is speaking). The panel owns `hear` (useHearIt) and its "Hear it"
 * button, and passes it in. `className` styles the scroller. `compact` uses the app's 14 and 12 px sizes and narrower columns, for a card in a workspace column.
 */
export function TranscriptBody({
  lane,
  clock,
  hear,
  className,
  compact,
}: {
  lane: Lane;
  clock: RaceClock;
  hear: HearIt;
  className: string;
  compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const wpm = LITERATURE.speech.wpm.value;
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLLIElement | null>>([]);

  const raceActive = laneFrame(lane, clock.elapsed).activeIndex;
  const active = hear.speaking && hear.spokenIndex !== null ? hear.spokenIndex : raceActive;

  useEffect(() => {
    const box = scroller.current;
    const row = rows.current[active];
    if (!box || !row || active < 0) {
      if (box && active < 0) box.scrollTop = 0;
      return;
    }
    box.scrollTo({
      top: row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [active, reduced]);

  const small = compact ? "text-xs" : "text-[0.8125rem]";

  return (
    <div ref={scroller} role="region" aria-label="Screen reader transcript" tabIndex={0} className={className}>
      {lane.events.length === 0 ? (
        <p className="p-4 text-sm text-muted">No events to show.</p>
      ) : (
        <ol className="divide-y divide-rule">
          {lane.events.map((e) => {
            const isActive = e.index === active;
            const isFuture = e.index > active;
            const parts = e.utterance ? splitUtterance(e.utterance, wpm) : null;
            return (
              <li
                key={e.index}
                ref={(el) => {
                  rows.current[e.index] = el;
                }}
                aria-current={isActive ? "step" : undefined}
                className={`grid items-baseline gap-x-3 px-3 py-1.5 leading-snug ${
                  compact ? "grid-cols-[2.75rem_3.75rem_minmax(0,1fr)] text-sm" : "grid-cols-[3.25rem_4.5rem_1fr] text-[0.9375rem]"
                } ${isActive ? "bg-lime font-semibold" : ""} ${isFuture && !isActive ? "text-muted" : "text-ink"}`}
              >
                <span className={`tnum text-right ${small} text-muted`}>
                  {isActive ? <span className="text-ink">{e.start.toFixed(1)} s</span> : `${e.start.toFixed(1)} s`}
                </span>
                <span>
                  <kbd className={`rounded border border-rule-strong bg-surface px-1.5 py-px font-mono ${small} font-semibold text-ink`}>
                    {commandKey(e.command)}
                  </kbd>
                </span>
                {parts ? (
                  <span>
                    <span>{parts.heard}</span>
                    {parts.cut && (
                      <>
                        {" "}
                        <span className="text-muted underline decoration-dotted underline-offset-4">{parts.cut}</span>
                        <span className="sr-only"> (skipped before it finished)</span>
                      </>
                    )}
                  </span>
                ) : (
                  <span className="italic text-muted">{restLabel(commandKey(e.command), e.label) || (e.command === "think" ? "plans the next step" : "")}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The event label without the key name the row already shows ("Enter → activate M" → "activate M"). */
function restLabel(key: string, label: string): string {
  const l = label.trim();
  if (l.toLowerCase() === key.toLowerCase()) return "";
  if (!l.toLowerCase().startsWith(key.toLowerCase())) return l;
  return l.slice(key.length).replace(/^\s*(→|->)?\s*/, "");
}
