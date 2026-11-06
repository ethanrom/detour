"use client";

import { useEffect, useRef } from "react";
import { SpeakerIcon, StopIcon } from "@/components/icons";
import { LITERATURE } from "@/lib/params/literature";
import { commandKey } from "@/lib/ui/personas";
import { splitUtterance } from "@/lib/ui/speech";
import { laneFrame, type Lane } from "@/lib/ui/timeline";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import type { RaceClock } from "./useRaceClock";
import { useHearIt } from "./useHearIt";

interface Props {
  lane: Lane;
  clock: RaceClock;
}

export function Transcript({ lane, clock }: Props) {
  const wpm = LITERATURE.speech.wpm.value;
  const reduced = useReducedMotion();
  const hear = useHearIt(lane.events, wpm);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLLIElement | null>>([]);

  const raceActive = laneFrame(lane, clock.elapsed).activeIndex;
  const active = hear.speaking && hear.spokenIndex !== null ? hear.spokenIndex : raceActive;
  const spoken = lane.events.filter((e) => e.utterance).length;

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

  return (
    <section aria-labelledby="transcript-h" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">Screen reader</p>
          <h2 id="transcript-h" className="h-card mt-1.5">
            What the listener hears
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            Every stop on the shortest path, in order. Faded words are what the modelled listener skips past.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button
            type="button"
            className={`btn btn-sm ${hear.speaking ? "btn-ink" : "btn-primary"}`}
            onClick={hear.speaking ? hear.stop : hear.start}
            disabled={!hear.supported || spoken === 0}
          >
            {hear.speaking ? <StopIcon size={16} /> : <SpeakerIcon size={16} />}
            {hear.speaking ? "Stop" : "Hear it"}
          </button>
          <span className="text-xs text-muted">
            {hear.supported ? `Spoken at ${hear.rate.toFixed(2)}× (${wpm} words/min)` : "Speech is not available in this browser"}
          </span>
        </div>
      </div>

      <div
        ref={scroller}
        role="region"
        aria-label="Screen reader transcript"
        tabIndex={0}
        className="relative mt-4 max-h-[22rem] overflow-y-auto rounded-xl border border-rule bg-paper"
      >
        {lane.events.length === 0 ? (
          <p className="p-4 text-sm text-muted">No events to show.</p>
        ) : (
          <ol className="divide-y divide-rule/60">
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
                  className={`grid grid-cols-[3.25rem_4.25rem_1fr] items-baseline gap-x-2 border-l-4 px-3 py-1.5 text-[0.9375rem] leading-snug ${
                    isActive ? "border-ink bg-lime font-semibold" : "border-transparent"
                  } ${isFuture && !isActive ? "text-muted" : "text-ink"}`}
                >
                  <span className="tnum text-xs text-muted">{isActive ? <span className="text-ink">{e.start.toFixed(1)} s</span> : `${e.start.toFixed(1)} s`}</span>
                  <span>
                    <kbd className="rounded border border-rule-strong bg-surface px-1.5 py-px font-mono text-[0.6875rem] font-bold text-ink">
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
    </section>
  );
}

/** The event label without the key name the row already shows ("Enter → activate M" → "activate M"). */
function restLabel(key: string, label: string): string {
  const l = label.trim();
  if (l.toLowerCase() === key.toLowerCase()) return "";
  if (!l.toLowerCase().startsWith(key.toLowerCase())) return l;
  return l.slice(key.length).replace(/^\s*(→|->)?\s*/, "");
}
