"use client";

import { useEffect, useState } from "react";
import { PROOF_ITEMS, PROOF_LEAD } from "./proof";

const STEP_MS = 2000;

/**
 * The proof sentence. The opening words are the section's heading. One name at a time is lit in full ink and the
 * lit name moves every 2 seconds. Without script, and under reduced motion, nothing is dimmed: every name is in
 * full ink and the sentence is static.
 */
export function ProofCycle({ headingId }: { headingId: string }) {
  const [lit, setLit] = useState<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      if (reduced.matches) {
        setLit(null);
        return;
      }
      setLit(0);
      timer = window.setInterval(() => setLit((i) => ((i ?? -1) + 1) % PROOF_ITEMS.length), STEP_MS);
    };
    start();
    reduced.addEventListener("change", start);
    return () => {
      window.clearInterval(timer);
      reduced.removeEventListener("change", start);
    };
  }, []);

  const last = PROOF_ITEMS.length - 1;
  return (
    <div className="proof" data-cycling={lit !== null}>
      <h2 id={headingId} className="proof-lead">
        {PROOF_LEAD}
      </h2>{" "}
      <p className="proof-run">
        {PROOF_ITEMS.map((item, i) => (
          <span key={item} className={`proof-item${lit === i ? " is-lit" : ""}`}>
            {i === last ? `and ${item}.` : `${item},`}
            {i < last ? " " : ""}
          </span>
        ))}
      </p>
    </div>
  );
}
