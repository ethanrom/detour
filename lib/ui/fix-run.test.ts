import { describe, expect, it } from "vitest";
import type { FixOutcome, LayoutReport, TaskCheck } from "@/lib/livefix/types";
import type { RepairReport } from "@/lib/repair/types";
import {
  announceFor,
  buildWordingEdits,
  chipSentence,
  displaySelector,
  finishRun,
  layoutSentence,
  personaChips,
  reduceEvent,
  startRun,
  summarize,
  tidyHtml,
} from "./fix-run";

const outcome = (fixId: string, stage: FixOutcome["stage"], extra: Partial<FixOutcome> = {}): FixOutcome => ({ fixId, title: `Fix ${fixId}`, stage, attempts: 1, ...extra });

describe("buildWordingEdits", () => {
  it("takes accepted headings and every label", () => {
    const report: RepairReport = {
      promoted: false,
      headings: [
        { nodeId: "h1", original: "Details", proposed: "Jacket specs", source: "llm", before: 5, after: 3, savedSeconds: 2, accepted: true },
        { nodeId: "h2", original: "More", proposed: "Other", source: "llm", before: 5, after: 6, savedSeconds: -1, accepted: false },
      ],
      labels: [{ nodeId: "b1", proposed: "Add to wishlist", source: "llm" }],
    };
    expect(buildWordingEdits(report)).toEqual([
      { fixId: "wording:heading:h1", nodeId: "h1", kind: "heading", text: "Jacket specs", original: "Details" },
      { fixId: "wording:label:b1", nodeId: "b1", kind: "label", text: "Add to wishlist", original: "" },
    ]);
    expect(buildWordingEdits(null)).toEqual([]);
  });
});

describe("run state", () => {
  it("counts plan fixes and wording apart, and speaks only when a fix settles", () => {
    let s = startRun(["a", "b"], [{ fixId: "wording:label:x", nodeId: "x", kind: "label", text: "Name", original: "" }]);
    expect(s.ids).toEqual(["a", "b", "wording:label:x"]);
    s = reduceEvent(s, { type: "stage", outcome: outcome("a", "writing") });
    expect(s.announce).toContain("Fixing the page");
    s = reduceEvent(s, { type: "stage", outcome: outcome("a", "proven") });
    expect(s.announce).toBe("Fix a: proven");
    s = reduceEvent(s, { type: "stage", outcome: outcome("b", "failed") });
    s = reduceEvent(s, { type: "stage", outcome: outcome("wording:label:x", "proven") });
    expect(summarize(s)).toEqual({ proven: 1, total: 2, wordingKept: 1, wordingTotal: 1 });
    expect(announceFor(outcome("a", "proven"), outcome("a", "proven"))).toBeNull();
    const done = finishRun(s, { fixes: [], checks: [], results: [], page: {} as never, proven: 2, total: 3 });
    expect(done.status).toBe("done");
    expect(done.announce).toBe("Finished. Proven: 1 of 2.");
  });
});

describe("sentences", () => {
  const layout = (moved: number): LayoutReport => ({
    checked: 412,
    moved: Array.from({ length: moved }, (_, i) => ({ selector: `.m${i}`, dx: 0, dy: 3 })),
    docHeightBefore: 1000,
    docHeightAfter: 1000,
  });
  it("says which elements kept their place or moved", () => {
    expect(layoutSentence(layout(0))).toBe("412 elements kept their place");
    expect(layoutSentence(layout(2))).toBe("2 of 412 elements moved");
    expect(layoutSentence(undefined)).toBe("The layout was not compared");
  });

  it("strips Detour's bookkeeping from markup and names an element by its own selector", () => {
    expect(tidyHtml('<div data-detour-id="n12" data-detour-pin="3" class="x">a</div>')).toBe('<div class="x">a</div>');
    const page = { nodes: { n12: { selector: "#size-m" } } } as never;
    expect(displaySelector('[data-detour-id="n12"]', page)).toBe("#size-m");
    expect(displaySelector("body", page)).toBe("body");
  });
});

describe("personaChips", () => {
  const check = (before: TaskCheck["before"], predicted: TaskCheck["predicted"], measured: TaskCheck["measured"]): TaskCheck => ({ taskId: "t", before, predicted, measured });

  it("shows only the people a fix touched, with the re-checked and the predicted seconds", () => {
    const chips = personaChips([check({ mouse: 5, keyboard: null, screenreader: 17 }, { mouse: 5, keyboard: 4.4, screenreader: 17 }, { mouse: 5, keyboard: 4.4, screenreader: 17 })], undefined);
    expect(chips.map(chipSentence)).toEqual(["Keyboard: can’t finish → 4.4 s (predicted 4.4 s)"]);
  });

  it("compares with the fix before, and flags a person the page did not help even when the plan said so", () => {
    const prev = [check({ keyboard: null, screenreader: 17 }, { keyboard: 4.4, screenreader: 17 }, { keyboard: 4.4, screenreader: 17 })];
    const now = [check({ keyboard: null, screenreader: 17 }, { keyboard: 4.4, screenreader: 9 }, { keyboard: 4.4, screenreader: 16 })];
    expect(personaChips(now, prev).map(chipSentence)).toEqual(["Screen reader: 17 s → 16 s (predicted 9 s)"]);
  });
});
