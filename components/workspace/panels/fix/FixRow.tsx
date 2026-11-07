import { Bars, Row } from "@/components/workspace/ui";
import type { FixOutcome } from "@/lib/livefix/types";
import { SOURCE_NOTE, STAGE_WORD, elapsedText, isSettled, type ChipView } from "@/lib/ui/fix-run";
import { ReCheckedChips } from "./ReCheckedChips";
import { StageGlyph } from "./StageGlyph";
import { ViewChangeButton } from "./ViewChangeButton";

/** One planned fix while the page is being fixed, and after: the stage in words, who wrote the edit, what was re-checked. */
export function FixRow({ title, outcome, chips, manyTasks, labels, onView }: {
  title: string;
  /** Latest outcome of this fix; absent until its first stage event arrives (it then reads "Waiting"). */
  outcome?: FixOutcome;
  chips: ChipView[];
  manyTasks: boolean;
  labels: Record<string, string>;
  onView: () => void;
}) {
  const stage = outcome?.stage ?? "queued";
  const settled = isSettled(stage);
  const failed = stage === "failed";
  const elapsed = elapsedText(outcome);
  const source = outcome?.edits?.source;
  // There is something to look at once an edit has arrived.
  const canView = !!outcome && (!!outcome.edits || Object.keys(outcome.applied ?? {}).length > 0);

  return (
    <Row
      lead={<StageGlyph stage={stage} />}
      title={title}
      meta={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="sr-only">Fix state: </span>
          <span className={settled ? "font-medium text-ink" : undefined}>{STAGE_WORD[stage]}</span>
          {elapsed && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tnum">{elapsed}</span>
            </>
          )}
          {source && (
            <>
              <span aria-hidden="true">·</span>
              <span>{SOURCE_NOTE[source]}</span>
            </>
          )}
        </span>
      }
      trail={canView ? <ViewChangeButton title={title} onClick={onView} /> : undefined}
    >
      {(stage === "partial" || failed) && outcome?.reason && (
        <p className="mb-1.5 line-clamp-2 text-xs leading-4 text-muted">
          <span className="font-semibold text-ink">Why: </span>
          {outcome.reason}
        </p>
      )}
      {chips.length > 0 ? (
        <ReCheckedChips chips={chips} manyTasks={manyTasks} labels={labels} />
      ) : settled ? (
        !failed && <p className="text-xs leading-4 text-muted">No change in seconds for these tasks.</p>
      ) : (
        // Where the chips will land: a flat grey bar in a 22px line, the height of one chip.
        <div className="flex h-[22px] items-center">
          <Bars widths={["70%"]} className="w-full" />
        </div>
      )}
    </Row>
  );
}
