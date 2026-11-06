import { CheckIcon } from "@/components/icons";
import type { SearchEstimate } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { fmtProb, insightRows, insightSentence } from "@/lib/ui/search-insight";

/** Screen-reader users rarely know which heading holds the answer. This shows what guessing costs. */
export function SearchInsight({ search, taskLabel, idBase = "search", context }: { search: SearchEstimate; taskLabel: string; idBase?: string; context?: string }) {
  const { rows, hidden } = insightRows(search);
  const sentence = insightSentence(search);
  return (
    <section aria-labelledby={`${idBase}-h`} className="card p-5 sm:p-6">
      <p className="eyebrow">Realistic search</p>
      <h2 id={`${idBase}-h`} className="h-card mt-1.5">
        Knowing where to go versus finding it
      </h2>
      <p className="mt-1 text-sm text-muted">
        {context ?? "For"} “{taskLabel}”, a screen-reader user who jumps by headings has to judge each heading by its words.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rule bg-paper-2 p-3.5">
          <dt className="text-sm font-semibold text-muted">Best case (knows where to go)</dt>
          <dd className="tnum mt-1 font-serif text-3xl font-bold leading-none">{fmtSeconds(search.shortestSeconds)}</dd>
        </div>
        <div className="rounded-xl border-2 border-ink bg-lime/40 p-3.5">
          <dt className="text-sm font-semibold">Realistic search by headings</dt>
          <dd className="tnum mt-1 font-serif text-3xl font-bold leading-none">{fmtSeconds(search.seconds)}</dd>
        </div>
      </dl>

      {sentence && (
        <p className="mt-4 border-l-2 border-ink pl-3 text-[0.9375rem] leading-relaxed">
          {sentence} They open {search.expectedWrongSections.toFixed(1)} wrong section{Math.abs(search.expectedWrongSections - 1) < 0.05 ? "" : "s"} on the way.
        </p>
      )}

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">
          Headings on the page, how well each heading’s words match the task, and the chance a listener opens that section on the first pass
        </caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 pr-2 font-semibold">Heading</th>
            <th scope="col" className="py-1 pr-2 font-semibold">Scent</th>
            <th scope="col" className="py-1 text-right font-semibold">Chance they open it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.nodeId} className={`border-t border-rule/70 ${h.containsTarget ? "bg-lime/30" : ""}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                {h.label || "(empty heading)"}
                {h.containsTarget && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-lime px-1.5 py-px align-middle text-[0.6875rem] font-bold">
                    <CheckIcon size={11} /> holds the answer
                  </span>
                )}
              </th>
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-paper-2">
                    <span className="pattern-screenreader block h-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, h.scent)) * 100)}%` }} />
                  </span>
                  <span className="tnum">{h.scent.toFixed(2)}</span>
                </span>
              </td>
              <td className="tnum py-1.5 text-right">{fmtProb(h.pEnter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <p className="mt-1.5 text-xs text-muted">{hidden} more headings with weaker scent are not listed.</p>}
      <p className="mt-2 text-xs text-muted">
        Scent is how well a heading’s words overlap with the task (stemmed words plus a small synonym table; no language model involved). The chance of opening a section rises steeply with
        scent. The model is an information-foraging chain (Pirolli and Card; Fu and Pirolli), with the thresholds set as modelling assumptions.
      </p>
    </section>
  );
}
