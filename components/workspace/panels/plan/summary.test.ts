import { describe, expect, it } from "vitest";
import type { FixImpact } from "@/lib/ui/compare";
import type { RenameStory } from "@/lib/ui/rename-story";
import { fixMeta, impactChips, planSentence, searchStoryLine, wordingCounts } from "./summary";

const impact = (over: Partial<FixImpact>): FixImpact => ({
  fixId: "f",
  objectiveSaved: 0,
  secondsByPersona: { mouse: 0, keyboard: 0, screenreader: 0 },
  seconds: 0,
  unblocked: [],
  ...over,
});

describe("plan words", () => {
  it("builds the one-line summary from the objective", () => {
    const chosen = [{}, {}, {}] as never;
    expect(planSentence({ chosen, baselineObjective: 887.4, plannedObjective: 300.2 })).toBe(
      "3 fixes win back 587 s for keyboard and screen-reader users.",
    );
    expect(planSentence({ chosen: [{}] as never, baselineObjective: 50, plannedObjective: 9 })).toBe("1 fix wins back 41 s for keyboard and screen-reader users.");
  });

  it("shows who a fix unblocks, else the seconds it saves", () => {
    expect(impactChips(impact({ unblocked: [{ taskId: "t", persona: "keyboard" }, { taskId: "u", persona: "keyboard" }] })).map((c) => c.text)).toEqual([
      "Unblocks keyboard",
    ]);
    expect(impactChips(impact({ seconds: 13.2, secondsByPersona: { mouse: 0, keyboard: 0, screenreader: 13.2 } }))[0]).toMatchObject({ tone: "neutral", text: "−13 s" });
    expect(impactChips(impact({}))[0].text).toBe("under 1 s");
  });

  it("writes the meta line with criterion numbers only", () => {
    expect(fixMeta({ kind: "real-button", wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"] })).toBe("Real button · WCAG 2.1.1, 4.1.2");
  });

  it("counts wording and tells the search story only when it moves", () => {
    const report = {
      promoted: false,
      headings: [
        { nodeId: "a", original: "More", proposed: "Income limits", source: "llm", before: 10, after: 5, savedSeconds: 5, accepted: true },
        { nodeId: "b", original: "x", proposed: "y", source: "llm", before: 1, after: 1, savedSeconds: 0, accepted: false },
      ],
      labels: [
        { nodeId: "c", proposed: "Close", source: "fallback" },
        { nodeId: "d", proposed: "Search", source: "fallback" },
      ],
    } as const;
    expect(wordingCounts(report as never)).toBe("1 heading rename, 2 labels");
    const story: RenameStory[] = [{ nodeId: "a", lines: [{ taskId: "t", before: 160, after: 42, best: 16 }] }];
    expect(searchStoryLine(story, "t")).toBe("Screen-reader search 160 s → 42 s");
    expect(searchStoryLine(story, "other")).toBeNull();
    expect(searchStoryLine([{ nodeId: "a", lines: [{ taskId: "t", before: 20, after: 19.8, best: 5 }] }], "t")).toBeNull();
  });
});
