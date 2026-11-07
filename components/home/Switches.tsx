"use client";

import { useId, useState, type CSSProperties } from "react";

/**
 * Sentences with switches. Three fixes for the Northwind demo store, each a real switch. When a band is on, its
 * consequence line shows. The figures are Detour's predictions for the task "Add the Trail Jacket in size M to the
 * cart" and for opening the cart; they are copied from the README, never computed here. Two fixes interact: a skip
 * link only pays off once the sizes are buttons, so the size band's figure changes when both are on.
 */
type Key = "name" | "size" | "skip";
type State = Record<Key, boolean>;

interface Band {
  key: Key;
  sentence: string;
  /** Flat field colour of the band while it is on. A different one per band. */
  field: string;
}

const BANDS: readonly Band[] = [
  { key: "name", sentence: "Give the cart button a name.", field: "var(--screenreader-tint)" },
  { key: "size", sentence: "Make the size options real buttons.", field: "var(--keyboard-tint)" },
  { key: "skip", sentence: "Add a skip link.", field: "var(--lime)" },
];

function consequence(key: Key, on: State): string | null {
  if (!on[key]) return null;
  if (key === "name") return "Screen-reader user, open your cart: can’t finish → 6.6 s.";
  if (key === "size") {
    return on.skip ? "Keyboard user, buy size M: can’t finish → 4.4 s." : "Keyboard user, buy size M: can’t finish → 18.4 s.";
  }
  return on.size
    ? "Together with the size buttons: 18.4 s → 4.4 s for the keyboard user."
    : "Keyboard user: still can’t finish. A skip link only pays off once the sizes are buttons.";
}

export function Switches({ labelledBy }: { labelledBy: string }) {
  const uid = useId();
  const [on, setOn] = useState<State>({ name: true, size: true, skip: false });
  // The whole band is the target for a pointer. The button inside is the keyboard and screen-reader control: its
  // click (Enter, Space or a tap on it) bubbles up to the band, so each press toggles exactly once.
  const toggle = (key: Key) => setOn((s) => ({ ...s, [key]: !s[key] }));

  return (
    <ul className="sw-list" role="list" aria-labelledby={labelledBy}>
      {BANDS.map((b, i) => {
        const line = consequence(b.key, on);
        const sentenceId = `${uid}-${b.key}-s`;
        const lineId = `${uid}-${b.key}-c`;
        return (
          <li key={b.key} className="sw-band" data-ui data-reveal data-on={on[b.key]} style={{ "--field": b.field, "--i": i } as CSSProperties} onClick={() => toggle(b.key)}>
            <div className="hm-wrap sw-inner">
              <div className="sw-text">
                <p id={sentenceId} className="sw-sentence">
                  {b.sentence}
                </p>
                <p id={lineId} className="sw-line" aria-live="polite">
                  {line && <span key={line}>{line}</span>}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on[b.key]}
                aria-labelledby={sentenceId}
                aria-describedby={lineId}
                className="sw-btn"
                data-ui
              >
                <span className="sw-track" aria-hidden="true">
                  <span className="sw-knob" />
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
