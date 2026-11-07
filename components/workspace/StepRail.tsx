"use client";

import { useRef, type KeyboardEvent } from "react";
import { CheckIcon } from "@/components/icons";
import type { StepId } from "./contract";
import type { StepInfo } from "./steps";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export const tabId = (id: StepId) => `step-tab-${id}`;
export const panelId = (id: StepId) => `step-panel-${id}`;

/** The rail's one action: what the step offers and what it does. */
export interface RailAction {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** A quiet button, for a repeat of something already done. */
  secondary?: boolean;
}

interface Props {
  steps: StepInfo[];
  step: StepId;
  /** `focus: false` keeps focus where it is (arrow keys on the tabs). */
  onStep: (id: StepId, opts?: { focus?: boolean }) => void;
  primary: RailAction | null;
}

/** Race, Plan, Fix and Re-check as a tablist, and the one action that moves the loop on. */
export function StepRail({ steps, step, onStep, primary }: Props) {
  const tabs = useRef<Partial<Record<StepId, HTMLButtonElement | null>>>({});

  // Arrow keys, Home and End move between the tabs that can be opened, and open them (focus stays on the tab).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const open = steps.filter((s) => s.ready);
    const at = open.findIndex((s) => s.id === step);
    let next: StepInfo | undefined;
    if (e.key === "ArrowRight") next = open[(at + 1) % open.length];
    else if (e.key === "ArrowLeft") next = open[(at - 1 + open.length) % open.length];
    else if (e.key === "Home") next = open[0];
    else if (e.key === "End") next = open[open.length - 1];
    else return;
    e.preventDefault();
    if (!next) return;
    tabs.current[next.id]?.focus();
    onStep(next.id, { focus: false });
  }

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-rule bg-surface pl-2 pr-2.5 max-sm:flex-col max-sm:items-stretch max-sm:px-0">
      <div role="tablist" aria-label="Steps" onKeyDown={onKeyDown} className="flex self-stretch max-sm:px-1">
        {steps.map((s) => {
          const active = s.id === step;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[s.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(s.id)}
              aria-selected={active}
              aria-controls={panelId(s.id)}
              aria-disabled={s.ready ? undefined : true}
              aria-describedby={s.done ? `${tabId(s.id)}-done` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (s.ready && !active) onStep(s.id);
              }}
              className={cx(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 text-sm font-medium max-sm:h-11 max-sm:flex-1 max-sm:justify-center max-sm:px-1",
                active ? "border-ink text-ink" : "border-transparent",
                !active && s.ready && "text-ink-2 hover:text-ink",
                !s.ready && "cursor-not-allowed text-[#78858b]",
              )}
            >
              {s.done && <CheckIcon size={12} />}
              {s.label}
              {s.done && (
                <span id={`${tabId(s.id)}-done`} className="sr-only">
                  Done
                </span>
              )}
            </button>
          );
        })}
      </div>
      {primary && (
        // globals.css lets `.btn:hover` (more specific than `.btn-primary`) turn the primary's fill pale under white text.
        <button type="button" className={cx("btn btn-sm", !primary.secondary && "btn-primary enabled:hover:bg-ink-2!", "max-sm:mx-2 max-sm:mb-2")} disabled={primary.disabled} aria-busy={primary.disabled || undefined} onClick={primary.onClick}>
          {primary.label}
        </button>
      )}
    </div>
  );
}
