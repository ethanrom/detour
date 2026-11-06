// Information-foraging model of screen-reader heading navigation, as an absorbing Markov chain.
//
// A blind user rarely knows which heading leads to the target. They press H, hear a heading, judge
// whether its text "smells" like the goal (information scent; Pirolli & Card 1999), dive into the section
// or press H again, and back out of wrong sections (SNIF-ACT, Fu & Pirolli 2007; CogTool-Explorer,
// Teo, John & Blackmon 2012). The shortest-path engine assumes the first guess is right; this computes
// the expected time when it is not.
//
// Chain (one step of a task):
//   States   S(pass, q): the user has just arrived (by H) at the q-th heading of the circular heading
//            order that starts at the first heading after the cursor. Pass 1 visits every heading once
//            (wrapping past the end, which NVDA does); pass 2 visits them all again.
//   Decide   enter with probability p = sigmoid(alpha * (scent - theta)); pass 2 uses max(p, pMin2).
//   Enter    section holds the target: press Down through it, hear the target in full, absorb "found".
//            section is wrong: hear r = min(len, ceil(beta * len) + 1) stops, think (M), press H again.
//   Skip     press H again. After the last heading of pass 2 the user reads linearly from the top.
// Expected time t = N c, with N = (I - Q)^-1 (fundamental matrix) and c the expected cost per state.

import { wordCount } from "@/lib/a11y/announce";
import type { NodeId, PageModel, Task } from "@/lib/contracts";
import { LITERATURE } from "@/lib/params/literature";
import { fundamentalMatrix, type Matrix } from "./solver";

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

export interface ScentOptions {
  /** Seconds per key press (default LITERATURE.klm.K). */
  K?: number;
  /** Speech rate, words per minute (default LITERATURE.speech.wpm). */
  wpm?: number;
  /** Fraction of a non-target announcement heard before moving on (default LITERATURE.speech.listenFraction). */
  listenFraction?: number;
  /** Mental decision time in seconds, charged once per abandoned wrong section (default LITERATURE.klm.M). */
  M?: number;
  /** Steepness of the enter-probability sigmoid (default 10). MODELLING ASSUMPTION. */
  alpha?: number;
  /** Scent threshold at which the user is 50% likely to enter (default 0.35). MODELLING ASSUMPTION. */
  theta?: number;
  /** Fraction of a wrong section heard before giving up (default 0.4). MODELLING ASSUMPTION. */
  beta?: number;
  /** Floor on the enter probability during the second pass (default 0.5). MODELLING ASSUMPTION. */
  pMin2?: number;
  /** Override the goal text handed to the scorer (default: task label plus the step note). */
  taskText?: string;
}

export type ResolvedScentOptions = Required<Omit<ScentOptions, "taskText">>;

/** Defaults for the foraging behaviour. These are modelling assumptions, not measured constants:
 *  alpha/theta encode the satisficing "scent threshold" idea of SNIF-ACT (Fu & Pirolli 2007), beta how
 *  long a user persists in a section that has not paid off, pMin2 that a user who has heard every heading
 *  once and found nothing becomes willing to try anything. */
export const DEFAULT_FORAGING = { alpha: 10, theta: 0.35, beta: 0.4, pMin2: 0.5 } as const;

export function resolveScentOptions(o: ScentOptions = {}): ResolvedScentOptions {
  const r: ResolvedScentOptions = {
    K: o.K ?? LITERATURE.klm.K.value,
    wpm: o.wpm ?? LITERATURE.speech.wpm.value,
    listenFraction: o.listenFraction ?? LITERATURE.speech.listenFraction.value,
    M: o.M ?? LITERATURE.klm.M.value,
    alpha: o.alpha ?? DEFAULT_FORAGING.alpha,
    theta: o.theta ?? DEFAULT_FORAGING.theta,
    beta: o.beta ?? DEFAULT_FORAGING.beta,
    pMin2: o.pMin2 ?? DEFAULT_FORAGING.pMin2,
  };
  const bad = (name: string): never => {
    throw new RangeError(`searchHeadings: invalid option ${name}`);
  };
  if (!(r.K >= 0)) bad("K");
  if (!(r.wpm > 0)) bad("wpm");
  if (!(r.listenFraction >= 0 && r.listenFraction <= 1)) bad("listenFraction");
  if (!(r.M >= 0)) bad("M");
  if (!(r.alpha >= 0)) bad("alpha");
  if (!Number.isFinite(r.theta)) bad("theta");
  if (!(r.beta >= 0 && r.beta <= 1)) bad("beta");
  if (!(r.pMin2 >= 0 && r.pMin2 <= 1)) bad("pMin2");
  return r;
}

/** p = 1 / (1 + exp(-alpha (scent - theta))), evaluated without overflow. */
export function enterProbability(scent: number, alpha: number, theta: number): number {
  const x = alpha * (scent - theta);
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** Stops heard in a wrong section before giving up: min(len, ceil(beta * len) + 1). */
export function giveUpStops(len: number, beta: number): number {
  return Math.min(len, Math.ceil(beta * len - 1e-9) + 1);
}

// ---------------------------------------------------------------------------------------------
// Step geometry
// ---------------------------------------------------------------------------------------------

export interface HeadingInfo {
  nodeId: NodeId;
  label: string;
  /** Index into page.readingOrder. */
  pos: number;
  /** Stops in the section after the heading itself. */
  len: number;
}

export type StepMode =
  /** Heading foraging chain. */
  | "search"
  /** The target is in the section the cursor is already in: the user just arrows to it. */
  | "local"
  /** The page has no headings and the cursor is at the top: plain linear reading. */
  | "linear";

export interface StepSetup {
  params: ResolvedScentOptions;
  taskText: string;
  targetId: NodeId;
  targetPos: number;
  /** Reading-stop index of the cursor; -1 = top of the page. */
  cursorPos: number;
  /** Seconds to speak each reading stop's announcement in full. */
  speech: number[];
  /** Headings in reading order (those of page.headings that are reading stops). */
  headings: HeadingInfo[];
  /** Index into `headings` of the section holding the target; -1 = before the first heading. */
  targetSection: number;
  mode: StepMode;
  /** Index into `headings` of the first heading the H key reaches from the cursor. */
  startHeading: number;
}

/** Labels handed to the scorer: the accessible name of each heading, in reading order. */
export function headingLabels(page: PageModel): string[] {
  return orderedHeadings(page).map((h) => h.label);
}

function orderedHeadings(page: PageModel): Array<{ nodeId: NodeId; label: string; pos: number }> {
  const pos = new Map<NodeId, number>();
  page.readingOrder.forEach((id, i) => pos.set(id, i));
  const out: Array<{ nodeId: NodeId; label: string; pos: number }> = [];
  for (const id of page.headings) {
    const p = pos.get(id);
    if (p === undefined) continue;
    out.push({ nodeId: id, label: (page.nodes[id]?.name ?? "").replace(/\s+/g, " ").trim(), pos: p });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** The text the scorer sees: what the user is trying to do at this step. */
export function stepGoalText(task: Task, stepIndex: number): string {
  const note = task.steps[stepIndex]?.note?.trim();
  return note && note !== task.label ? `${task.label}. ${note}` : task.label;
}

export function prepareStep(page: PageModel, task: Task, stepIndex: number, opts: ScentOptions = {}): StepSetup {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= task.steps.length) {
    throw new RangeError(`searchHeadings: stepIndex ${stepIndex} out of range for task ${task.id}`);
  }
  const params = resolveScentOptions(opts);
  const order = page.readingOrder;
  const posOf = new Map<NodeId, number>();
  order.forEach((id, i) => posOf.set(id, i));

  const targetId = task.steps[stepIndex].target;
  const targetPos = posOf.get(targetId);
  if (targetPos === undefined) throw new Error(`searchHeadings: target ${targetId} is not a reading stop`);
  const prevId = stepIndex > 0 ? task.steps[stepIndex - 1].target : null;
  const cursorPos = prevId !== null ? (posOf.get(prevId) ?? -1) : -1;

  const speech = order.map((id) => (wordCount(page.nodes[id]?.announcement ?? "") / params.wpm) * 60);

  const hs = orderedHeadings(page);
  const headings: HeadingInfo[] = hs.map((h, i) => {
    const next = i + 1 < hs.length ? hs[i + 1].pos : order.length;
    return { nodeId: h.nodeId, label: h.label, pos: h.pos, len: next - h.pos - 1 };
  });
  const sectionOf = (p: number): number => {
    let k = -1;
    for (let i = 0; i < headings.length && headings[i].pos <= p; i++) k = i;
    return k;
  };
  const targetSection = sectionOf(targetPos);

  let mode: StepMode;
  if (cursorPos >= 0 && sectionOf(cursorPos) === targetSection) mode = "local";
  else if (headings.length === 0) mode = "linear";
  else mode = "search";

  let startHeading = headings.findIndex((h) => h.pos > cursorPos);
  if (startHeading < 0) startHeading = 0;

  return {
    params,
    taskText: opts.taskText ?? stepGoalText(task, stepIndex),
    targetId,
    targetPos,
    cursorPos,
    speech,
    headings,
    targetSection,
    mode,
    startHeading,
  };
}

// ---------------------------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------------------------

export interface Costs {
  /** K + listenFraction * speech(j): arriving at stop j without it being the target. */
  skim(j: number): number;
  /** K + speech(j): arriving at the target and hearing it in full. */
  full(j: number): number;
  /** Seconds to press Down from the heading at hpos until the target is heard in full. */
  arrowsToTarget(hpos: number): number;
  /** Seconds to listen to the first r stops after the heading at hpos, plus the abandon decision M. */
  wrongSection(h: HeadingInfo): number;
  /** Ctrl+Home is not charged here: linear reading from the top, ending at the target. */
  linearFromTop(): number;
  /** Seconds to arrow from the cursor to a target in the same section (either direction). */
  local(): number;
}

export function makeCosts(s: StepSetup): Costs {
  const { K, listenFraction: lf, M, beta } = s.params;
  const sp = s.speech;
  const skim = (j: number) => K + lf * sp[j];
  const full = (j: number) => K + sp[j];
  const t = s.targetPos;
  return {
    skim,
    full,
    arrowsToTarget(hpos) {
      if (t === hpos) return (1 - lf) * sp[t]; // the heading is the target: finish listening to it
      let c = 0;
      for (let j = hpos + 1; j < t; j++) c += skim(j);
      return c + full(t);
    },
    wrongSection(h) {
      const r = giveUpStops(h.len, beta);
      let c = M;
      for (let j = 1; j <= r; j++) c += skim(h.pos + j);
      return c;
    },
    linearFromTop() {
      let c = 0;
      for (let j = 0; j < t; j++) c += skim(j);
      return c + full(t);
    },
    local() {
      const c0 = s.cursorPos;
      if (t === c0) return 0;
      let c = 0;
      if (t > c0) for (let j = c0 + 1; j < t; j++) c += skim(j);
      else for (let j = c0 - 1; j > t; j--) c += skim(j);
      return c + full(t);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

export interface ChainState {
  pass: 1 | 2;
  /** Position in the circular order (0 = the first heading the H key reaches). */
  q: number;
  /** Index into StepSetup.headings. */
  heading: number;
  /** Enter probability used in this state. */
  p: number;
  /** True if this heading's section holds the target. */
  isTarget: boolean;
  /** Cost of arriving here by H and skimming the heading. */
  arrive: number;
  /** Cost of entering: arrows to the target (isTarget) or the wrong-section detour (otherwise). */
  enter: number;
  /** Probability of leaving the chain by falling back to linear reading (only the last state). */
  pFallback: number;
}

export interface Chain {
  states: ChainState[];
  /** Transient-to-transient transition probabilities. */
  Q: Matrix;
  /** Expected cost incurred in each state (arrival + expected entry + expected fallback). */
  c: number[];
  /** Linear reading from the top after both passes (Ctrl+Home plus the linear walk). */
  fallbackCost: number;
}

export function buildChain(s: StepSetup, pEnter: number[]): Chain {
  const H = s.headings.length;
  const costs = makeCosts(s);
  const fallbackCost = costs.linearFromTop() + (s.mode === "linear" ? 0 : s.params.K);
  const states: ChainState[] = [];
  if (s.mode === "search") {
    for (const pass of [1, 2] as const) {
      for (let q = 0; q < H; q++) {
        const k = (s.startHeading + q) % H;
        const h = s.headings[k];
        const base = pEnter[k];
        const isTarget = k === s.targetSection;
        const p = pass === 1 ? base : Math.max(base, s.params.pMin2);
        const last = pass === 2 && q === H - 1;
        states.push({
          pass,
          q,
          heading: k,
          p,
          isTarget,
          arrive: costs.skim(h.pos),
          enter: isTarget ? costs.arrowsToTarget(h.pos) : costs.wrongSection(h),
          pFallback: last ? (isTarget ? 1 - p : 1) : 0,
        });
      }
    }
  }
  const n = states.length;
  const Q: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const c = new Array<number>(n).fill(0);
  states.forEach((st, i) => {
    if (i + 1 < n) Q[i][i + 1] = st.isTarget ? 1 - st.p : 1;
    c[i] = st.arrive + st.p * st.enter + st.pFallback * fallbackCost;
  });
  return { states, Q, c, fallbackCost };
}

// ---------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------

export interface HeadingBreakdown {
  nodeId: NodeId;
  label: string;
  /** Information scent in [0,1] from the scorer. */
  scent: number;
  /** First-pass probability of entering this section. */
  pEnter: number;
  /** Expected number of times the user lands on this heading, across both passes (row 0 of N). */
  expectedVisits: number;
  /** True if the target is inside this heading's section. */
  containsTarget: boolean;
  /** Stops in the section after the heading. */
  sectionLength: number;
}

export interface ScentResult {
  /** Expected seconds to reach and hear the target, starting from the cursor. Excludes the activation. */
  seconds: number;
  mode: StepMode;
  /** Perfect-knowledge cost: H straight to the target's heading, then arrows. This is what a shortest-path
   *  engine charges; for a target before the first heading it is plain linear reading. */
  shortestSeconds: number;
  /** seconds - shortestSeconds: what not knowing which heading to open costs. */
  foragingOverheadSeconds: number;
  /** Linear reading from the top of the page to the target. */
  linearSeconds: number;
  /** P(the user opens the target's section on the first pass over the headings). */
  pFoundFirstPass: number;
  /** P(found within the two heading passes). */
  pFoundHeadings: number;
  /** P(the user gives up on headings and reads linearly) = 1 - pFoundHeadings. */
  pFallbackLinear: number;
  /** Expected number of headings heard (H presses). */
  expectedHeadingsHeard: number;
  /** Expected number of wrong sections entered. */
  expectedWrongSections: number;
  /** Where the expected seconds go. Components sum to `seconds`. */
  components: { headings: number; wrongSections: number; arrowsToTarget: number; linearFallback: number; local: number };
  perHeading: HeadingBreakdown[];
  /** The heading above the target, or null when the target precedes the first heading / mode is not "search". */
  targetHeading: NodeId | null;
  /** Goal text given to the scorer. */
  taskText: string;
  params: ResolvedScentOptions;
}

export function emptyComponents(): ScentResult["components"] {
  return { headings: 0, wrongSections: 0, arrowsToTarget: 0, linearFallback: 0, local: 0 };
}

/** Pure computation: setup + per-heading enter probabilities (first-pass) -> expected values. */
export function analyze(s: StepSetup, scores: number[]): ScentResult {
  const { alpha, theta } = s.params;
  const costs = makeCosts(s);
  const H = s.headings.length;
  const linearSeconds = costs.linearFromTop();
  const pEnter = scores.map((x) => enterProbability(x, alpha, theta));

  // Perfect-knowledge cost.
  let shortest: number;
  if (s.targetSection >= 0 && s.mode !== "local") {
    const qStar = (s.targetSection - s.startHeading + H) % H;
    shortest = costs.arrowsToTarget(s.headings[s.targetSection].pos);
    for (let q = 0; q <= qStar; q++) shortest += costs.skim(s.headings[(s.startHeading + q) % H].pos);
  } else if (s.mode === "local") {
    shortest = costs.local();
  } else {
    shortest = linearSeconds + (s.cursorPos >= 0 ? s.params.K : 0);
  }

  const base = {
    mode: s.mode,
    shortestSeconds: shortest,
    linearSeconds,
    taskText: s.taskText,
    params: s.params,
  };

  if (s.mode === "local") {
    const sec = costs.local();
    return {
      ...base,
      seconds: sec,
      foragingOverheadSeconds: 0,
      pFoundFirstPass: 1,
      pFoundHeadings: 1,
      pFallbackLinear: 0,
      expectedHeadingsHeard: 0,
      expectedWrongSections: 0,
      components: { ...emptyComponents(), local: sec },
      perHeading: [],
      targetHeading: null,
    };
  }

  const chain = buildChain(s, pEnter);
  if (s.mode === "linear") {
    return {
      ...base,
      seconds: chain.fallbackCost,
      foragingOverheadSeconds: chain.fallbackCost - shortest,
      pFoundFirstPass: 0,
      pFoundHeadings: 0,
      pFallbackLinear: 1,
      expectedHeadingsHeard: 0,
      expectedWrongSections: 0,
      components: { ...emptyComponents(), linearFallback: chain.fallbackCost },
      perHeading: [],
      targetHeading: null,
    };
  }

  const N = fundamentalMatrix(chain.Q);
  const v = N[0]; // expected visits to each transient state from the start state
  let seconds = 0;
  let pFound1 = 0;
  let pFound2 = 0;
  let wrong = 0;
  let heard = 0;
  const comp = emptyComponents();
  const visits = new Array<number>(H).fill(0);
  chain.states.forEach((st, i) => {
    seconds += v[i] * chain.c[i];
    heard += v[i];
    visits[st.heading] += v[i];
    comp.headings += v[i] * st.arrive;
    if (st.isTarget) {
      const f = v[i] * st.p;
      if (st.pass === 1) pFound1 += f;
      else pFound2 += f;
      comp.arrowsToTarget += f * st.enter;
    } else {
      wrong += v[i] * st.p;
      comp.wrongSections += v[i] * st.p * st.enter;
    }
    comp.linearFallback += v[i] * st.pFallback * chain.fallbackCost;
  });

  const perHeading: HeadingBreakdown[] = s.headings.map((h, k) => ({
    nodeId: h.nodeId,
    label: h.label,
    scent: scores[k],
    pEnter: pEnter[k],
    expectedVisits: visits[k],
    containsTarget: k === s.targetSection,
    sectionLength: h.len,
  }));

  return {
    ...base,
    seconds,
    foragingOverheadSeconds: seconds - shortest,
    pFoundFirstPass: pFound1,
    pFoundHeadings: pFound1 + pFound2,
    pFallbackLinear: 1 - (pFound1 + pFound2),
    expectedHeadingsHeard: heard,
    expectedWrongSections: wrong,
    components: comp,
    perHeading,
    targetHeading: s.targetSection >= 0 ? s.headings[s.targetSection].nodeId : null,
  };
}
