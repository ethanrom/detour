"use client";

// "Pick on the page": choose what a task is about without an LLM, by pointing at the page or by searching its controls
// and headings. The list is the keyboard and screen-reader way in, so it offers everything pick mode can reach.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { A11yNode, NodeId, PageModel } from "@/lib/contracts";
import { filterOptions, nodeLabel, pickOptions, roleWord } from "@/lib/ui/pick";

const MAX_SHOWN = 50;

interface Props {
  /** The page model of the loaded page; undefined while it is still being read. */
  page?: PageModel;
  picking: boolean;
  onPicking: (on: boolean) => void;
  /** The node under the pointer in pick mode. */
  hovered: A11yNode | null;
  /** A node chosen from the list (the click path goes through the preview). */
  onChoose: (nodeId: NodeId) => void;
  /** The list option the keyboard user is on, so the preview can outline it. */
  onActive: (nodeId: NodeId | null) => void;
  /** Spoken (polite) and shown after a choice. */
  message: string;
  busy: boolean;
}

export function PickBox({ page, picking, onPicking, hovered, onChoose, onActive, message, busy }: Props) {
  const options = useMemo(() => (page ? pickOptions(page) : []), [page]);
  const disabled = !page || busy;
  const hint = !page
    ? "Reading the page…"
    : picking
      ? hovered
        ? `Pointing at ${roleWord(hovered)} “${nodeLabel(hovered, 60)}”. Click to choose it.`
        : "Point at the page and click an element, or search below. Escape stops."
      : "Choose a control or some content. Detour times the trip, no AI involved.";

  return (
    <div>
      <button
        type="button"
        className={`btn btn-sm w-full ${picking ? "!border-ink !bg-lime" : ""}`}
        aria-pressed={picking}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) onPicking(!picking);
        }}
      >
        Pick on the page
      </button>
      <p className="mt-1.5 text-xs leading-4 text-muted">{hint}</p>
      {picking && <TargetCombobox options={options} disabled={disabled} onChoose={onChoose} onActive={onActive} />}
      <p role="status" aria-live="polite" className="mt-2 text-xs font-medium leading-4 empty:hidden">
        {message}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {page ? "The page is read. You can choose a target." : ""}
      </p>
    </div>
  );
}

function TargetCombobox({
  options,
  disabled,
  onChoose,
  onActive,
}: {
  options: ReturnType<typeof pickOptions>;
  disabled: boolean;
  onChoose: (nodeId: NodeId) => void;
  onActive: (nodeId: NodeId | null) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  const { shown, total } = useMemo(() => filterOptions(options, query, MAX_SHOWN), [options, query]);
  const activeOption = open && active >= 0 ? shown[active] : undefined;
  const activeId = activeOption?.id ?? null;

  // Outline the option under the cursor on the page. Leaving the list clears it.
  useEffect(() => {
    onActive(activeId);
  }, [activeId, onActive]);
  useEffect(() => () => onActive(null), [onActive]);

  // Keep the active option in view inside the scrolling list.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[id="${id}-o${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  function choose(i: number) {
    const o = shown[i];
    if (!o) return;
    setOpen(false);
    setActive(-1);
    setQuery("");
    onChoose(o.id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(shown.length ? 0 : -1);
      } else if (shown.length) setActive((a) => (a + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(shown.length ? shown.length - 1 : -1);
      } else if (shown.length) setActive((a) => (a <= 0 ? shown.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  const none = open && shown.length === 0;
  return (
    <div className="mt-3">
      <label htmlFor={`${id}-in`} className="block text-xs font-medium leading-4">
        Search the page’s controls and headings
      </label>
      <input
        id={`${id}-in`}
        type="text"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-o${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        placeholder={disabled ? "Available once the page is read" : "For example: contact, search"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        className="mt-1 h-9 w-full rounded-md border border-rule-strong bg-surface px-3 text-sm placeholder:text-muted disabled:cursor-not-allowed disabled:bg-paper-2"
      />
      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label="Matching elements"
        hidden={!open || shown.length === 0}
        // Keep focus in the input: pressing an option or the scrollbar must not blur (and so close) the list first.
        onMouseDown={(e) => e.preventDefault()}
        className="mt-1 max-h-48 overflow-auto rounded-md border border-rule-strong bg-surface"
      >
        {shown.map((o, i) => (
          <li
            key={o.id}
            id={`${id}-o${i}`}
            role="option"
            aria-selected={i === active}
            onClick={() => choose(i)}
            onMouseMove={() => i !== active && setActive(i)}
            className={`cursor-pointer px-3 py-1.5 text-sm leading-5 ${i === active ? "bg-lime" : "hover:bg-paper-2"}`}
          >
            <span className="block text-xs leading-4 text-muted">{o.role}</span>
            <span className="block [overflow-wrap:anywhere]">
              <span className="font-medium">{o.name}</span>
              {o.where && <span className="text-xs text-muted"> in {o.where}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className={none ? "mt-1.5 text-xs text-muted" : "sr-only"}>
        {!open
          ? ""
          : none
            ? "No controls or headings match."
            : total > shown.length
              ? `${total} matches, showing the first ${shown.length}. Type more to narrow them.`
              : `${total} ${total === 1 ? "match" : "matches"}.`}
      </p>
    </div>
  );
}
