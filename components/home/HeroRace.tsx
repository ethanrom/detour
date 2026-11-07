import type { CSSProperties } from "react";

/**
 * The word in the headline: a tiny live crop of Detour's race. Three thin lanes on one clock. Mouse reaches the
 * end at 5 s, keyboard stops at about 35% with a cross, screen reader reaches the end at 17 s (the Northwind task
 * "Add the Trail Jacket in size M to the cart"). Keyboard is striped and screen reader dotted, as in the race.
 * Pure HTML and CSS; styles are in app/home.css. At rest (and under reduced motion) it shows the finished race.
 */
const LANES = [
  { id: "mouse", end: 29.4, shape: "circle" },
  { id: "keyboard", end: 35, shape: "square" },
  { id: "screenreader", end: 100, shape: "diamond" },
] as const;

export function HeroRace() {
  return (
    <span className="race" data-ui aria-hidden="true">
      <span className="race-in">
        {LANES.map((l) => (
          <span key={l.id} className="race-lane">
            <span className="race-lane-in">
              <span className="race-track" />
              <span className={`race-run race-run-${l.id}`} style={{ "--end": `${l.end}%` } as CSSProperties}>
                <span className={`race-fill pattern-${l.id}`} />
                <span className={`race-mk race-mk-${l.shape} pattern-${l.id}`} />
                {l.id === "keyboard" && (
                  <svg className="race-x" viewBox="0 0 10 10" focusable="false">
                    <path d="M1.5 1.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
              </span>
            </span>
          </span>
        ))}
        <span className="race-clock">
          <span className="race-hand-wrap">
            <span className="race-hand" />
          </span>
        </span>
      </span>
    </span>
  );
}
