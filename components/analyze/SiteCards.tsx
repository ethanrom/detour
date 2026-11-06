"use client";

import { CheckIcon } from "@/components/icons";
import type { SiteInfo } from "@/lib/ui/datasource";

interface Props {
  sites: SiteInfo[];
  value: string;
  onChange: (id: string) => void;
}

export function SiteCards({ sites, value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="sr-only">Choose a page to analyze</legend>
      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        {sites.map((s) => {
          const selected = s.id === value;
          return (
            <label key={s.id} className="group relative block cursor-pointer">
              <input
                type="radio"
                name="site"
                value={s.id}
                checked={selected}
                onChange={() => onChange(s.id)}
                className="peer sr-only"
              />
              <span
                className={`card block h-full p-4 transition-[box-shadow,transform,border-color] duration-150 group-hover:border-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-focus-visible:shadow-[0_0_0_6px_var(--lime)] ${
                  selected ? "!border-ink bg-surface shadow-[4px_4px_0_var(--ink)] -translate-y-0.5" : ""
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="eyebrow">
                    {s.kind === "demo" ? "Demo · inaccessible by design" : "Control · well built"}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`grid size-6 place-items-center rounded-full border-2 border-ink ${selected ? "bg-lime" : "bg-transparent"}`}
                  >
                    {selected && <CheckIcon size={14} />}
                  </span>
                </span>
                <span className="mt-2.5 block font-serif text-xl font-bold leading-tight tracking-tight">{s.name}</span>
                <span className="mt-1.5 block text-sm leading-snug text-muted">{s.tagline}</span>
                <span className="mt-3 block text-xs font-semibold text-ink">
                  {s.tasks.length} tasks <span className="font-normal text-muted">· {s.path}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
