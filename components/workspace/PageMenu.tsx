"use client";

// The "Change page" popover: the demo pages as a radio group, and any public address. Escape closes it, a click or
// focus outside closes it, and focus goes back to the button that opened it.

import { useEffect, useId, useRef, type FormEvent, type RefObject } from "react";
import type { SiteInfo } from "@/lib/ui/datasource";
import type { AddressState } from "./useWorkbench";

interface Props {
  sites: SiteInfo[];
  siteId: string;
  /** Where focus lands: the selected page, or the address field (the #url link). */
  focus: "pages" | "field";
  address: AddressState;
  onAddress: (text: string) => void;
  onSubmitAddress: () => void;
  onChoose: (id: string) => void;
  /** Close; `restoreFocus` returns focus to the button (not when the user went elsewhere on purpose). */
  onClose: (restoreFocus: boolean) => void;
  /** The dialog's id (the button's aria-controls). */
  id: string;
  /** The button that opened it: clicks and focus on it are not "outside". */
  anchorRef: RefObject<HTMLElement | null>;
}

export function PageMenu({ id: menuId, sites, siteId, focus, address, onAddress, onSubmitAddress, onChoose, onClose, anchorRef }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const checking = address.status === "checking";
  const error = address.status === "error" ? address.message : "";

  useEffect(() => {
    if (focus === "field") field.current?.focus();
    else (root.current?.querySelector<HTMLElement>("input[type=radio]:checked") ?? root.current?.querySelector<HTMLElement>("input"))?.focus();
  }, [focus]);

  // A press anywhere outside the menu and its button closes it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !anchorRef.current?.contains(t)) onClose(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose, anchorRef]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!checking) onSubmitAddress();
  }

  return (
    <div
      ref={root}
      id={menuId}
      role="dialog"
      aria-label="Change page"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(true);
        }
      }}
      onBlur={(e) => {
        // Focus left the menu for somewhere that is not its button: close without stealing focus back.
        const to = e.relatedTarget as Node | null;
        if (to && !root.current?.contains(to) && !anchorRef.current?.contains(to)) onClose(false);
      }}
      className="absolute left-0 top-full z-40 mt-2 w-[22.5rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-rule bg-surface p-4 shadow-xl max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:w-auto"
    >
      <div role="radiogroup" aria-label="Choose a page to analyze" className="-mx-2 space-y-0.5">
        {sites.map((s) => {
          const selected = s.id === siteId;
          return (
            <label
              key={s.id}
              // A mouse or touch choice is done: close. Arrow keys also choose (the page changes at once) but keep the menu open.
              onClick={(e) => {
                if (e.detail > 0) onClose(true);
              }}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-paper-2 ${selected ? "bg-lime hover:bg-lime" : ""}`}
            >
              <input
                type="radio"
                name={`${id}-site`}
                value={s.id}
                checked={selected}
                onChange={() => onChoose(s.id)}
                aria-labelledby={`${id}-${s.id}-n`}
                aria-describedby={`${id}-${s.id}-t`}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
              />
              <span className="min-w-0">
                <span id={`${id}-${s.id}-n`} className="block truncate text-sm font-semibold leading-5">
                  {s.name}
                </span>
                <span id={`${id}-${s.id}-t`} className="block truncate text-xs leading-4 text-muted">
                  {s.tagline}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <form onSubmit={submit} noValidate className="mt-3 border-t border-rule pt-3">
        <label htmlFor={`${id}-url`} className="block text-sm font-semibold leading-5">
          Any public page
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            ref={field}
            id={`${id}-url`}
            type="url"
            inputMode="url"
            name="page-address"
            value={address.text}
            onChange={(e) => onAddress(e.target.value)}
            placeholder="https://www.gov.uk"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={`${id}-note${error ? ` ${id}-err` : ""}`}
            className="h-9 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3 text-sm placeholder:text-muted"
          />
          <button type="submit" className="btn btn-sm shrink-0" aria-busy={checking} aria-disabled={checking}>
            {checking ? "Checking…" : "Analyze"}
          </button>
        </div>
        <p id={`${id}-err`} role={error ? "alert" : undefined} className={error ? "mt-2 text-xs font-medium leading-4 text-blocked" : "hidden"}>
          {error}
        </p>
        <p id={`${id}-note`} className="mt-2 text-xs leading-4 text-muted">
          Pages render without their JavaScript. Server-rendered pages work best.
        </p>
      </form>
    </div>
  );
}
