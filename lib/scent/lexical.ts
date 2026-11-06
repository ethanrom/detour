// Deterministic lexical information-scent scorer.
//
// score(task, heading) = soft overlap coefficient of the two stemmed, stop-word-free token sets:
//   take the smaller set (ties: the heading), and for each of its tokens find the best match in the
//   other set (exact stem = 1, same synonym cluster = 0.8, related cluster = 0.5); average, clip to [0,1].
// The overlap coefficient (|A n B| / min(|A|,|B|)) is used instead of Jaccard because headings are short
// and task text is long: a heading "Returns" fully matches a long sentence about returning an item.

import type { ScentScorer } from "./scorer";

export const SYNONYM_WEIGHT = 0.8;
export const RELATED_WEIGHT = 0.5;

const STOP_WORDS = new Set(
  (
    // function words
    "a an the and or but nor of to in on at by for with from as is are was were be been being am do does did " +
    "done have has had having i me my mine we us our you your yours he she him her his it its they them their " +
    "this that these those there here what which who whom whose how when where why can could should would will " +
    "shall may might must not no yes if then than so too very just only also again any all each both few more " +
    "most other some such own same up down out over under into onto off per via about above below " +
    // task boilerplate: verbs and quantifiers that frame a request but do not name the goal
    "find get got see show go open view check want wants need needs like looking look know tell give let make " +
    "take use using read select choose click press tap add many much long enough please able try " +
    // vague, content-free page words (a heading made only of these has no scent)
    "info information detail details learn page site website section content more"
  ).split(/\s+/),
);

/** Synonym clusters for the demo domains. Words are stemmed with the same stemmer as the text. */
const SYNONYM_CLUSTERS: string[][] = [
  ["return", "refund", "exchange", "reimburse", "reimbursement", "moneyback"],
  ["size", "fit", "sizing", "measurement", "dimension"],
  ["income", "limit", "eligibility", "eligible", "qualify", "qualification", "threshold", "requirement", "criteria", "cap", "ceiling", "entitled"],
  ["apply", "application", "start", "begin", "enroll", "enrol", "enrollment", "register", "registration", "signup", "submit", "request"],
  ["language", "espanol", "spanish", "translate", "translation", "english", "idioma", "multilingual"],
  ["cart", "bag", "basket", "checkout", "trolley"],
  ["review", "rating", "rate", "feedback", "testimonial", "star"],
  ["delivery", "shipping", "ship", "deliver", "postage", "freight", "courier"],
  ["price", "cost", "fee", "pricing", "payment", "pay", "charge", "afford"],
  ["contact", "support", "phone", "email", "call", "helpline"],
  ["account", "login", "signin", "profile", "password", "username"],
  ["document", "form", "paperwork", "upload", "proof"],
  ["location", "address", "office", "visit", "direction", "map", "hour", "open"],
  ["deadline", "date", "due", "expire", "expiration"],
  ["benefit", "assistance", "aid", "program", "subsidy", "coverage"],
];

/** Weaker, one-directional-feeling associations that still share a cluster edge (weight 0.5). */
const RELATED_CLUSTERS: Array<[string, string]> = [
  ["return", "delivery"], // "Shipping & returns" is where customers look for return windows
  ["return", "price"], // refunds and fees
  ["cart", "price"],
  ["cart", "delivery"],
  ["size", "review"], // "runs large" lives in reviews
  ["apply", "document"],
  ["apply", "deadline"],
  ["income", "benefit"],
  ["income", "apply"],
  ["contact", "location"],
];

/** Light, deterministic stemmer (strip plural s/es/ies, ing, ed, trailing e; undouble consonants). */
export function stem(word: string): string {
  let s = word;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("ied")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && /(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = undouble(s.slice(0, -3));
  else if (s.length > 4 && s.endsWith("ed")) s = undouble(s.slice(0, -2));
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

function undouble(s: string): string {
  const n = s.length;
  if (n > 2 && s[n - 1] === s[n - 2] && !"lsz".includes(s[n - 1])) return s.slice(0, -1);
  return s;
}

/** Lower-cased, accent-stripped, stop-word-free, stemmed, de-duplicated tokens (first-seen order). */
export function tokenize(text: string): string[] {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || /^\d+$/.test(raw) || STOP_WORDS.has(raw)) continue;
    const t = stem(raw);
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const clusterOf = new Map<string, Set<number>>();
SYNONYM_CLUSTERS.forEach((words, ci) => {
  for (const w of words) {
    const t = stem(w);
    let set = clusterOf.get(t);
    if (!set) clusterOf.set(t, (set = new Set()));
    set.add(ci);
  }
});

const clusterIndex = (name: string): number => SYNONYM_CLUSTERS.findIndex((c) => c[0] === name);
const relatedPairs = new Set<string>();
for (const [a, b] of RELATED_CLUSTERS) {
  const ia = clusterIndex(a);
  const ib = clusterIndex(b);
  if (ia < 0 || ib < 0) throw new Error(`unknown related cluster ${a}/${b}`);
  relatedPairs.add(`${ia}|${ib}`);
  relatedPairs.add(`${ib}|${ia}`);
}

/** Match strength between two stems: 1 exact, 0.8 same cluster, 0.5 related clusters, else 0. */
export function matchWeight(a: string, b: string): number {
  if (a === b) return 1;
  const ca = clusterOf.get(a);
  const cb = clusterOf.get(b);
  if (!ca || !cb) return 0;
  let best = 0;
  for (const x of ca) {
    for (const y of cb) {
      if (x === y) return SYNONYM_WEIGHT;
      if (relatedPairs.has(`${x}|${y}`)) best = RELATED_WEIGHT;
    }
  }
  return best;
}

/** Soft overlap coefficient of two token sets, in [0,1]. */
export function overlapScore(taskTokens: string[], labelTokens: string[]): number {
  if (taskTokens.length === 0 || labelTokens.length === 0) return 0;
  const [small, large] = labelTokens.length <= taskTokens.length ? [labelTokens, taskTokens] : [taskTokens, labelTokens];
  let sum = 0;
  for (const a of small) {
    let best = 0;
    for (const b of large) {
      best = Math.max(best, matchWeight(a, b));
      if (best === 1) break;
    }
    sum += best;
  }
  return Math.min(1, Math.max(0, sum / small.length));
}

/**
 * Deterministic lexical scorer. Two call forms:
 *   lexicalScorer(taskText, labels) -> number[]      (a ScentScorer; pass the function itself as the scorer)
 *   lexicalScorer(taskText)         -> ScentScorer   (scorer bound to taskText; the text passed at call
 *                                                     time is ignored)
 */
export function lexicalScorer(taskText: string, labels: string[]): number[];
export function lexicalScorer(taskText: string): ScentScorer;
export function lexicalScorer(taskText: string, labels?: string[]): number[] | ScentScorer {
  if (labels === undefined) return (_ignored: string, ls: string[]) => lexicalScorer(taskText, ls);
  const t = tokenize(taskText);
  return labels.map((l) => overlapScore(t, tokenize(l)));
}
