import { Capped, Disclosure, Row } from "@/components/workspace/ui";
import type { FixStage, WordingEdit } from "@/lib/livefix/types";
import { STAGE_WORD, isSettled, summarize, type FixRunState } from "@/lib/ui/fix-run";
import { StageGlyph } from "./StageGlyph";
import { ViewChangeButton } from "./ViewChangeButton";
import { wordingKinds, wordingTitle } from "./wording";

/**
 * Every verified wording edit of the run as ONE row: "16 verified wording edits · applied". The edits themselves sit
 * behind a disclosure, five at a time, so a page with sixteen of them is no taller than a page with one.
 */
export function WordingRow({ run, onView }: { run: FixRunState; onView: (fixId: string) => void }) {
  const { wordingTotal: total, wordingKept: kept } = summarize(run);
  const finished = run.status === "done";
  const settled = run.wording.filter((w) => isSettled(run.outcomes[w.fixId]?.stage ?? "queued")).length;
  const status = finished ? (kept === total ? "applied" : `${kept} of ${total} applied`) : `${settled} of ${total} applied`;
  const glyph: FixStage = !finished ? "applied" : kept === total ? "proven" : "partial";

  return (
    <Row
      lead={<StageGlyph stage={glyph} />}
      title={
        <>
          {total} verified wording edit{total === 1 ? "" : "s"} <span aria-hidden="true">·</span> {status}
        </>
      }
      meta={`${wordingKinds(run.wording)}. Checked against the page, applied in the same run.`}
    >
      <Disclosure summary="Show the edits">
        <Capped<WordingEdit>
          items={run.wording}
          listLabel="Verified wording edits"
          itemKey={(w) => w.fixId}
          render={(w) => {
            const outcome = run.outcomes[w.fixId];
            const stage = outcome?.stage ?? "queued";
            return (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <span className="text-muted">{w.original ? `“${w.original}”` : "No accessible name"}</span>{" "}
                  <span aria-hidden="true">→</span>
                  <span className="sr-only"> became </span> <span className="font-medium">“{w.text}”</span>
                  {stage !== "proven" && <span className="ml-2 text-xs text-muted">{STAGE_WORD[stage]}</span>}
                </p>
                {outcome && (outcome.edits || Object.keys(outcome.applied ?? {}).length > 0) && (
                  <ViewChangeButton title={wordingTitle(w, outcome)} onClick={() => onView(w.fixId)} />
                )}
              </div>
            );
          }}
        />
      </Disclosure>
    </Row>
  );
}
