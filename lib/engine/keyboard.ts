// Keyboard-only persona (sighted, no mouse), strategy "tab".
// States are focus positions in page.focusOrder (shifted by one so state 0 is "before the first
// stop"). Edges: Tab (+1), Shift+Tab (-1) and, for every skip link, an Enter edge that jumps to
// the first focus stop at or after the link's target. Every key costs K x keyboardMotorFactor.
// Operating a control that is not in the focus order is impossible (blocked); reading content is
// done by scrolling (PageDown, one key per viewport) and is never blocked.

import { announce, wordCount } from "@/lib/a11y/announce";
import type { PageModel, Task } from "@/lib/contracts";
import { clip, keyboardBlockReason, missingTargetReason, nodeName } from "./describe";
import { chainEdges, dijkstra, pathEdges, type PathEdge } from "./dijkstra";
import { scrollTo } from "./geometry";
import type { PageIndex } from "./pageindex";
import type { Params } from "./params";
import { TraceBuilder, type Planned } from "./trace";

const TAG_TAB = 0;
const TAG_SHIFT_TAB = 1;
const TAG_SKIP = 2;

export function planKeyboard(page: PageModel, idx: PageIndex, task: Task, p: Params): Planned {
  const tb = new TraceBuilder("tab", p);
  const F = page.focusOrder.length;
  const kf = p.K * p.keyboardMotorFactor;
  const skip = idx.skipEdges();
  let cur = -1; // focus index; -1 = before the first stop
  let scrollY = 0;

  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const node = page.nodes[step.target];
    if (!node) return tb.done({ stepIndex: si, reason: missingTargetReason(step.target) });
    const name = clip(nodeName(node));
    tb.begin(si, node.id);
    tb.event("think", null, "Think", { M: 1 });

    if (step.action === "read") {
      // Reached by scrolling with PageDown, then read.
      if (node.rect) {
        const move = scrollTo(page, scrollY, node.rect);
        if (move) {
          const key = move.direction === "down" ? "Page Down" : "Page Up";
          for (let k = 0; k < move.count; k++) tb.event("scroll", node.id, `${key} → scroll one screen`, { Kf: 1, scrollVp: 1 });
          scrollY = move.scrollY;
        }
      }
      tb.event("think", node.id, `Read → ${name}`, { readWords: wordCount(node.name) }, { counted: false });
      tb.end();
      continue;
    }

    const f = idx.focusPos.get(node.id);
    if (f === undefined) return tb.done({ stepIndex: si, reason: keyboardBlockReason(idx, node, step.action) });

    if (f !== cur) {
      const goalState = f + 1;
      let path: PathEdge[];
      if (skip.size === 0) {
        // Without skip links the graph is a plain chain: the path is |difference| Tab or Shift+Tab presses.
        path = chainEdges(cur + 1, goalState, TAG_TAB, TAG_SHIFT_TAB);
      } else {
        const sp = dijkstra(
          F + 1,
          cur + 1,
          (s, relax) => {
            if (s < F) relax(s + 1, kf, TAG_TAB);
            if (s >= 2) relax(s - 1, kf, TAG_SHIFT_TAB);
            const dests = skip.get(s - 1);
            if (dests) for (const g of dests) relax(g + 1, kf, TAG_SKIP);
          },
          (s) => s === goalState,
        );
        if (sp.goal < 0) return tb.done({ stepIndex: si, reason: `“${name}” cannot be reached with Tab and Shift+Tab.` });
        path = pathEdges(sp, sp.goal);
      }
      for (const e of path) {
        const stopId = page.focusOrder[e.to - 1];
        const desc = announce(page.nodes[stopId]);
        if (e.tag === TAG_TAB) tb.event("tab", stopId, `Tab → ${desc}`, { Kf: 1 });
        else if (e.tag === TAG_SHIFT_TAB) tb.event("shiftTab", stopId, `Shift+Tab → ${desc}`, { Kf: 1 });
        else {
          const link = page.nodes[page.focusOrder[e.from - 1]];
          tb.event("activate", stopId, `Enter → skip link “${clip(nodeName(link), 40)}” → ${desc}`, { Kf: 1 });
        }
      }
    }
    cur = f;
    // Focusing scrolls the element into view for free.
    if (node.rect) {
      const move = scrollTo(page, scrollY, node.rect);
      if (move) scrollY = move.scrollY;
    }

    if (step.action === "type") {
      const text = step.text ?? "";
      // The field already has focus after Tab: no activation key, just the characters.
      tb.event("type", node.id, `Type “${clip(text, 30)}”`, { chars: text.length });
    } else {
      const key = step.action === "select" ? "Space" : "Enter";
      tb.event("activate", node.id, `${key} → ${announce(node)}`, { Kf: 1 });
    }
    tb.end();
  }
  return tb.done();
}
