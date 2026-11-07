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
      <h2 id={`${idBase}-h`} className="h-card">
        Knowing where to go versus finding it
      </h2>
      <p className="mt-1 text-sm text-muted">
        {context ?? "For"} “{taskLabel}”, a screen-reader user who jumps by headings has to judge each heading by its words.
      </p>

      <dl className="mt-4 grid divide-y divide-rule overflow-hidden rounded-lg border border-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-4">
          <dt className="text-sm text-muted">Best case (knows where to go)</dt>
          <dd className="tnum mt-1 text-[1.75rem] font-semibold leading-none text-ink-2">{fmtSeconds(search.shortestSeconds)}</dd>
        </div>
        <div className="bg-lime p-4">
          <dt className="text-sm font-medium">Realistic search by headings</dt>
          <dd className="tnum mt-1 text-[1.75rem] font-semibold leading-none">{fmtSeconds(search.seconds)}</dd>
        </div>
      </dl>

      {sentence && (
        <p className="mt-4 text-[0.9375rem] leading-relaxed">
          {sentence} They open <span className="tnum">{search.expectedWrongSections.toFixed(1)}</span> wrong section{Math.abs(search.expectedWrongSections - 1) < 0.05 ? "" : "s"} on the way.
        </p>
      )}

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">
          Headings on the page, how well each heading’s words match the task, and the chance a listener opens that section on the first pass
        </caption>
        <thead>
          <tr className="text-left text-[0.8125rem] text-muted">
            <th scope="col" className="py-1.5 pr-2 font-medium">Heading</th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium">Scent</th>
            <th scope="col" className="py-1.5 text-right font-medium">Chance they open it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.nodeId} className={`border-t border-rule ${h.containsTarget ? "bg-lime" : ""}`}>
              <th scope="row" className="py-2 pl-2 pr-2 text-left font-medium">
                {h.label || "(empty heading)"}
                {h.containsTarget && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 align-middle text-[0.8125rem] font-medium">
                    <CheckIcon size={12} /> holds the answer
                  </span>
                )}
              </th>
              <td className="py-2 pr-2">
                <span className="flex items-center justify-end gap-2">
                  <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-paper-2">
                    <span className="pattern-screenreader block h-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, h.scent)) * 100)}%` }} />
                  </span>
                  <span className="tnum w-10 text-right">{h.scent.toFixed(2)}</span>
                </span>
              </td>
              <td className="tnum py-2 pr-2 text-right">{fmtProb(h.pEnter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <p className="mt-1.5 text-[0.8125rem] text-muted">{hidden} more headings with weaker scent are not listed.</p>}
      <p className="mt-2 text-[0.8125rem] text-muted">
        Scent is how well a heading’s words overlap with the task (stemmed words plus a small synonym table; no language model involved). The chance of opening a section rises steeply with
        scent. The model is an information-foraging chain (Pirolli and Card; Fu and Pirolli), with the thresholds set as modelling assumptions.
      </p>
    </section>
  );
}
