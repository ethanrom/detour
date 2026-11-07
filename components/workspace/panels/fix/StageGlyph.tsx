import { CheckIcon } from "@/components/icons";
import type { FixStage } from "@/lib/livefix/types";

/**
 * One 20px glyph for where a fix is: a check (proven), "!" (partly), a cross (couldn't apply) or a ring. No fill,
 * no tinted disc. The state is also written out as a word next to it, so the glyph is decoration.
 */
export function StageGlyph({ stage }: { stage: FixStage }) {
  const box = "grid size-5 place-items-center leading-none";
  if (stage === "proven") {
    return (
      <span aria-hidden="true" className={`${box} text-add-fg`}>
        <CheckIcon size={16} />
      </span>
    );
  }
  if (stage === "partial") {
    return (
      <span aria-hidden="true" className={`${box} text-base font-bold`}>
        !
      </span>
    );
  }
  if (stage === "failed") {
    return (
      <span aria-hidden="true" className={`${box} text-base font-bold`}>
        ✕
      </span>
    );
  }
  // queued is a pale ring; anything in flight (writing, applied, re-reading, trying again) is a dark one.
  return (
    <span aria-hidden="true" className={box}>
      <span className={`block size-3.5 rounded-full border-2 ${stage === "queued" ? "border-rule-strong" : "border-ink"}`} />
    </span>
  );
}
