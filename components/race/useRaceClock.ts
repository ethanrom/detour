"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playbackRate, type RaceSpeed } from "@/lib/ui/timeline";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";

export interface RaceClock {
  /** Model seconds since the race started (shared by every lane). */
  elapsed: number;
  playing: boolean;
  finished: boolean;
  speed: RaceSpeed;
  /** Model seconds per wall-clock second. */
  rate: number;
  /** Length of the shared axis (longest lane), in model seconds. */
  duration: number;
  reduced: boolean;
  setSpeed: (s: RaceSpeed) => void;
  toggle: () => void;
  restart: () => void;
  seek: (t: number) => void;
}

const START_DELAY_MS = 450;
/** Frames longer than this (background tab) do not make the race jump. */
const MAX_FRAME_S = 0.25;

/**
 * Drives the shared race clock. Under `prefers-reduced-motion` nothing animates: the clock sits at
 * the end so every lane shows its final state, and the scrubber lets the user step through instead.
 */
export function useRaceClock(duration: number, resetKey: string | number = 0): RaceClock {
  const reduced = useReducedMotion();
  const [speed, setSpeed] = useState<RaceSpeed>("fast");
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);
  const rate = playbackRate(duration, speed);

  const rateRef = useRef(rate);
  const durationRef = useRef(duration);
  useEffect(() => {
    rateRef.current = rate;
    durationRef.current = duration;
  }, [rate, duration]);

  // (Re)start whenever the data, the run counter or the motion preference changes.
  useEffect(() => {
    if (reduced) {
      setPlaying(false);
      setElapsed(duration);
      return;
    }
    setPlaying(false);
    setElapsed(0);
    const id = window.setTimeout(() => setPlaying(true), START_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [duration, reduced, run, resetKey]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME_S);
      last = now;
      setElapsed((prev) => Math.min(prev + dt * rateRef.current, durationRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const finished = elapsed >= duration - 1e-9;

  useEffect(() => {
    if (playing && finished) setPlaying(false);
  }, [playing, finished]);

  const restart = useCallback(() => setRun((n) => n + 1), []);
  const toggle = useCallback(() => {
    if (finished) {
      setRun((n) => n + 1);
      return;
    }
    setPlaying((p) => !p);
  }, [finished]);
  const seek = useCallback((t: number) => {
    setPlaying(false);
    setElapsed(Math.min(Math.max(t, 0), durationRef.current));
  }, []);

  return { elapsed, playing, finished, speed, rate, duration, reduced, setSpeed, toggle, restart, seek };
}
