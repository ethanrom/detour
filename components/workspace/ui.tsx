"use client";

// Shared building blocks for the Analyze workspace (spec: internal/ui-v2-spec.md §2). Every panel uses these, so
// the screen reads as one product: one panel shape, one row, one chip, one disclosure, one capped list.

import { useId, useState, type ReactNode, type RefObject } from "react";
import type { PersonaId } from "@/lib/contracts";
import { PersonaIcon } from "@/components/icons";
import { PERSONA_BY_ID } from "@/lib/ui/personas";
import { fmtSeconds } from "@/lib/ui/format";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** A workspace panel: white, 1px rule, 12px radius, a 48px header and a body that scrolls inside itself. */
export function Panel({
  title,
  titleId,
  headingRef,
  level = 2,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  label,
}: {
  title?: ReactNode;
  titleId?: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  level?: 2 | 3;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
}) {
  const auto = useId();
  const id = titleId ?? `${auto}-h`;
  const H = level === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={title ? id : undefined}
      aria-label={title ? undefined : label}
      className={cx("flex min-h-0 flex-col overflow-hidden rounded-xl border border-rule bg-surface", className)}
    >
      {(title || actions) && (
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-rule px-4 py-2">
          {title ? (
            <H id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-base font-semibold leading-tight outline-none">
              {title}
            </H>
          ) : (
            <span />
          )}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx("min-h-0 flex-1 overflow-auto", bodyClassName ?? "p-4")}>{children}</div>
      {footer && <div className="shrink-0 border-t border-rule px-4 py-3">{footer}</div>}
    </section>
  );
}

/** A 12px grey sentence-case group label (never uppercase, never above a heading). */
export function GroupLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="mb-2 text-xs leading-4 text-muted">
      {children}
    </p>
  );
}

export type ChipTone = PersonaId | "blocked" | "proven" | "neutral";

const TONE: Record<ChipTone, string> = {
  mouse: "text-mouse bg-[var(--mouse-tint)]",
  keyboard: "text-keyboard bg-[var(--keyboard-tint)]",
  screenreader: "text-screenreader bg-[var(--screenreader-tint)]",
  blocked: "text-blocked bg-del-bg",
  proven: "text-add-fg bg-add-bg",
  neutral: "text-ink bg-paper-2",
};

/** A 22px pill with 12px text. Colour says what it is about (a persona, blocked, proven), never decoration. */
export function Chip({ tone = "neutral", children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium tnum", TONE[tone])}>
      {children}
    </span>
  );
}

/** One persona's time as a chip: icon and seconds, or a cross and "can't finish". */
export function PersonaTime({ persona, seconds }: { persona: PersonaId; seconds: number | null }) {
  const meta = PERSONA_BY_ID[persona];
  if (seconds === null) {
    return (
      <Chip tone="blocked" title={`${meta.label}: can't finish`}>
        <PersonaIcon persona={persona} size={12} />
        <span aria-hidden="true">✕</span>
        <span className="sr-only">{meta.label}:</span> can’t finish
      </Chip>
    );
  }
  return (
    <Chip tone={persona} title={`${meta.label}: ${fmtSeconds(seconds)}`}>
      <PersonaIcon persona={persona} size={12} />
      <span className="sr-only">{meta.label}:</span>
      {fmtSeconds(seconds)}
    </Chip>
  );
}

/** A list row: optional lead (status glyph), a title with a 12px meta line, and a trailing slot. */
export function Row({ lead, title, meta, trail, children, selected, className }: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trail?: ReactNode;
  /** Extra content under the title (chips, a disclosure). */
  children?: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start gap-3 rounded-lg px-3 py-2.5", selected && "bg-lime", className)}>
      {lead && <div className="mt-0.5 shrink-0">{lead}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-5 [overflow-wrap:anywhere]">{title}</div>
        {meta && <div className="mt-0.5 text-xs leading-4 text-muted">{meta}</div>}
        {children && <div className="mt-2">{children}</div>}
      </div>
      {trail && <div className="flex shrink-0 flex-col items-end gap-1.5">{trail}</div>}
    </div>
  );
}

/** Shows the first `limit` items and a "Show all N" toggle. Lists in the workspace never print in full. */
export function Capped<T>({ items, limit = 5, render, itemKey, listLabel, as = "ul", className }: {
  items: readonly T[];
  limit?: number;
  render: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => string;
  listLabel: string;
  as?: "ul" | "ol";
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  const L = as;
  return (
    <div>
      <L aria-label={listLabel} className={cx("divide-y divide-rule", className)}>
        {shown.map((item, i) => (
          <li key={itemKey(item, i)}>{render(item, i)}</li>
        ))}
      </L>
      {items.length > limit && (
        <button type="button" className="mt-2 text-sm font-medium underline underline-offset-2" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** A native disclosure styled as a 40px row. Details live here, never on the first screen. */
export function Disclosure({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details open={defaultOpen} className={cx("group rounded-lg border border-rule", className)}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-rule p-3 text-sm">{children}</div>
    </details>
  );
}

/** A segmented single choice built on native radios (keyboard: arrow keys). */
export function Segmented<V extends string | number>({ label, options, value, onChange, name }: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
      {options.map((o) => (
        <label
          key={String(o.value)}
          className="relative flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-[5px] px-2.5 text-sm has-[:checked]:bg-lime has-[:checked]:font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent"
        >
          <input type="radio" name={name} value={String(o.value)} checked={o.value === value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Flat grey bars at the size of the text they stand in for (loading). No shimmer. */
export function Bars({ widths = ["60%", "40%"], className }: { widths?: string[]; className?: string }) {
  return (
    <div aria-hidden="true" className={cx("space-y-2", className)}>
      {widths.map((w, i) => (
        <div key={i} className="h-3 rounded bg-paper-2" style={{ width: w }} />
      ))}
    </div>
  );
}

/** One quiet sentence for an empty panel, with an optional action. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-start justify-center gap-3 text-sm text-muted">
      <p className="max-w-[48ch]">{children}</p>
      {action}
    </div>
  );
}
