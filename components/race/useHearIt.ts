"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LaneEvent } from "@/lib/ui/timeline";
import { speechRateFromWpm, textToSpeak } from "@/lib/ui/speech";

const noopSubscribe = () => () => {};

/**
 * Speaks the screen-reader utterances of a lane with window.speechSynthesis, one after another, at a
 * rate derived from the modelled words per minute. Truncated announcements are cut short in the same
 * proportion the modelled listener skips them. Utterances are chained (not queued) so Stop is instant.
 */
export function useHearIt(events: readonly LaneEvent[], wpm: number) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);
  const [spokenIndex, setSpokenIndex] = useState<number | null>(null);
  const run = useRef(0);
  // Keep a reference: some browsers garbage-collect an utterance before its events fire.
  const keep = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    run.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setSpokenIndex(null);
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const items = events.filter((e) => e.utterance);
    if (!items.length) return;
    run.current += 1;
    const mine = run.current;
    const rate = speechRateFromWpm(wpm);
    setSpeaking(true);
    const speakAt = (i: number) => {
      if (mine !== run.current) return;
      if (i >= items.length) {
        setSpeaking(false);
        setSpokenIndex(null);
        return;
      }
      const e = items[i];
      const u = new SpeechSynthesisUtterance(textToSpeak(e.utterance!, wpm));
      u.rate = rate;
      u.lang = "en-US";
      u.onstart = () => {
        if (mine === run.current) setSpokenIndex(e.index);
      };
      u.onend = () => speakAt(i + 1);
      u.onerror = () => speakAt(i + 1);
      keep.current = u;
      synth.speak(u);
    };
    speakAt(0);
  }, [events, wpm]);

  useEffect(() => stop, [stop]);
  // New data: stop whatever was being read.
  useEffect(() => {
    stop();
  }, [events, stop]);

  return { supported, speaking, spokenIndex, start, stop, rate: speechRateFromWpm(wpm) };
}
