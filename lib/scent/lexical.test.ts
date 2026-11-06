import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { combineScores, hybridScorer, validateScores } from "./scorer";
import { lexicalScorer, matchWeight, overlapScore, stem, tokenize } from "./lexical";

const score = (task: string, label: string) => lexicalScorer(task, [label])[0];

describe("stemming and tokenising", () => {
  it("strips plural, -ing and -ed consistently", () => {
    expect(stem("returns")).toBe(stem("return"));
    expect(stem("sizes")).toBe(stem("size"));
    expect(stem("shipping")).toBe("ship");
    expect(stem("limited")).toBe(stem("limit"));
    expect(stem("applying")).toBe(stem("apply"));
    expect(stem("applied")).toBe(stem("apply"));
    expect(stem("policies")).toBe(stem("policy"));
    expect(stem("rating")).toBe(stem("rate"));
    expect(stem("address")).toBe("address");
  });

  it("lower-cases, drops stop words, numbers and accents", () => {
    expect(tokenize("Find the Monthly INCOME limit for a household of 3")).toEqual(["monthly", "incom", "limit", "household"]);
    expect(tokenize("Español")).toEqual(tokenize("espanol"));
    expect(tokenize("More information")).toEqual([]);
  });
});

describe("synonym map", () => {
  it("links the demo-domain vocabulary at 0.8 and exact stems at 1", () => {
    for (const [a, b] of [
      ["return", "refund"],
      ["return", "exchange"],
      ["size", "fit"],
      ["income", "limit"],
      ["income", "eligibility"],
      ["income", "qualify"],
      ["apply", "application"],
      ["apply", "start"],
      ["language", "espanol"],
      ["language", "spanish"],
      ["language", "translate"],
      ["cart", "bag"],
      ["cart", "checkout"],
      ["review", "rating"],
    ]) {
      expect(matchWeight(stem(a), stem(b))).toBe(0.8);
    }
    expect(matchWeight(stem("returns"), stem("return"))).toBe(1);
    expect(matchWeight(stem("return"), stem("review"))).toBe(0);
  });
});

describe("lexicalScorer", () => {
  it("scores 'Shipping & returns' above 0.5 and 'Customer reviews' below 0.2 for a return question", () => {
    const task = "Find out how many days you have to return it";
    const [ship, reviews] = lexicalScorer(task, ["Shipping & returns", "Customer reviews"]);
    expect(ship).toBeGreaterThan(0.5);
    expect(reviews).toBeLessThan(0.2);
  });

  it("scores 'Income limits' high and 'More information' low for an income-limit question", () => {
    const task = "Find the monthly income limit for a household of 3";
    const [income, more, contact] = lexicalScorer(task, ["Income limits", "More information", "Contact us"]);
    expect(income).toBeGreaterThan(0.9);
    expect(more).toBeLessThan(0.1);
    expect(contact).toBeLessThan(0.1);
  });

  it("uses synonyms: eligibility is close to income limits, language to Español", () => {
    expect(score("What is the income limit?", "Eligibility")).toBe(0.8);
    expect(score("Switch the page to Spanish", "Español")).toBe(0.8);
    expect(score("Add this to my cart", "Your bag")).toBeGreaterThanOrEqual(0.8);
    expect(score("Read the customer ratings", "Reviews")).toBe(0.8);
    expect(score("How do I start?", "Apply now")).toBe(0.8);
  });

  it("is a ScentScorer in both call forms and is deterministic", () => {
    const labels = ["Income limits", "Who can apply", "Contact us"];
    const text = "Find the monthly income limit";
    const direct = lexicalScorer(text, labels);
    const bound = lexicalScorer(text)("ignored", labels);
    expect(bound).toEqual(direct);
    expect(lexicalScorer(text, labels)).toEqual(direct);
  });

  it("always returns scores in [0,1] and one per label", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string(), { maxLength: 8 }), (task, labels) => {
        const out = lexicalScorer(task, labels);
        expect(out).toHaveLength(labels.length);
        for (const v of out) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a label scores 1 against itself, and a subset of the task's words scores 1", () => {
    const word = fc.stringMatching(/^[a-z]{3,9}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 5 }), fc.array(word, { maxLength: 4 }), (a, extra) => {
        const ta = tokenize(a.join(" "));
        if (ta.length === 0) return;
        expect(overlapScore(ta, ta)).toBe(1);
        expect(overlapScore(tokenize([...a, ...extra].join(" ")), ta)).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});

describe("combining with an LLM scorer", () => {
  it("combineScores blends 0.7 LLM + 0.3 lexical by default and falls back to lexical", () => {
    expect(combineScores([0, 1, 0.5], [1, 0, 0.5])).toEqual([0.7, 0.3, 0.5].map((v) => expect.closeTo(v, 12)));
    expect(combineScores([0.2, 0.9], null)).toEqual([0.2, 0.9]);
    expect(combineScores([0.2, 0.9], [1])).toEqual([0.2, 0.9]); // wrong length is ignored
    expect(combineScores([0.2], [1], 0)).toEqual([0.2]);
    expect(combineScores([0.2], [1], 1)).toEqual([1]);
  });

  it("validateScores rejects malformed LLM output", () => {
    expect(validateScores([0, 0.5, 1], 3)).toEqual([0, 0.5, 1]);
    expect(validateScores([0, 0.5], 3)).toBeNull();
    expect(validateScores([0, 1.5, 1], 3)).toBeNull();
    expect(validateScores([0, Number.NaN, 1], 3)).toBeNull();
    expect(validateScores(["0.5"], 1)).toBeNull();
    expect(validateScores(null, 0)).toBeNull();
  });

  it("hybridScorer blends and degrades to lexical when the LLM fails or lies", async () => {
    const labels = ["Income limits", "More information"];
    const task = "Find the monthly income limit";
    const lex = lexicalScorer(task, labels);
    const good = await hybridScorer(async () => [0.2, 0.9])(task, labels);
    expect(good[0]).toBeCloseTo(0.7 * 0.2 + 0.3 * lex[0], 12);
    expect(good[1]).toBeCloseTo(0.7 * 0.9 + 0.3 * lex[1], 12);
    expect(await hybridScorer(async () => Promise.reject(new Error("throttled")))(task, labels)).toEqual(lex);
    expect(await hybridScorer(async () => [7, -3])(task, labels)).toEqual(lex);
    expect(await hybridScorer(async () => [0.5])(task, labels)).toEqual(lex);
  });
});
