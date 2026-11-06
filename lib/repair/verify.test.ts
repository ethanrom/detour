import { beforeAll, describe, expect, it } from "vitest";
import { SITES } from "@/fixtures/tasks";
import type { PageModel } from "@/lib/contracts";
import { isAccepted, MIN_SAVED_SECONDS, verifyRename } from "./verify";
import { loadSite, promoteAll } from "./testing";

let riverside: PageModel;
const tasks = SITES.find((s) => s.id === "riverside")!.tasks;

beforeAll(async () => {
  riverside = promoteAll(await loadSite("riverside"));
}, 60_000);

describe("verifyRename on the real riverside page", () => {
  it("accepts 'More information' -> 'Income limits': the income task gets much faster", () => {
    const v = verifyRename(riverside, tasks, "income-title", "Income limits");
    if (process.env.REPAIR_VERBOSE) console.log("income-title", v.before.toFixed(1), "->", v.after.toFixed(1), "saved", v.savedSeconds.toFixed(1), v.perTask.map((t) => `${t.taskId} ${t.before.toFixed(1)}->${t.after.toFixed(1)}`).join("; "));
    expect(v.savedSeconds).toBeGreaterThan(30);
    expect(v.after).toBeCloseTo(v.before - v.savedSeconds, 9);
    expect(isAccepted(v)).toBe(true);
    const income = v.perTask.find((t) => t.taskId === "income-3")!;
    expect(income.savedSeconds).toBeGreaterThan(30);
    expect(v.perTask.find((t) => t.taskId === "spanish")!.savedSeconds).toBeCloseTo(0, 6);
    expect(riverside.nodes["income-title"].name).toBe("More information"); // input page untouched
  });

  it("rejects a rename that adds no scent ('Section') and one that renames the wrong heading", () => {
    const bad = verifyRename(riverside, tasks, "income-title", "Section");
    expect(bad.savedSeconds).toBeLessThanOrEqual(MIN_SAVED_SECONDS);
    expect(isAccepted(bad)).toBe(false);
    const wrongSection = verifyRename(riverside, tasks, "faq-title", "Income limits");
    expect(isAccepted(wrongSection)).toBe(false);
  });

  it("refuses to verify a node that is not a heading", () => {
    expect(() => verifyRename(riverside, tasks, "income-intro", "Income limits")).toThrow(RangeError);
  });
});
