"use client";

import { memo, useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CheckIcon, CrossIcon, MarkerShapeSvg, PersonaIcon } from "@/components/icons";
import { fmtElapsed, fmtRange, fmtSeconds } from "@/lib/ui/format";
import { PERSONA_BY_ID, STRATEGY_LABEL, commandKey } from "@/lib/ui/personas";
import { laneFrame, nearestEventIndex, type Axis, type Lane } from "@/lib/ui/timeline";

interface Props {
  lane: Lane;
  /** "Before" lane drawn behind the solid one (after-fix view). */
  ghost?: Lane;
  /** What a plan predicted for this person: seconds (a grey mark on the track), null when they could not finish. */
  predicted?: number | null;
  axis: Axis;
  elapsed: number;
  /** Prefix for DOM ids. */
  idBase: string;
}

const pct = (t: number, max: number) => `${Math.min(100, Math.max(0, (t / max) * 100))}%`;

/** Event ticks. Memoised on the active index, so it re-renders a handful of times per race, not per frame. */
const Ticks = memo(function Ticks({ lane, axisMax, activeIndex }: { lane: Lane; axisMax: number; activeIndex: number }) {
  return (
    <>
      {lane.events.map((e) => (
        <span
          key={e.index}
          aria-hidden="true"
          className="absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
          style={{
            left: pct(e.start, axisMax),
            height: e.index <= activeIndex ? 24 : 18,
            opacity: e.index <= activeIndex ? 0.95 : 0.32,
          }}
        />
      ))}
    </>
  );
});

function Inspector({
  lane,
  axisMax,
  idBase,
  activeIndex,
}: {
  lane: Lane;
  axisMax: number;
  idBase: string;
  activeIndex: number;
}) {
  const meta = PERSONA_BY_ID[lane.persona];
  const [hover, setHover] = useState<number | null>(null);
  const [kb, setKb] = useState<number | null>(null);
  const shown = hover ?? kb;
  const n = lane.events.length;
  const hintId = `${idBase}-hint`;

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const t = ((e.clientX - rect.left) / rect.width) * axisMax;
      setHover(nearestEventIndex(lane.events, t));
    },
    [axisMax, lane.events],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const cur = kb ?? Math.max(activeIndex, 0);
    let next = cur;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = cur + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = cur - 1;
    else if (e.key === "PageDown") next = cur + 10;
    else if (e.key === "PageUp") next = cur - 10;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setKb(Math.min(n - 1, Math.max(0, next)));
  };

  const ev = shown !== null ? lane.events[shown] : undefined;
  const cur = kb ?? Math.max(activeIndex, 0);
  const curEv = lane.events[cur];
  const frac = ev ? ev.start / axisMax : 0;
  const align = frac > 0.78 ? "-100%" : frac < 0.18 ? "0%" : "-50%";

  return (
    <>
      <div
        role="slider"
        tabIndex={n ? 0 : -1}
        aria-label={`${meta.label} events`}
        aria-describedby={hintId}
        aria-valuemin={1}
        aria-valuemax={Math.max(n, 1)}
        aria-valuenow={n ? cur + 1 : 0}
        aria-valuetext={
          curEv ? `Event ${cur + 1} of ${n}: ${curEv.label}, at ${curEv.start.toFixed(1)} seconds` : "No events"
        }
        className="absolute inset-0 z-10 cursor-crosshair rounded-lg"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setKb((k) => k ?? Math.max(activeIndex, 0))}
        onBlur={() => setKb(null)}
        onKeyDown={onKey}
      />
      <span id={hintId} className="sr-only">
        Event timeline. Use the arrow keys to inspect each event; Home and End jump to the first and last.
      </span>
      {ev && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full z-30 mb-1.5 w-max max-w-[19rem] rounded-md bg-ink px-2.5 py-1.5 text-[0.8125rem] leading-snug text-paper"
          style={{ left: pct(ev.start, axisMax), transform: `translateX(${align})` }}
        >
          <kbd className="mr-1.5 inline-block rounded bg-lime px-1.5 py-px font-mono text-[0.8125rem] font-semibold text-ink">
            {commandKey(ev.command)}
          </kbd>
          <span className="tnum text-[#b8c0cc]">{ev.start.toFixed(1)} s</span>
          <br />
          <span className="font-medium">{ev.label}</span>
        </div>
      )}
    </>
  );
}

function LaneRowImpl({ lane, ghost, predicted, axis, elapsed, idBase }: Props) {
  const meta = PERSONA_BY_ID[lane.persona];
  const frame = laneFrame(lane, elapsed);
  const done = frame.state === "finished" || frame.state === "blocked";
  const weight = lane.weight !== undefined ? ` · ${Math.round(lane.weight * 100)}% of users` : "";

  return (
    <div
      role="group"
      aria-label={`${meta.label} lane`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_9.25rem] sm:gap-y-1"
    >
      {/* Who: a plain 16px icon in the persona colour, no container */}
      <div className="flex items-start gap-2 max-sm:col-start-1 max-sm:row-start-1">
        <span className="mt-0.5 shrink-0" style={{ color: meta.color }}>
          <PersonaIcon persona={lane.persona} size={16} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold leading-tight" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="block text-[0.8125rem] leading-snug text-muted">
            {STRATEGY_LABEL[lane.strategy]}
            {weight}
          </span>
        </span>
      </div>

      {/* Track */}
      <div className="relative h-14 rounded-lg border border-rule bg-paper max-sm:col-span-2 max-sm:row-start-2">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" aria-hidden="true">
          {axis.ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-ink/10" style={{ left: pct(t, axis.max) }} />
          ))}
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink/20" />
          {ghost && (
            <span
              className="ghost-bar absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full"
              style={{ left: 0, width: pct(ghost.duration, axis.max), color: meta.color }}
            />
          )}
          <span
            className={`absolute left-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full ${
              frame.state === "blocked" ? "pattern-blocked" : meta.pattern
            }`}
            style={{ width: pct(frame.clock, axis.max) }}
          />
        </div>

        {/* Ghost end flag */}
        {ghost && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 text-[0.8125rem] leading-none text-muted"
            style={{
              left: pct(ghost.duration, axis.max),
              transform: ghost.duration / axis.max > 0.85 ? "translateX(-110%)" : "translateX(-50%)",
            }}
          >
            before
          </span>
        )}

        {/* The plan's prediction: a grey mark, no motion. */}
        {typeof predicted === "number" && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-5 z-[5] w-0 border-l-2 border-dashed border-muted"
            style={{ left: pct(predicted, axis.max) }}
          >
            <span className="absolute bottom-0 left-1 whitespace-nowrap text-[0.8125rem] leading-none text-muted">predicted</span>
          </span>
        )}

        <Ticks lane={lane} axisMax={axis.max} activeIndex={frame.activeIndex} />

        {/* Marker */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: pct(frame.clock, axis.max) }}
        >
          {frame.state === "blocked" ? (
            <span className="grid size-6 place-items-center rounded-md border-2 border-white bg-blocked text-white">
              <CrossIcon size={14} />
            </span>
          ) : frame.state === "finished" ? (
            <span
              className="grid size-6 place-items-center rounded-full border-2 border-white text-white"
              style={{ background: meta.color }}
            >
              <CheckIcon size={14} />
            </span>
          ) : (
            <MarkerShapeSvg shape={meta.shape} size={24} fill={meta.color} />
          )}
        </span>

        <Inspector
          lane={lane}
          axisMax={axis.max}
          idBase={`${idBase}-${lane.persona}`}
          activeIndex={frame.activeIndex}
        />
      </div>

      {/* Result (decorative duplicate of the results table, so hidden from assistive tech) */}
      <div aria-hidden="true" className="tnum leading-tight max-sm:col-start-2 max-sm:row-start-1 max-sm:text-right">
        {!done ? (
          <>
            <span className="block text-2xl font-semibold" style={{ color: meta.color }}>
              {fmtElapsed(frame.clock)}
            </span>
            <span className="block text-[0.8125rem] text-muted">{frame.state === "ready" ? "ready" : "elapsed"}</span>
          </>
        ) : frame.state === "blocked" ? (
          <>
            <span className="flex items-center gap-1.5 text-lg font-semibold text-blocked max-sm:justify-end">
              <CrossIcon size={18} /> Can’t finish
            </span>
            <span className="block text-[0.8125rem] text-muted">stopped at {fmtSeconds(lane.duration)}</span>
          </>
        ) : (
          <>
            <span className="block text-3xl font-semibold" style={{ color: meta.color }}>
              {fmtSeconds(lane.seconds)}
            </span>
            <span className="block text-[0.8125rem] text-muted">
              {Math.abs(lane.seconds - lane.duration) > Math.max(1, 0.15 * lane.seconds) ? (
                <>
                  expected · this path {fmtSeconds(lane.duration)}
                  <br />
                </>
              ) : null}
              90% interval {fmtRange(lane.interval)} s
              {ghost && !ghost.blocked ? (
                <>
                  <br />
                  was {fmtSeconds(ghost.seconds)}
                </>
              ) : null}
              {ghost?.blocked ? (
                <>
                  <br />
                  was can’t finish
                </>
              ) : null}
              {predicted !== undefined ? (
                <>
                  <br />
                  {predicted === null ? "predicted can’t finish" : `predicted ${fmtSeconds(predicted)}`}
                </>
              ) : null}
            </span>
          </>
        )}
      </div>

      {/* Why it stopped */}
      {frame.state === "blocked" && lane.blocked && (
        <p className="rise-in col-span-full flex items-start gap-2 rounded-md border border-blocked/30 bg-del-bg px-3 py-2 text-sm text-del-fg sm:col-start-2 sm:col-end-4">
          <CrossIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Can’t finish.</span> {lane.blocked.reason}
          </span>
        </p>
      )}
    </div>
  );
}

export const LaneRow = memo(LaneRowImpl);
