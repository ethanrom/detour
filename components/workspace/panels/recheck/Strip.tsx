import { CheckIcon, PersonaIcon } from "@/components/icons";
import type { PersonaResult, TaskResult } from "@/lib/contracts";
import { compareTask, type Change, type PersonaDelta } from "@/lib/ui/compare";
import { fmtPercentLess, fmtSeconds, percentLess } from "@/lib/ui/format";
import { PERSONA_BY_ID } from "@/lib/ui/personas";
import { Chip, type ChipTone } from "../../ui";

/** "predicted 4.4 s" / "predicted: can’t finish"; null when the plan said nothing about this person. */
export function predictedText(p: PersonaResult | undefined): string | null {
  if (!p) return null;
  return p.blocked ? "predicted: can’t finish" : `predicted ${fmtSeconds(p.seconds)}`;
}

/** "52 s → 9.2 s", "Can’t finish → 4.4 s", or one value when nothing moved. Read aloud as "… became …". */
export function Headline({ d, small }: { d: PersonaDelta; small?: boolean }) {
  const b = d.before.seconds;
  const a = d.after.seconds;
  const arrow = (
    <>
      <span aria-hidden="true" className="text-muted">
        →
      </span>
      <span className="sr-only"> became </span>
    </>
  );
  const blocked = (size: string) => <span className={`${size} font-semibold text-blocked`}>Can’t finish</span>;
  switch (d.change) {
    case "still-blocked":
      return blocked(small ? "" : "text-xl");
    case "unblocked":
      return (
        <>
          {blocked(small ? "" : "text-sm")} {arrow} <span>{fmtSeconds(a!)}</span>
        </>
      );
    case "newly-blocked":
      return (
        <>
          <span>{fmtSeconds(b!)}</span> {arrow} {blocked(small ? "" : "text-xl")}
        </>
      );
    case "same":
      return d.nearlySame ? (
        <>
          <span>{fmtSeconds(b!)}</span> {arrow} <span>{fmtSeconds(a!)}</span>
        </>
      ) : (
        <span>{fmtSeconds(a!)}</span>
      );
    default:
      return (
        <>
          <span>{fmtSeconds(b!)}</span> {arrow} <span>{fmtSeconds(a!)}</span>
        </>
      );
  }
}

const CHANGE_WORD: Record<Change, string> = {
  faster: "",
  slower: "",
  same: "No change",
  unblocked: "Unblocked",
  "newly-blocked": "Now blocked",
  "still-blocked": "Still blocked",
};

/** What changed for one person, in words: "83% less", "12% slower", "Unblocked", "No change". */
export function changeText(d: PersonaDelta): string {
  if (d.change === "faster") return fmtPercentLess(d.before.seconds!, d.after.seconds!);
  if (d.change === "slower") return `${Math.abs(percentLess(d.before.seconds!, d.after.seconds!))}% slower`;
  if (d.change === "same" && d.nearlySame) return "About the same";
  return CHANGE_WORD[d.change];
}

/** The one chip under a column. Green is for gains only. */
function ChangeChip({ d }: { d: PersonaDelta }) {
  const tone: ChipTone = d.change === "faster" || d.change === "unblocked" ? "proven" : d.change === "newly-blocked" || d.change === "still-blocked" ? "blocked" : "neutral";
  return (
    <Chip tone={tone}>
      {tone === "proven" && <CheckIcon size={12} />}
      {changeText(d)}
    </Chip>
  );
}

/** Three columns, one per person: before → after at 28px, the plan's prediction in grey, and what changed. */
export function Strip({ before, after, predicted }: { before: TaskResult; after: TaskResult; predicted?: TaskResult }) {
  const deltas = compareTask(before, after);
  return (
    <div role="group" aria-label="Before and after, per person" className="@container overflow-hidden rounded-lg border border-rule">
      <div className="grid grid-cols-3 divide-x divide-rule">
        {deltas.map((d) => {
          const meta = PERSONA_BY_ID[d.persona];
          const pred = predictedText(predicted?.personas[d.persona]);
          return (
            <div key={d.persona} className="row-span-4 grid min-w-0 grid-rows-subgrid p-3">
              <div>
                <Chip tone={d.persona}>
                  <PersonaIcon persona={d.persona} size={12} />
                  {meta.label}
                </Chip>
              </div>
              <p className="tnum mt-2 flex flex-wrap items-baseline gap-x-1.5 text-xl font-semibold leading-8 @min-[36rem]:text-[1.75rem]">
                <Headline d={d} />
              </p>
              <p className="tnum mt-0.5 min-h-4 text-xs leading-4 text-muted">{pred}</p>
              <div className="mt-2">
                <ChangeChip d={d} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
