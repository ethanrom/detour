// DOM side of "Fix this page" for the Analyze screen: put the preview back to the original page, and apply the
// edits of a finished run again, without reloading the iframe. Edits are undone from the journal that
// applyEdits keeps, so the site's own listeners stay attached.

import { applyEdits, restore } from "@/lib/livefix/dom";
import type { FixOutcome } from "@/lib/livefix/types";
import { isKept } from "./fix-run";

/** The iframe's document when it can be read (loaded and same-origin), else null. */
export function frameDocument(frame: HTMLIFrameElement | null | undefined): Document | null {
  try {
    const doc = frame?.contentDocument ?? null;
    return doc?.body ? doc : null;
  } catch {
    return null;
  }
}

/** Undo every fix, last first. Only fixes still applied have a journal, so calling this twice is harmless. */
export function restoreAll(doc: Document, fixIds: readonly string[]): void {
  for (const id of [...fixIds].reverse()) restore(doc, {}, id);
}

/** Apply the kept edits again, in plan order. Returns how many fixes went back on. */
export function reapplyAll(doc: Document, outcomes: ReadonlyArray<FixOutcome | undefined>): number {
  let n = 0;
  for (const o of outcomes) {
    if (!isKept(o) || !o.edits) continue;
    if (applyEdits(doc, o.edits).ok > 0) n++;
  }
  return n;
}
