import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FixSpec, PageModel, Task } from "@/lib/contracts";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { applyFix, applyFixes, generateCandidates, validatePage } from "./index";
import { deepFreeze } from "./testing";

// ---------------------------------------------------------------------------------------------
// Random pages: nested containers (generic, list, nav, main, footer, aside) over leaves that carry the
// defects the fixes target (fake buttons, unlabeled controls, heading-like text, tabindex).

type LeafType = "paragraph" | "link" | "button" | "heading" | "textbox" | "fake" | "unlabeled" | "fakeHeading";
type BoxType = "generic" | "list" | "nav" | "main" | "footer" | "aside";
type Shape =
  | { kind: "leaf"; type: LeafType; tab: number | null }
  | { kind: "box"; type: BoxType; repetitive: boolean; children: Shape[] };

const leafArb: fc.Arbitrary<Shape> = fc.record({
  kind: fc.constant("leaf" as const),
  type: fc.constantFrom<LeafType>("paragraph", "link", "button", "heading", "textbox", "fake", "unlabeled", "fakeHeading", "fake", "link"),
  tab: fc.constantFrom<number | null>(null, null, null, null, 0, -1, 2, 5),
});

const shapeArb: fc.Arbitrary<Shape> = fc.letrec<{ shape: Shape; box: Shape }>((tie) => ({
  box: fc.record({
    kind: fc.constant("box" as const),
    type: fc.constantFrom<BoxType>("generic", "generic", "list", "nav", "main", "footer", "aside"),
    repetitive: fc.boolean(),
    children: fc.array(tie("shape"), { maxLength: 4 }),
  }),
  shape: fc.oneof({ depthSize: "small", withCrossShrink: true }, leafArb, tie("box")),
})).shape;

const pageArb: fc.Arbitrary<{ page: PageModel; tasks: Task[] }> = fc
  .record({ top: fc.array(shapeArb, { minLength: 1, maxLength: 6 }), taskPick: fc.array(fc.nat(), { maxLength: 3 }) })
  .map(({ top, taskPick }) => {
    let n = 0;
    const leaf = (s: Extract<Shape, { kind: "leaf" }>): Spec => {
      const id = `n${++n}`;
      const name = `Item ${n}`;
      const tabIndex = s.tab;
      switch (s.type) {
        case "paragraph":
          return { id, role: "paragraph", name: `Text ${n}`, tag: "p" };
        case "link":
          return { id, role: "link", name, tag: "a", tabIndex };
        case "button":
          return { id, role: "button", name, tag: "button", tabIndex };
        case "textbox":
          return { id, role: "textbox", name, tag: "input", tabIndex };
        case "heading":
          return { id, role: "heading", level: 1 + (n % 3), name, tag: "h2" };
        case "fake":
          return { id, role: "generic", name, tag: "div", focusable: false, actionable: true, hints: { fakeButton: true } };
        case "unlabeled":
          return { id, role: "button", name: "", tag: "button", hints: { unlabeled: true, visualLabel: n % 2 ? `icon ${n}` : "" } };
        case "fakeHeading":
          return { id, role: "generic", name, tag: "div", hints: { looksLikeHeading: { fontSizeRatio: 1.5, fontWeight: 700, suggestedLevel: (1 + (n % 4)) as 1 | 2 | 3 | 4 } } };
      }
    };
    const box = (s: Extract<Shape, { kind: "box" }>): Spec => {
      const id = `n${++n}`;
      const children = s.children.map(conv);
      const base: Spec = { id, role: "generic", tag: "div", stop: false, children };
      if (s.repetitive) base.hints = { repetitiveBlock: true };
      switch (s.type) {
        case "list":
          return { ...base, role: "list", tag: "ul" };
        case "nav":
          return { ...base, role: "navigation", landmark: "navigation", tag: "nav" };
        case "main":
          return { ...base, role: "main", landmark: "main", tag: "main" };
        case "footer":
          return { ...base, tag: "footer" };
        case "aside":
          return { ...base, role: "complementary", landmark: "complementary", tag: "aside" };
        default:
          return base;
      }
    };
    const conv = (s: Shape): Spec => (s.kind === "leaf" ? leaf(s) : box(s));
    const root: Spec = { id: "root", role: "document", stop: false, children: top.map(conv) };
    const page = buildPage(root);
    const ids = Object.keys(page.nodes).filter((id) => page.nodes[id].children.length === 0 && id !== "root");
    const targets = ids.length ? taskPick.map((p) => ids[p % ids.length]) : [];
    const tasks: Task[] = targets.length ? [{ id: "t", siteId: "s", label: "task", grounding: "fixture", steps: targets.map((target) => ({ target, action: "activate" as const })) }] : [];
    return { page, tasks };
  });

const validPageArb = pageArb.filter(({ page }) => validatePage(page).length === 0);

/** A random sequence of candidates (repeats and any order allowed). */
const sequenceOf = (cands: FixSpec[]) => fc.array(fc.nat({ max: Math.max(0, cands.length - 1) }), { maxLength: 10 }).map((idxs) => (cands.length ? idxs.map((i) => cands[i]) : []));

const runs = { numRuns: 300 };

describe("fix transforms (random pages)", () => {
  it("the generator produces valid pages with a healthy mix of candidates", () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(validPageArb, ({ page, tasks }) => {
        for (const c of generateCandidates(page, tasks)) kinds.add(c.kind);
        return true;
      }),
      runs,
    );
    expect([...kinds].sort()).toEqual(["add-label", "add-landmark", "promote-heading", "real-button", "remove-positive-tabindex", "skip-link"]);
  });

  it("the generator exercises multi-fix sequences often enough to be meaningful", () => {
    const samples = fc.sample(validPageArb, { numRuns: 400, seed: 7 });
    const sizes = samples.map(({ page, tasks }) => generateCandidates(page, tasks).length);
    expect(samples.length).toBe(400);
    expect(sizes.filter((n) => n >= 3).length).toBeGreaterThan(100);
    expect(sizes.filter((n) => n === 0).length).toBeLessThan(200);
  });

  it("candidates are deterministic, uniquely identified and reference existing nodes", () => {
    fc.assert(
      fc.property(validPageArb, ({ page, tasks }) => {
        const a = generateCandidates(page, tasks);
        expect(generateCandidates(structuredClone(page), tasks)).toEqual(a);
        expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
        for (const c of a) for (const t of c.targets) expect(page.nodes[t]).toBeDefined();
      }),
      runs,
    );
  });

  it("any sequence of candidates, in any order, gives a valid page", () => {
    fc.assert(
      fc.property(
        validPageArb.chain(({ page, tasks }) => sequenceOf(generateCandidates(page, tasks)).map((seq) => ({ page, seq }))),
        ({ page, seq }) => {
          const out = applyFixes(page, seq);
          expect(validatePage(out)).toEqual([]);
          // Also valid after every prefix (each step is a self-contained transform).
          let cur = page;
          for (const f of seq) {
            cur = applyFix(cur, f);
            expect(validatePage(cur)).toEqual([]);
          }
          expect(cur).toEqual(out);
        },
      ),
      runs,
    );
  });

  it("never mutates its input", () => {
    fc.assert(
      fc.property(
        validPageArb.chain(({ page, tasks }) => sequenceOf(generateCandidates(page, tasks)).map((seq) => ({ page, seq }))),
        ({ page, seq }) => {
          const before = structuredClone(page);
          const frozen = deepFreeze(structuredClone(page));
          applyFixes(frozen, seq); // throws in strict mode if anything is written
          applyFixes(page, seq);
          expect(page).toEqual(before);
        },
      ),
      runs,
    );
  });

  it("applying the same fix twice equals applying it once, from any reachable state", () => {
    fc.assert(
      fc.property(
        validPageArb.chain(({ page, tasks }) => {
          const cands = generateCandidates(page, tasks);
          return fc.record({ page: fc.constant(page), prefix: sequenceOf(cands), pick: fc.nat({ max: Math.max(0, cands.length - 1) }), cands: fc.constant(cands) });
        }),
        ({ page, prefix, pick, cands }) => {
          if (!cands.length) return;
          const f = cands[pick];
          const state = applyFixes(page, prefix);
          const once = applyFix(state, f);
          expect(applyFix(once, f)).toEqual(once);
          expect(applyFixes(state, [f, f])).toEqual(once);
        },
      ),
      runs,
    );
  });

  it("fixes commute: a set of candidates gives the same page in any order", () => {
    fc.assert(
      fc.property(
        validPageArb.chain(({ page, tasks }) =>
          fc.record({ page: fc.constant(page), seq: sequenceOf(generateCandidates(page, tasks)) }).chain((r) => fc.shuffledSubarray(r.seq, { minLength: r.seq.length }).map((shuffled) => ({ ...r, shuffled }))),
        ),
        ({ page, seq, shuffled }) => {
          expect(applyFixes(page, shuffled)).toEqual(applyFixes(page, seq));
        },
      ),
      runs,
    );
  });

  it("applying every candidate fixes every defect it targets", () => {
    fc.assert(
      fc.property(validPageArb, ({ page, tasks }) => {
        const cands = generateCandidates(page, tasks);
        const out = applyFixes(page, cands);
        expect(validatePage(out)).toEqual([]);
        const rest = generateCandidates(out, tasks);
        // Nothing the generator can fix is left (unlabeled controls with no visual label stay for LLM repair).
        // The one exception: other fixes can unlock a skip link that was not worthwhile before (a promoted
        // h1 or a new main landmark becomes the landing spot), and that fix is then still on offer.
        expect(rest.filter((c) => c.kind !== "skip-link")).toEqual([]);
        // Derived arrays only grow.
        for (const id of page.readingOrder) expect(out.readingOrder).toContain(id);
        for (const id of page.focusOrder) expect(out.focusOrder).toContain(id);
        for (const id of page.headings) expect(out.headings).toContain(id);
        for (const id of page.landmarks) expect(out.landmarks).toContain(id);
        // Fake buttons end up in the Tab order.
        for (const id of Object.keys(page.nodes)) {
          if (page.nodes[id].hints.fakeButton) expect(out.focusOrder).toContain(id);
          expect(out.nodes[id].tabIndex === null || (out.nodes[id].tabIndex as number) <= 0).toBe(true);
        }
      }),
      runs,
    );
  });
});

describe("fix transforms (mini-shop)", () => {
  const cands = generateCandidates(miniShop, miniShopTasks);

  it("every subset in every order is valid, pure and idempotent", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(cands), (subset) => {
        const before = structuredClone(miniShop);
        const out = applyFixes(miniShop, subset);
        expect(validatePage(out)).toEqual([]);
        expect(miniShop).toEqual(before);
        expect(applyFixes(out, subset)).toEqual(out);
      }),
      { numRuns: 200 },
    );
  });

  it("any ordering of the same subset gives the same page", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(cands, { minLength: 1 }), fc.integer(), (subset, seed) => {
        const r = Math.abs(seed) % subset.length;
        const rotated = [...subset.slice(r), ...subset.slice(0, r)];
        expect(applyFixes(miniShop, rotated)).toEqual(applyFixes(miniShop, subset));
      }),
      { numRuns: 200 },
    );
  });
});
