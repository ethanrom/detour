"use client";

import { SpeakerIcon, StopIcon } from "@/components/icons";
import type { HearIt } from "@/components/race/useHearIt";

/** "Hear it": speaks the screen-reader lane with the browser's voice, at the modelled words per minute. */
export function HearButton({ hear, hasSpeech }: { hear: HearIt; hasSpeech: boolean }) {
  const disabled = !hear.supported || !hasSpeech;
  return (
    <button
      type="button"
      className={`btn btn-sm ${hear.speaking ? "!border-ink !bg-lime" : ""}`}
      onClick={hear.speaking ? hear.stop : hear.start}
      disabled={disabled}
      title={
        !hear.supported
          ? "Speech is not available in this browser"
          : hear.speaking
            ? "Stop speaking"
            : `Speaks the screen-reader lane at ${hear.rate.toFixed(2)}× speed`
      }
    >
      {hear.speaking ? <StopIcon size={16} /> : <SpeakerIcon size={16} />}
      {hear.speaking ? "Stop" : "Hear it"}
    </button>
  );
}
