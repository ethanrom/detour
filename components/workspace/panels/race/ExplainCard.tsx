"use client";

import { PersonaIcon } from "@/components/icons";
import type { PersonaId, SearchEstimate, TaskResult } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { PERSONA_BY_ID, STRATEGY_LABEL } from "@/lib/ui/personas";
import { fmtProb, insightSentence } from "@/lib/ui/search-insight";
import { Capped, Chip, Disclosure } from "../../ui";
import { CARD_SCROLL, RaceCard } from "./Card";

const PREFIXES: Array<[RegExp, PersonaId]> = [
  [/^Mouse:\s*/, "mouse"],
  [/^Keyboard:\s*/, "keyboard"],
  [/^Screen reader:\s*/, "screenreader"],
];

/** An explanation sentence, with the persona it starts with ("Keyboard: ...") named in that persona's colour. */
function Sentence({ text }: { text: string }) {
  for (const [re, persona] of PREFIXES) {
    if (re.test(text)) {
      const meta = PERSONA_BY_ID[persona];
      return (
        <>
          <span className="mr-1.5 inline-flex items-center gap-1 align-middle font-semibold" style={{ color: meta.color }}>
            <PersonaIcon persona={persona} size={14} />
            {meta.label}
          </span>
          {text.replace(re, "")}
        </>
      );
    }
  }
  return <>{text}</>;
}

/** The screen-reader strategies, their share of users and their time (the table of the old "Where the seconds go"). */
function StrategyMix({ result }: { result: TaskResult }) {
  const sr = result.personas.screenreader;
  const rows = [...sr.strategies].sort((a, b) => (sr.weights[b.strategy] ?? 0) - (sr.weights[a.strategy] ?? 0));
  return (
    <>
      <p className="text-xs leading-4 text-muted">
        The prediction weighs each way people navigate. Strategies that cannot finish are left out and the rest renormalised.
      </p>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">Screen-reader strategies, their share of users and their time for this task</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 pr-2 font-medium">Strategy</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">Share</th>
            <th scope="col" className="py-1 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const w = sr.weights[s.strategy] ?? 0;
            return (
              <tr key={s.strategy} className="border-t border-rule">
                <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                  {STRATEGY_LABEL[s.strategy]}
                  {s.strategy === sr.representative && <span className="ml-1.5 rounded bg-lime px-1.5 py-0.5 text-xs font-medium">animated</span>}
                </th>
                <td className="py-1.5 pr-2">
                  <span className="flex items-center justify-end gap-2">
                    <span aria-hidden="true" className="h-2 w-12 overflow-hidden rounded-full bg-paper-2">
                      <span className="pattern-screenreader block h-full" style={{ width: `${Math.round(w * 100)}%` }} />
                    </span>
                    <span className="tnum w-9 text-right">{Math.round(w * 100)}%</span>
                  </span>
                </td>
                <td className="tnum py-1.5 text-right">{s.blocked ? "Can’t finish" : fmtSeconds(s.seconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** The answer's heading first, then the most likely to be opened, then the rest in the order of the page. */
function headingsByInterest(search: SearchEstimate): SearchEstimate["perHeading"] {
  return [...search.perHeading].sort((a, b) => Number(b.containsTarget) - Number(a.containsTarget) || b.pEnter - a.pEnter || b.scent - a.scent);
}

/** Screen-reader users rarely know which heading holds the answer: one sentence, and the headings behind it. */
function SearchLine({ search }: { search: SearchEstimate }) {
  const answer = insightSentence(search);
  return (
    <div className="space-y-2">
      <p>
        {answer ? `${answer} ` : ""}
        Searching by headings takes <strong className="tnum">{fmtSeconds(search.seconds)}</strong>, against{" "}
        <strong className="tnum">{fmtSeconds(search.shortestSeconds)}</strong> for someone who knows where to go.
      </p>
      <Disclosure summary="Headings the listener weighs">
        <p className="mb-1 text-xs leading-4 text-muted">
          Scent is how well a heading’s words overlap with the task (stemmed words and a small synonym table, no language model). The chance of opening a
          section rises steeply with scent.
        </p>
        <Capped
          items={headingsByInterest(search)}
          limit={5}
          listLabel="Headings, how well their words match the task, and the chance a listener opens each"
          itemKey={(h) => h.nodeId}
          render={(h) => (
            <div className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {h.label || "(empty heading)"}
                {h.containsTarget && (
                  <>
                    {" "}
                    <Chip>holds the answer</Chip>
                  </>
                )}
              </span>
              <span className="tnum shrink-0 text-right text-xs leading-5 text-muted">
                scent {h.scent.toFixed(2)} · opens {fmtProb(h.pEnter)}
              </span>
            </div>
          )}
        />
      </Disclosure>
    </div>
  );
}

/** "Where the seconds go": what the explanation says, the strategy mix behind it and, when it applies, the heading search. */
export function ExplainCard({ id, result, search }: { id: string; result: TaskResult; search?: SearchEstimate }) {
  return (
    <RaceCard id={id} title="Where the seconds go">
      <div role="region" aria-labelledby={id} tabIndex={0} className={`${CARD_SCROLL} space-y-3 px-3 pb-3 text-sm leading-5`}>
        <ul className="space-y-2">
          {result.explanation.map((s, i) => (
            <li key={i}>
              <Sentence text={s} />
            </li>
          ))}
        </ul>
        <Disclosure summary="Strategy mix">
          <StrategyMix result={result} />
        </Disclosure>
        {search && <SearchLine search={search} />}
      </div>
    </RaceCard>
  );
}
