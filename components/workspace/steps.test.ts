import { describe, expect, it } from "vitest";
import { currentStep, primaryAction, stepStates, type StepFacts } from "./steps";

const base: StepFacts = { step: "race", hasResult: true, plan: "idle", fixes: 0, canFix: true, run: null };
const facts = (over: Partial<StepFacts>): StepFacts => ({ ...base, ...over });
const label = (f: StepFacts) => primaryAction(f)?.label ?? null;

describe("step rail", () => {
  it("opens each step only when the one before it has produced something", () => {
    const ready = (f: StepFacts) => stepStates(f).map((s) => s.ready);
    expect(ready(facts({ hasResult: false }))).toEqual([true, false, false, false]);
    expect(ready(facts({}))).toEqual([true, true, false, false]);
    expect(ready(facts({ plan: "ready", fixes: 3 }))).toEqual([true, true, true, false]);
    expect(ready(facts({ plan: "ready", fixes: 3, run: "done" }))).toEqual([true, true, true, true]);
  });

  it("falls back to the race when the chosen step cannot be opened", () => {
    expect(currentStep(facts({ step: "fix" }))).toBe("race");
    expect(currentStep(facts({ step: "plan" }))).toBe("plan");
  });

  it("offers one primary action per step, following the spec", () => {
    expect(label(facts({ hasResult: false }))).toBeNull();
    expect(label(facts({}))).toBe("Plan fixes");
    expect(label(facts({ step: "plan" }))).toBe("Plan fixes");
    expect(label(facts({ step: "plan", plan: "error" }))).toBe("Plan fixes");
    expect(label(facts({ step: "plan", plan: "loading" }))).toBe("Planning…");
    expect(primaryAction(facts({ step: "plan", plan: "loading" }))?.disabled).toBe(true);
    expect(label(facts({ step: "plan", plan: "ready", fixes: 3 }))).toBe("Fix this page");
    expect(label(facts({ step: "fix", plan: "ready", fixes: 3, run: "running" }))).toBe("Fixing…");
    expect(label(facts({ step: "fix", plan: "ready", fixes: 3, run: "done" }))).toBe("See the re-check");
    expect(label(facts({ step: "recheck", plan: "ready", fixes: 3, run: "done" }))).toBeNull();
  });

  it("never offers 'Fix this page' and 'Fix again' together, and never offers a fix that cannot run", () => {
    const labels = new Set<string>();
    for (const step of ["race", "plan", "fix", "recheck"] as const)
      for (const run of [null, "running", "done", "error"] as const)
        for (const canFix of [true, false])
          labels.add(`${step}/${run}/${canFix}:${label(facts({ step, plan: "ready", fixes: 3, run, canFix })) ?? "-"}`);
    expect([...labels].some((l) => l.endsWith("Fix again"))).toBe(false); // the Fix panel owns it
    expect(label(facts({ step: "plan", plan: "ready", fixes: 3, canFix: false }))).toBe("Plan again");
    expect(label(facts({ step: "plan", plan: "ready", fixes: 0 }))).toBe("Plan again");
    expect(label(facts({ step: "plan", plan: "ready", fixes: 3, run: "done" }))).toBe("Plan again");
  });
});
