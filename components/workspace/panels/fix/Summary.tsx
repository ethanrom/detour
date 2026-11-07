import { Bars, Disclosure } from "@/components/workspace/ui";
import { patchText, type ExportMeta } from "@/lib/livefix/export";
import { layoutSentence, movedLines, summarize, wordingSentence, type FixRunState } from "@/lib/ui/fix-run";
import { downloadText } from "./download";

/**
 * The answer first: "3 of 3 proven", whether the layout held, how many wording edits went in, and the two exports.
 * While the run is going the same block says what is happening, with the buttons waiting.
 */
export function Summary({ run, meta, note, onCopy }: {
  run: FixRunState;
  meta: ExportMeta;
  /** The "Report copied" note, shown beside the buttons for a moment. */
  note: string;
  onCopy: () => void;
}) {
  const finished = run.status === "done";
  const s = summarize(run);
  const moved = run.layout && run.layout.moved.length > 0;
  const report = run.report;
  const running = `Fixing ${s.total} fix${s.total === 1 ? "" : "es"}${s.wordingTotal > 0 ? ` and ${s.wordingTotal} wording edit${s.wordingTotal === 1 ? "" : "s"}` : ""} on the page`;

  return (
    <div role="group" aria-label="Fix results" className="rounded-lg border border-rule bg-paper p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {finished ? (
          <p className="tnum text-base font-semibold leading-6">
            {s.proven} of {s.total} proven
          </p>
        ) : (
          <p className="text-base font-semibold leading-6">{running}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!finished || !report}
            onClick={() => report && downloadText("detour-patch.txt", patchText(report, meta))}
          >
            Download patch
          </button>
          <button type="button" className="btn btn-sm" disabled={!finished || !report} onClick={onCopy}>
            Copy report
          </button>
          <span aria-hidden="true" className="text-xs text-muted">
            {note}
          </span>
        </div>
      </div>

      {finished ? (
        <div className="mt-1 text-sm text-muted">
          {moved ? (
            <Disclosure summary={layoutSentence(run.layout)} className="mt-2 bg-surface">
              <ul className="space-y-0.5 font-mono text-xs text-muted">
                {movedLines(run.layout, 5).map((l) => (
                  <li key={l} className="[overflow-wrap:anywhere]">
                    {l}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : (
            <p className="tnum">
              {layoutSentence(run.layout)}
              {s.wordingTotal > 0 && <> · {wordingSentence(s)}</>}
            </p>
          )}
          {moved && s.wordingTotal > 0 && <p className="tnum mt-2">{wordingSentence(s)}</p>}
        </div>
      ) : (
        <Bars widths={["42%"]} className="mt-3" />
      )}
    </div>
  );
}

