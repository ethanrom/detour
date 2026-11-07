"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { checkUrl, normalizeUrlInput, urlSiteFromCheck } from "@/lib/ui/any-url";
import type { SiteInfo } from "@/lib/ui/datasource";
import { RadioMark } from "./RadioMark";

interface Props {
  /** The page added through this card, if any. */
  urlSite?: SiteInfo;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The proxy accepted the address. */
  onAdd: (site: SiteInfo) => void;
  /** For tests: replaces fetch. */
  fetchImpl?: typeof fetch;
}

type Check = { status: "idle" } | { status: "checking"; url: string } | { status: "error"; message: string };

/** The fourth card of the page chooser: type any public address. The proxy checks it before anything loads. */
export function UrlCard({ urlSite, selected, onSelect, onAdd, fetchImpl }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const [found, setFound] = useState("");
  const checking = check.status === "checking";
  const error = check.status === "error" ? check.message : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;
    const parsed = normalizeUrlInput(text);
    if (!parsed.ok) {
      setCheck({ status: "error", message: parsed.message });
      return;
    }
    setFound("");
    setCheck({ status: "checking", url: parsed.url });
    const result = await checkUrl(parsed.url, fetchImpl);
    if (!result.ok) {
      setCheck({ status: "error", message: result.message });
      return;
    }
    const site = urlSiteFromCheck(result);
    setCheck({ status: "idle" });
    setFound(`Found ${site.name}. Reading the page now.`);
    setText("");
    onAdd(site);
  }

  return (
    <div className={`card p-4 transition-colors ${selected ? "!border-ink !bg-lime" : ""}`}>
      <form onSubmit={submit} noValidate>
        <label htmlFor={`${id}-url`} className="block text-[1.0625rem] font-semibold leading-snug">
          Any public page
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            name="page-address"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (check.status === "error") setCheck({ status: "idle" });
            }}
            placeholder="https://www.gov.uk"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={`${id}-note${error ? ` ${id}-err` : ""}`}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3 text-[0.9375rem] placeholder:text-muted"
          />
          <button type="submit" className="btn shrink-0 px-3" aria-busy={checking} aria-disabled={checking}>
            {checking ? "Checking…" : "Analyze"}
            {!checking && <ArrowRightIcon size={14} />}
          </button>
        </div>
      </form>
      <div role="status" aria-live="polite" id={`${id}-st`} className="sr-only">
        {checking ? "Checking the page…" : found}
      </div>
      <p id={`${id}-err`} role={error ? "alert" : undefined} className={error ? "mt-2.5 rounded-md border border-blocked bg-surface p-2.5 text-sm font-medium text-blocked" : "hidden"}>
        {error}
      </p>
      <p id={`${id}-note`} className="mt-2 text-[0.8125rem] leading-snug text-muted">
        Pages render without their JavaScript. Server-rendered pages work best.
      </p>

      {urlSite && (
        <label className="group relative mt-3 block cursor-pointer border-t border-rule pt-3">
          <input type="radio" name="site" value={urlSite.id} checked={selected} onChange={() => onSelect(urlSite.id)} className="peer sr-only" />
          <span className="flex items-start gap-2.5 rounded-md p-1 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
            <RadioMark selected={selected} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold group-hover:underline">{urlSite.name}</span>
              <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-snug text-muted">{urlSite.tagline}</span>
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
