"use client";

import { useMemo } from "react";
import { Race, raceDuration } from "@/components/race/Race";
import { useRaceClock } from "@/components/race/useRaceClock";
import type { TaskResult } from "@/lib/contracts";
import { PERSONA_ORDER, buildLane } from "@/lib/ui/timeline";

/**
 * The race again, on the fixed page: solid lanes are the re-check, ghosts are the page before, the grey mark is what
 * the plan predicted. The parent gives it a new `key` when a run finishes or the task changes, which restarts the clock.
 */
export function AfterRace({ before, after, predicted, taskLabel }: { before: TaskResult; after: TaskResult; predicted?: TaskResult; taskLabel: string }) {
  const lanes = useMemo(() => PERSONA_ORDER.map((p) => buildLane(after.personas[p])), [after]);
  const ghost = useMemo(() => PERSONA_ORDER.map((p) => buildLane(before.personas[p])), [before]);
  const clock = useRaceClock(raceDuration(lanes, ghost));
  return <Race idBase="after" taskLabel={taskLabel} lanes={lanes} ghost={ghost} predicted={predicted} clock={clock} announcePrefix="After the fixes." />;
}
