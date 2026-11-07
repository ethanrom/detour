import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FixSpec } from "@/lib/contracts";
import type { ExportMeta } from "@/lib/livefix/export";
import type { FixOutcome, WordingEdit } from "@/lib/livefix/types";
import { mockDataSource } from "@/lib/ui/mock-datasource";
import type { PlanOutcome } from "@/lib/ui/datasource";
import { finishRun, reduceEvent, startRun } from "@/lib/ui/fix-run";
import type { FixPanelProps } from "../contract";
import { ChangeDrawer } from "./ChangeDrawer";
import { FixPanel } from "./FixPanel";
import { RecheckPanel } from "./RecheckPanel";

const meta: ExportMeta = { url: "https://example.test/", title: "Example" };
const noop = () => undefined;

const outcome = (fixId: string, extra: Partial<FixOutcome> = {}): FixOutcome => ({
  fixId,
  title: `Fix ${fixId}`,
  stage: "proven",
  attempts: 1,
  edits: { fixId, edits: [], note: "Add aria-label.", source: "recorded" },
  originals: { "#a": "<a></a>" },
  applied: { "#a": '<a aria-label="Search"></a>' },
  ...extra,
});

const spec = (id: string): FixSpec => ({ id, title: `Fix ${id}`, kind: "label", wcag: ["4.1.2 Name, Role, Value"], rationale: "Why." }) as unknown as FixSpec;

function finishedRun(wordingCount: number) {
  const wording: WordingEdit[] = Array.from({ length: wordingCount }, (_, i) => ({ fixId: `wording:label:n${i}`, nodeId: `n${i}`, kind: "label", text: `Name ${i}`, original: "" }));
  let run = startRun(["a", "b"], wording);
  for (const id of run.ids) run = reduceEvent(run, { type: "stage", outcome: outcome(id, id === "b" ? { stage: "partial", reason: "Still slow." } : {}) });
  return finishRun(run, { fixes: [], checks: [], results: [], page: {} as never, proven: 1, total: 2 });
}

const planOutcome = { plan: { chosen: [spec("a"), spec("b")] } } as unknown as PlanOutcome;

function fixMarkup(over: Partial<FixPanelProps>) {
  return renderToStaticMarkup(
    <FixPanel headingRef={createRef()} available outcome={planOutcome} run={null} page={null} tasks={[]} meta={meta} onFixAgain={noop} onView={noop} {...over} />,
  );
}

describe("FixPanel", () => {
  it("keeps 16 wording edits to one collapsed row of five, and every fix gets a named View change", () => {
    const html = fixMarkup({ run: finishedRun(16) });
    expect(html).toContain('aria-label="Fix results"');
    expect(html).toContain("1 of 2 proven");
    expect(html).toContain('aria-label="Fix progress"');
    expect(html).toContain("16 verified wording edits");
    expect(html.match(/<li/g)?.length).toBe(2 + 5); // two fixes and the first five wording edits
    expect(html).toContain("Show all 16");
    expect(html).toContain('aria-label="View change: Fix a"');
    expect(html).toContain("Fix again");
    expect(html).not.toContain("Code change for"); // diffs live in the drawer
  });

  it("says what to do without a run, and why it cannot on sample data", () => {
    expect(fixMarkup({})).toContain("Fix this page runs one AI agent per planned fix on this page, then re-checks it.");
    expect(fixMarkup({ available: false })).toContain("Fixing needs the live page.");
    expect(fixMarkup({ run: startRun(["a"], []) })).not.toContain("Fix again");
  });
});

describe("ChangeDrawer", () => {
  it("shows at most three edited places, then offers the rest", () => {
    const applied = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`#e${i}`, `<b>${i}</b>`]));
    const originals = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`#e${i}`, `<i>${i}</i>`]));
    const html = renderToStaticMarkup(
      <ChangeDrawer open={false} onClose={noop} fix={spec("a")} outcome={outcome("a", { applied, originals })} page={null} />,
    );
    expect(html).toContain("Change: Fix a");
    expect(html.match(/Code change for/g)?.length).toBe(3);
    expect(html).toContain("Show 2 more");
    expect(html).toContain("For the site owner:");
  });
});

describe("RecheckPanel", () => {
  it("asks for a fix first, then shows the re-check on the same three people", async () => {
    const [site] = await mockDataSource.listSites();
    const analysis = await mockDataSource.analyze(site, null);
    const plan = await mockDataSource.plan(site, analysis, 3);
    const props = { headingRef: createRef<HTMLHeadingElement>(), tasks: site.tasks, before: analysis.results, predicted: plan.results, taskId: site.tasks[0].id, onTask: noop, runKey: 1, hideInsight: () => true };

    const empty = renderToStaticMarkup(<RecheckPanel {...props} after={null} />);
    expect(empty).toContain("Same task, same three people, fewer seconds");
    expect(empty).toContain("Fix the page first. The re-check runs on the fixed page.");

    const html = renderToStaticMarkup(<RecheckPanel {...props} after={plan.results} />);
    expect(html).toContain("Re-checked on the fixed page. Predicted seconds are shown in grey.");
    expect(html).toContain("Every task, before and after");
    expect(html).toContain("predicted");
    // Sentences do not fit a segmented control: a select instead. Short names do fit.
    expect(html).toContain("<select");
    const short = site.tasks.map((t, i) => ({ ...t, label: ["Cart", "Return", "Pay"][i] ?? "Task" }));
    expect(renderToStaticMarkup(<RecheckPanel {...props} tasks={short} after={plan.results} />)).toContain('role="radiogroup"');
  });
});
