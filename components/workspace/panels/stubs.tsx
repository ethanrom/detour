"use client";

// Placeholders the shell renders until the real panels land (the lead swaps the exports in index.ts).
import type { ChangeDrawerProps, FixPanelProps, PlanPanelProps, RacePanelProps, RecheckPanelProps } from "../contract";
import { Empty, Panel } from "../ui";

export function RacePanelStub({ headingRef, task }: RacePanelProps) {
  return (
    <Panel title="The race" headingRef={headingRef}>
      <Empty>{task ? `Race for “${task.label}”.` : "Pick a task on the left."}</Empty>
    </Panel>
  );
}
export function PlanPanelStub({ headingRef }: PlanPanelProps) {
  return (
    <Panel title="The plan" headingRef={headingRef}>
      <Empty>The plan goes here.</Empty>
    </Panel>
  );
}
export function FixPanelStub({ headingRef }: FixPanelProps) {
  return (
    <Panel title="Fixes on the page" headingRef={headingRef}>
      <Empty>The fix run goes here.</Empty>
    </Panel>
  );
}
export function RecheckPanelStub({ headingRef }: RecheckPanelProps) {
  return (
    <Panel title="Same task, same three people, fewer seconds" headingRef={headingRef}>
      <Empty>The re-check goes here.</Empty>
    </Panel>
  );
}
export function ChangeDrawerStub(_: ChangeDrawerProps) {
  return null;
}
