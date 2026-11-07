"use client";

// The Race step (spec: internal/ui-v2-spec.md §3): the finding, the three lanes, one row of controls and two
// 280px cards (what the listener hears, where the seconds go). It fills its box and scrolls inside it; every
// detail that is not the answer sits in a card or behind a disclosure. No primary button: "Plan fixes" is in the step rail.

import { useId } from "react";
import { Race, raceDuration } from "@/components/race/Race";
import { TranscriptBody } from "@/components/race/Transcript";
import { useHearIt } from "@/components/race/useHearIt";
import { useRaceClock } from "@/components/race/useRaceClock";
import type { LaneEvent } from "@/lib/ui/timeline";
import { LITERATURE } from "@/lib/params/literature";
import { searchInsight } from "@/lib/ui/search-insight";
import type { RacePanelProps } from "../contract";
import { Empty, Panel } from "../ui";
import { CARD_SCROLL, RaceCard } from "./race/Card";
import { ExplainCard } from "./race/ExplainCard";
import { raceFinding } from "./race/finding";
import { HearButton } from "./race/HearButton";
import { RaceSkeleton } from "./race/RaceSkeleton";
import { RaceAtRest } from "./race/RaceAtRest";

const NO_EVENTS: readonly LaneEvent[] = [];

export function RacePanel({ headingRef, task, result, lanes, loading, runKey, isUrl, hideInsight }: RacePanelProps) {
  const ids = useId();
  const duration = lanes ? raceDuration(lanes) : 0;
  const clock = useRaceClock(duration, `${task?.id ?? ""}-${runKey}`);
  const sr = lanes?.find((l) => l.persona === "screenreader");
  const hear = useHearIt(sr?.events ?? NO_EVENTS, LITERATURE.speech.wpm.value);
  const hasSpeech = !!sr?.events.some((e) => e.utterance);

  const found = result ? searchInsight(result.personas.screenreader) : undefined;
  const search = result && found && !hideInsight(result.taskId, found) ? found : undefined;

  const showEmpty = !loading && (!task || !result || !lanes || !sr);
  let body;
  if (loading) {
    body = <RaceSkeleton message={isUrl ? "Reading the page…" : "Reading the page’s accessibility tree and modelling each person…"} />;
  } else if (showEmpty || !task || !result || !lanes || !sr) {
    body = <RaceAtRest />;
  } else {
    const finding = raceFinding(lanes);
    body = (
      <>
        <p className={`text-xl font-semibold leading-7 ${finding.blocked ? "text-blocked" : "text-ink"}`}>{finding.text}</p>
        <p className="text-sm leading-5 text-muted">{task.label}</p>

        <div className="mt-4">
          <Race
            idBase="race"
            taskLabel={task.label}
            lanes={lanes}
            clock={clock}
            announcePrefix="Race finished."
            compact
            controlsExtra={<HearButton hear={hear} hasSpeech={hasSpeech} />}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 @[600px]:grid-cols-2">
          <RaceCard id={`${ids}-hears`} title="What the listener hears" note="Faded words are what the listener skips past.">
            <TranscriptBody lane={sr} clock={clock} hear={hear} compact className={`${CARD_SCROLL} border-t border-rule bg-paper`} />
          </RaceCard>
          <ExplainCard id={`${ids}-why`} result={result} search={search} />
        </div>
      </>
    );
  }

  return (
    <Panel title="The race" headingRef={headingRef}>
      <div className={`@container relative text-sm leading-5 ${showEmpty ? "h-full" : ""}`}>{body}</div>
    </Panel>
  );
}
