// Screen-reader persona: shortest paths over the browse-mode reading order.
//
// A state is the virtual-cursor position (reading index + 1; state 0 = before the first stop).
// Arriving at stop j costs one key (K) plus its speech; speech is heard in full only at the step's
// target, otherwise listenFraction of it. Strategies differ only in which commands exist:
//   headings  {nextHeading, next, prev, tab}   linear  {next}     find  {find, next}
//   landmarks {nextLandmark, next}             tab     {tab}
// Modelling addition: when the target lies *behind* the cursor, the backward analogue (Up arrow;
// Shift+Tab for the tab strategy) is also allowed, so a strategy is never "blocked" merely because
// an earlier step moved past the next target.
//
// find is two-layered: layer 0 = no query entered yet; `find` costs K (open) + K per query char +
// K (Enter) and lands on the first later stop whose announcement contains the query. After that
// (layer 1) the query is remembered and each further match costs one find-next key.

import { wordCount } from "@/lib/a11y/announce";
import type { CommandId, PageModel, StrategyId, Task } from "@/lib/contracts";
import { clip, isOperation, isUnlabeledControl, missingTargetReason, nodeName, unlabeledReason } from "./describe";
import { chainEdges, dijkstra, pathEdges, type PathEdge } from "./dijkstra";
import type { PageIndex } from "./pageindex";
import type { Params } from "./params";
import { TraceBuilder, type Planned } from "./trace";

export type ScreenReaderStrategy = Extract<StrategyId, "headings" | "find" | "linear" | "landmarks" | "tab">;

/** Order in which strategies are listed in results. */
export const SCREEN_READER_STRATEGIES: ScreenReaderStrategy[] = ["headings", "find", "linear", "landmarks", "tab"];

const C_NEXT = 1;
const C_PREV = 2;
const C_HEAD = 4;
const C_LAND = 8;
const C_TAB = 16;
const C_SHIFT_TAB = 32;
const C_FIND = 64;

const COMMAND_SETS: Record<ScreenReaderStrategy, number> = {
  headings: C_NEXT | C_PREV | C_HEAD | C_TAB,
  linear: C_NEXT,
  find: C_FIND | C_NEXT,
  landmarks: C_LAND | C_NEXT,
  tab: C_TAB | C_SHIFT_TAB, // Shift+Tab only matters for targets behind the cursor
};

const T_NEXT = 0;
const T_PREV = 1;
const T_HEAD = 2;
const T_LAND = 3;
const T_TAB = 4;
const T_SHIFT_TAB = 5;
const T_FIND = 6;
const T_FIND_NEXT = 7;

const TAG_COMMAND: CommandId[] = ["next", "prev", "nextHeading", "nextLandmark", "tab", "shiftTab", "find", "find"];
const TAG_KEY = ["Down", "Up", "H", "D", "Tab", "Shift+Tab", "Find", "Find next"];

export const STRATEGY_PHRASE: Record<ScreenReaderStrategy, string> = {
  headings: "heading navigation",
  find: "find",
  linear: "reading straight down with the arrow key",
  landmarks: "landmark navigation",
  tab: "the Tab key",
};

/** Search text for the find command: first word of the target's name, at most 8 characters. */
export function findQuery(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 8);
}

/** Cheapest command sequence from cursor `cur` to reading position `t`, or null when unreachable. */
function searchPath(idx: PageIndex, strategy: ScreenReaderStrategy, p: Params, cur: number, t: number, query: string, targetName: string): { path: PathEdge[]; query: string } | null {
  const N = idx.N;
  const S = N + 1; // states per layer
  const goalState = t + 1;
  if (strategy === "linear") {
    // {next} (plus Up when the target is behind) is a plain chain: no search needed.
    return { path: chainEdges(cur + 1, goalState, T_NEXT, T_PREV), query: "" };
  }
  let cmds = COMMAND_SETS[strategy];
  if (t < cur && strategy !== "headings") cmds |= C_PREV;
  const q = cmds & C_FIND ? findQuery(targetName).toLowerCase() : query;
  const useFind = (cmds & C_FIND) !== 0 && q.length > 0;
  if (!useFind) cmds &= ~C_FIND;

  // First match position >= s for the query (find).
  let nextMatch: Int32Array | null = null;
  if (useFind) {
    nextMatch = new Int32Array(S).fill(-1);
    for (let s = N - 1; s >= 0; s--) nextMatch[s] = idx.lower(s).includes(q) ? s : nextMatch[s + 1];
  }

  const K = p.K;
  const speechPerWord = 60 / p.speechWpm;
  const speech = (j: number): number => idx.words(j) * speechPerWord * (j === t ? 1 : p.listenFraction);
  const arrive = (j: number): number => K + speech(j);
  const findOpen = (2 + q.length) * K;

  const sp = dijkstra(
    useFind ? 2 * S : S,
    cur + 1,
    (u, relax) => {
      const layer = u >= S ? 1 : 0;
      const s = layer ? u - S : u;
      const base = layer * S;
      let j: number;
      if (cmds & C_HEAD) {
        j = idx.headingNext[s];
        if (j >= 0) relax(base + j + 1, arrive(j), T_HEAD);
      }
      if (cmds & C_LAND) {
        j = idx.landmarkNext[s];
        if (j >= 0) relax(base + j + 1, arrive(j), T_LAND);
      }
      if (cmds & C_FIND) {
        j = nextMatch![s];
        if (j >= 0) {
          if (layer === 0) relax(S + j + 1, findOpen + speech(j), T_FIND);
          else relax(S + j + 1, arrive(j), T_FIND_NEXT);
        }
      }
      if (cmds & C_NEXT && s < N) relax(base + s + 1, arrive(s), T_NEXT);
      if (cmds & C_PREV && s >= 2) relax(base + s - 1, arrive(s - 2), T_PREV);
      if (cmds & C_TAB) {
        j = idx.tabNext[s];
        if (j >= 0) relax(base + j + 1, arrive(j), T_TAB);
      }
      if (cmds & C_SHIFT_TAB) {
        j = idx.tabPrev[s];
        if (j >= 0) relax(base + j + 1, arrive(j), T_SHIFT_TAB);
      }
    },
    (u) => (u >= S ? u - S : u) === goalState,
  );
  return sp.goal < 0 ? null : { path: pathEdges(sp, sp.goal), query: useFind ? q : "" };
}

export function planScreenReader(page: PageModel, idx: PageIndex, task: Task, strategy: ScreenReaderStrategy, p: Params): Planned {
  const tb = new TraceBuilder(strategy, p);
  const S = idx.N + 1;
  const titleWords = wordCount(page.title);
  let cur = -1; // reading position of the cursor; -1 = before the first stop

  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const node = page.nodes[step.target];
    if (!node) return tb.done({ stepIndex: si, reason: missingTargetReason(step.target) });
    const label = clip(nodeName(node));
    const t = idx.resolveStop(node.id);
    if (t < 0) return tb.done({ stepIndex: si, reason: `“${label}” is not part of the page a screen reader reads (it is hidden from assistive technology).` });
    if (isOperation(step.action) && isUnlabeledControl(node)) return tb.done({ stepIndex: si, reason: unlabeledReason(node) });
    if (strategy === "tab" && idx.focusIdxOfRead[t] < 0) {
      return tb.done({ stepIndex: si, reason: `Pressing Tab never lands on “${label}”: it is not a keyboard focus stop.` });
    }

    // Plan the move before emitting anything, so a blocked step leaves no half-written events.
    let found: { path: PathEdge[]; query: string } | null = { path: [], query: "" };
    if (cur !== t) {
      found = searchPath(idx, strategy, p, cur, t, "", node.name);
      if (!found) return tb.done({ stepIndex: si, reason: `“${label}” cannot be reached using ${STRATEGY_PHRASE[strategy]}.` });
    }

    tb.begin(si, node.id);
    if (si === 0 && titleWords > 0) {
      tb.event("think", null, `Hear page title: “${clip(page.title, 60)}”`, { spkFull: titleWords }, { utterance: { nodeId: page.root, text: page.title, truncated: false }, counted: false });
    }
    tb.event("think", null, "Think", { M: 1 });

    for (const e of found.path) {
      const j = (e.to >= S ? e.to - S : e.to) - 1;
      const isTarget = j === t;
      const words = idx.words(j);
      const stopId = page.readingOrder[j];
      const text = idx.announcement(j);
      const keys = e.tag === T_FIND ? 2 + found.query.length : 1;
      const key = e.tag === T_FIND ? `Find “${clip(found.query, 8)}”` : TAG_KEY[e.tag];
      tb.heard(TAG_COMMAND[e.tag], stopId, `${key} → ${text}`, keys, words, isTarget, text);
    }
    cur = t;

    const targetId = page.readingOrder[t];
    if (step.action !== "read") {
      tb.event("activate", targetId, `Enter → activate “${label}”`, { K: 1 });
      if (step.action === "type") {
        const text = step.text ?? "";
        tb.event("type", targetId, `Type “${clip(text, 30)}”`, { chars: text.length });
      }
    }
    tb.end();
  }
  return tb.done();
}
