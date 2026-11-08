"use client";

import { useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, ReplayIcon } from "@/components/icons";
import { fmtNum, fmtRange, fmtResultSpoken, fmtSeconds } from "@/lib/ui/format";
import type { PersonaId, TaskResult } from "@/lib/contracts";
import { PERSONA_BY_ID, STRATEGY_LABEL, commandKey } from "@/lib/ui/personas";
import { axis as buildAxis, longestDuration, playbackRate, wallDuration, type Lane } from "@/lib/ui/timeline";
import { LaneRow } from "./LaneRow";
import type { RaceClock } from "./useRaceClock";

/** Length of the shared time axis: the longest lane, before or after. */
export function raceDuration(lanes: readonly Lane[], ghost?: readonly Lane[]): number {
  return Math.max(longestDuration(lanes), ghost ? longestDuration(ghost) : 0);
}

interface Props {
  idBase: string;
  taskLabel: string;
  lanes: Lane[];
  /** "Before" lanes, drawn as ghosts behind the solid "after" lanes. */
  ghost?: Lane[];
  /** What a plan predicted for this task: drawn as a grey mark on each lane, and as a column of the text table. */
  predicted?: TaskResult;
  clock: RaceClock;
  /** Spoken in the live region when the race ends, e.g. "After the fixes." */
  announcePrefix?: string;
  /**
   * For a workspace column (about 440 to 700 px wide): 64px lanes with the name, the track and the time in one row
   * (the app's 14, 12 and 28 px type); the controls become one 36px row under the lanes (Replay, Fast / 1×, then
   * `controlsExtra`); the Position slider shows only when animation is off; the event log is left out (each lane's
   * events are still reachable with the arrow keys, and the text table is unchanged).
   */
  compact?: boolean;
  /** Compact only: more controls at the end of the controls row, for example "Hear it". */
  controlsExtra?: ReactNode;
}

/** Predicted seconds of one person: null when they cannot finish, undefined when nothing was predicted. */
function predictedSeconds(predicted: TaskResult | undefined, persona: PersonaId): number | null | undefined {
  const p = predicted?.personas[persona];
  return p ? (p.blocked ? null : p.seconds) : undefined;
}

function laneSentence(l: Lane): string {
  const name = PERSONA_BY_ID[l.persona].label;
  if (l.blocked) return `${name}: can't finish. ${l.blocked.reason}`;
  return `${name}: ${fmtResultSpoken(l.seconds, l.interval)}`;
}

export function Race({ idBase, taskLabel, lanes, ghost, predicted, clock, announcePrefix, compact, controlsExtra }: Props) {
  const ax = buildAxis(clock.duration);
  const fastWall = wallDuration(clock.duration, playbackRate(clock.duration, "fast"));
  const message = clock.finished
    ? `${announcePrefix ?? "Race finished."} Task: ${taskLabel}. ${lanes.map(laneSentence).join(" ")}`
    : "";
  const ControlIcon = clock.finished ? ReplayIcon : clock.playing ? PauseIcon : PlayIcon;
  const controlLabel = clock.finished ? "Replay" : clock.playing ? "Pause" : "Play";

  // Compact: one 36px row under the lanes. "Hear it" and friends arrive as `controlsExtra`.
  const compactControls = (
    <div className="mt-3">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className="btn btn-sm" onClick={clock.toggle}>
          <ControlIcon size={16} />
          {controlLabel}
        </button>
        <div role="group" aria-label="Playback speed" className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
          {(
            [
              ["fast", "Fast", `Fast, about ${fmtNum(fastWall)} seconds`],
              ["real", "1×", "1× real time"],
            ] as const
          ).map(([id, label, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={clock.speed === id}
              aria-label={name}
              onClick={() => clock.setSpeed(id)}
              className={`h-[30px] rounded border px-3 text-sm font-medium transition-colors ${
                clock.speed === id ? "border-ink bg-lime text-ink" : "border-transparent text-ink hover:bg-paper-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {controlsExtra}
        {clock.reduced && (
          <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-sm text-muted">
            <span className="shrink-0 font-medium text-ink">Position</span>
            <input
              type="range"
              min={0}
              max={Math.max(clock.duration, 0.1)}
              step={0.1}
              value={clock.elapsed}
              onChange={(e) => clock.seek(Number(e.target.value))}
              aria-valuetext={`${fmtNum(clock.elapsed)} of ${fmtNum(clock.duration)} model seconds`}
              className="h-2 w-full min-w-0 cursor-pointer accent-ink"
            />
          </label>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {/* Controls */}
      {!compact && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <button type="button" className="btn btn-sm max-sm:min-h-11" onClick={clock.toggle}>
              <ControlIcon size={16} />
              {controlLabel}
            </button>

            <div role="group" aria-label="Playback speed" className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
              {(
                [
                  ["fast", `Fast · ${fmtNum(fastWall)} s`],
                  ["real", "1× real time"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={clock.speed === id}
                  onClick={() => clock.setSpeed(id)}
                  className={`min-h-8 rounded border px-3 text-sm font-medium transition-colors max-sm:min-h-10 ${
                    clock.speed === id ? "border-ink bg-lime text-ink" : "border-transparent text-ink hover:bg-paper-2"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="flex min-w-[10rem] flex-1 items-center gap-2.5 text-sm text-muted">
              <span className="shrink-0 font-medium text-ink">Position</span>
              <input
                type="range"
                min={0}
                max={Math.max(clock.duration, 0.1)}
                step={0.1}
                value={clock.elapsed}
                onChange={(e) => clock.seek(Number(e.target.value))}
                aria-valuetext={`${fmtNum(clock.elapsed)} of ${fmtNum(clock.duration)} model seconds`}
                className="h-2 w-full min-w-0 cursor-pointer accent-ink"
              />
            </label>
          </div>
        </>
      )}

      {/* Lanes */}
      <div className={compact ? "" : "mt-4"}>
        <div
          className={compact ? "grid grid-cols-[7.75rem_minmax(0,1fr)_6rem] gap-x-3" : "hidden gap-x-4 sm:grid sm:grid-cols-[9.5rem_minmax(0,1fr)_9.25rem]"}
          aria-hidden="true"
        >
          <span />
          <div className="relative h-5">
            {ax.ticks.map((t, i) => (
              <span
                key={t}
                className={`tnum absolute top-0 whitespace-nowrap text-muted ${compact ? "text-xs" : "text-[0.8125rem]"}`}
                style={{
                  left: `${(t / ax.max) * 100}%`,
                  transform: i === 0 ? "none" : "translateX(-50%)",
                }}
              >
                {t} s
              </span>
            ))}
          </div>
          <span />
        </div>
        <div className="divide-y divide-rule">
          {lanes.map((lane) => (
            <LaneRow
              key={lane.persona}
              lane={lane}
              ghost={ghost?.find((g) => g.persona === lane.persona)}
              predicted={predictedSeconds(predicted, lane.persona)}
              axis={ax}
              elapsed={clock.elapsed}
              idBase={idBase}
              compact={compact}
            />
          ))}
        </div>
      </div>
      {compact && compactControls}

      {/* Text alternative */}
      <div className="sr-only">
      <table>
        <caption>Predicted times for the task: {taskLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col">Most likely strategy</th>
            {ghost && <th scope="col">Before</th>}
            <th scope="col">{ghost ? "After" : "Prediction"}</th>
            {predicted && <th scope="col">Predicted</th>}
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((l) => {
            const g = ghost?.find((x) => x.persona === l.persona);
            return (
              <tr key={l.persona}>
                <th scope="row">{PERSONA_BY_ID[l.persona].label}</th>
                <td>{STRATEGY_LABEL[l.strategy]}</td>
                {ghost && <td>{g ? (g.blocked ? "Can't finish" : fmtSeconds(g.seconds)) : "–"}</td>}
                <td>{l.blocked ? "Can't finish" : `${fmtSeconds(l.seconds)}, 90% interval ${fmtRange(l.interval)} s`}</td>
                {predicted && (
                  <td>{predictedSeconds(predicted, l.persona) === null ? "Can't finish" : fmtSeconds(predictedSeconds(predicted, l.persona) ?? 0)}</td>
                )}
                <td>{l.blocked ? l.blocked.reason : "Finishes the task"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>

      {!compact && <EventLog lanes={lanes} />}
    </div>
  );
}

/** Every event of every lane as a table: the keyboard/screen-reader equivalent of hovering the ticks. */
function EventLog({ lanes }: { lanes: Lane[] }) {
  const [open, setOpen] = useState(false);
  const total = lanes.reduce((n, l) => n + l.events.length, 0);
  return (
    <details className="mt-3 rounded-lg border border-rule bg-surface px-3 py-2.5 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">Event log: all {total} events as a table</summary>
      {open && (
        <div className="mt-3 max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Event log table">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead className="sticky top-0 border-b border-rule bg-surface text-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">Persona</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Time</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Key</th>
                <th scope="col" className="px-2 py-1.5 font-medium">What happens</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {lanes.flatMap((l) =>
                l.events.map((e) => (
                  <tr key={`${l.persona}-${e.index}`} className="border-t border-rule">
                    <th scope="row" className="px-2 py-1 font-semibold">{PERSONA_BY_ID[l.persona].label}</th>
                    <td className="tnum px-2 py-1 text-right">{e.start.toFixed(1)} s</td>
                    <td className="px-2 py-1"><kbd className="font-mono">{commandKey(e.command)}</kbd></td>
                    <td className="px-2 py-1">{e.label}</td>
                    <td className="tnum px-2 py-1 text-right">{e.dt.toFixed(2)} s</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

