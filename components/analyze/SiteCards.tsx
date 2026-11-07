"use client";

import type { SiteInfo } from "@/lib/ui/datasource";
import { RadioMark } from "./RadioMark";
import { UrlCard } from "./UrlCard";

interface Props {
  sites: SiteInfo[];
  value: string;
  onChange: (id: string) => void;
  /** A public page the proxy accepted: add it as a site and select it. */
  onAddUrl: (site: SiteInfo) => void;
}

export function SiteCards({ sites, value, onChange, onAddUrl }: Props) {
  const fixed = sites.filter((s) => s.kind !== "url");
  const urlSite = sites.find((s) => s.kind === "url");
  return (
    <fieldset>
      <legend className="sr-only">Choose a page to analyze</legend>
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
        {fixed.map((s) => {
          const selected = s.id === value;
          return (
            <label key={s.id} className="group relative flex cursor-pointer">
              <input
                type="radio"
                name="site"
                value={s.id}
                checked={selected}
                onChange={() => onChange(s.id)}
                className="peer sr-only"
              />
              <span
                className={`card flex w-full flex-col p-4 transition-colors group-hover:border-rule-strong peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                  selected ? "!border-ink !bg-lime" : ""
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[1.0625rem] font-semibold leading-snug">{s.name}</span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">
                      {s.kind === "demo" ? "Demo · inaccessible by design" : "Control · well built"}
                    </span>
                  </span>
                  <RadioMark selected={selected} />
                </span>
                <span className="mt-2.5 block text-sm leading-snug text-ink-2">{s.tagline}</span>
                <span className="mt-auto block pt-3 text-[0.8125rem] text-muted">
                  <span className="tnum font-medium text-ink">{s.tasks.length}</span> tasks · {s.path}
                </span>
              </span>
            </label>
          );
        })}
        <UrlCard urlSite={urlSite} selected={!!urlSite && urlSite.id === value} onSelect={onChange} onAdd={onAddUrl} />
      </div>
    </fieldset>
  );
}
