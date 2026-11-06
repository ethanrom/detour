// Plain-English explanation of a task result, built only from the traces (never an LLM).
// Up to four sentences: the screen-reader cost (with the repetitive block that causes most of it),
// optionally the slowest alternative screen-reader strategy, the keyboard cost, the mouse cost.

import type { A11yNode, NodeId, PersonaResult, PersonaId, StrategyResult, Task, TraceEvent } from "@/lib/contracts";
import { clip, nodeName, stepPhrase } from "./describe";
import type { PageIndex } from "./pageindex";
import type { ScreenReaderStrategy } from "./screenreader";

const USING: Record<ScreenReaderStrategy, string> = {
  headings: "Navigating by headings",
  find: "Using find",
  linear: "Reading straight down with the arrow key",
  landmarks: "Jumping by landmarks",
  tab: "Using the Tab key",
};

export function fmtSeconds(s: number): string {
  return s.toFixed(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "the navigation menu", "the page footer", ... */
export function describeBlock(n: A11yNode): string {
  switch (n.landmark) {
    case "navigation":
      return "the navigation menu";
    case "banner":
      return "the page header";
    case "main":
      return "the main content";
    case "contentinfo":
      return "the page footer";
    case "complementary":
      return "the sidebar";
    case "search":
      return "the search area";
    case "form":
      return "a form";
    case "region":
      return n.name.trim() ? `the “${clip(n.name, 30)}” region` : "a region";
    default:
      break;
  }
  switch (n.tag) {
    case "nav":
      return "the navigation menu";
    case "footer":
      return "the page footer";
    case "header":
      return "the page header";
    case "aside":
      return "the sidebar";
    default:
      return "a long repeated block";
  }
}

/** True when some skip link starts before the block and lands after it. */
function bypassed(idx: PageIndex, blockId: NodeId): boolean {
  const ro = idx.page.readingOrder;
  let first = -1;
  let last = -1;
  for (let i = 0; i < ro.length; i++) {
    if (idx.blockOf(ro[i]) === blockId) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return false;
  return idx.page.skipLinks.some((sl) => {
    const from = idx.resolveStop(sl.from);
    const to = idx.resolveStop(sl.to);
    return from >= 0 && to >= 0 && from < first && to > last;
  });
}

/** "; 24 of them are in the navigation menu, which has no skip link" (or "" when no block dominates). */
function blockClause(idx: PageIndex, nodeIds: NodeId[], lead: string, verb = "are in"): string {
  const counts = new Map<NodeId, number>();
  for (const id of nodeIds) {
    const b = idx.blockOf(id);
    if (b !== null) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let top: NodeId | null = null;
  let topCount = 0;
  for (const [b, c] of counts) {
    if (c > topCount) {
      top = b;
      topCount = c;
    }
  }
  if (top === null || topCount < 3 || topCount < 0.3 * nodeIds.length) return "";
  const block = idx.page.nodes[top];
  let skip = "";
  if (idx.page.skipLinks.length === 0) skip = ", which has no skip link";
  else if (!bypassed(idx, top)) skip = ", which no skip link bypasses";
  return `${lead}${topCount} of them ${verb} ${describeBlock(block)}${skip}`;
}

function allEvents(s: StrategyResult): TraceEvent[] {
  return s.steps.flatMap((st) => st.events);
}

/** Announcements heard on the way (not the targets, not the page title). */
function skippedAnnouncements(s: StrategyResult): NodeId[] {
  const out: NodeId[] = [];
  for (const e of allEvents(s)) if (e.utterance && e.command !== "think" && e.utterance.truncated) out.push(e.utterance.nodeId);
  return out;
}

function finalTargetName(idx: PageIndex, task: Task): string {
  const last = task.steps[task.steps.length - 1];
  const n = last ? idx.page.nodes[last.target] : undefined;
  return n ? clip(nodeName(n), 40) : "the target";
}

function blockedSentence(who: string, idx: PageIndex, task: Task, r: PersonaResult): string {
  const b = r.blocked!;
  const step = task.steps[b.stepIndex];
  const node = step ? idx.page.nodes[step.target] : undefined;
  const phrase = step ? stepPhrase(step, node ? nodeName(node) : step.target) : "complete the task";
  return `${who} cannot ${phrase}. ${b.reason}`;
}

function strategyOf(r: PersonaResult, id: string): StrategyResult | undefined {
  return r.strategies.find((s) => s.strategy === id);
}

/** Deterministic explanation sentences for one task. */
export function explain(idx: PageIndex, task: Task, personas: Partial<Record<PersonaId, PersonaResult>>): string[] {
  const out: string[] = [];
  const final = finalTargetName(idx, task);

  const sr = personas.screenreader;
  if (sr) {
    if (sr.blocked) {
      out.push(blockedSentence("A screen-reader user", idx, task, sr));
    } else {
      const rep = strategyOf(sr, sr.representative);
      if (rep) {
        const heard = skippedAnnouncements(rep);
        const clause = blockClause(idx, heard, "; ");
        out.push(`A screen-reader user hears ${plural(heard.length, "announcement", "announcements")} before reaching “${final}”${clause} (${fmtSeconds(sr.seconds)} s).`);
        // Slowest alternative strategy that people actually use.
        let slow: StrategyResult | undefined;
        for (const s of sr.strategies) {
          if (s.blocked || s.strategy === sr.representative || (sr.weights[s.strategy] ?? 0) <= 0) continue;
          if (!slow || s.seconds > slow.seconds) slow = s;
        }
        if (slow && slow.seconds >= 1.5 * rep.seconds) {
          const heardSlow = skippedAnnouncements(slow);
          const c = blockClause(idx, heardSlow, ", ", "in");
          const lead = USING[slow.strategy as ScreenReaderStrategy] ?? "Another strategy";
          out.push(`${lead} instead takes ${fmtSeconds(slow.seconds)} s: ${plural(heardSlow.length, "announcement", "announcements")}${c}.`);
        }
      }
    }
  }

  const kb = personas.keyboard;
  if (kb) {
    if (kb.blocked) {
      out.push(blockedSentence("A keyboard user", idx, task, kb));
    } else {
      const tr = strategyOf(kb, kb.representative);
      if (tr) {
        const events = allEvents(tr);
        const stops = events.filter((e) => (e.command === "tab" || e.command === "shiftTab") && e.nodeId !== null).map((e) => e.nodeId as NodeId);
        const skips = events.filter((e) => e.command === "activate" && e.label.startsWith("Enter → skip link")).length;
        const scrolls = events.filter((e) => e.command === "scroll").length;
        if (stops.length > 0) {
          const via = skips > 0 ? " and uses a skip link" : "";
          out.push(`A keyboard user presses Tab ${plural(stops.length, "time", "times")}${via} before reaching “${final}”${blockClause(idx, stops, "; ")} (${fmtSeconds(kb.seconds)} s).`);
        } else if (scrolls > 0) {
          out.push(`A keyboard user scrolls ${plural(scrolls, "screen", "screens")} to reach “${final}” (${fmtSeconds(kb.seconds)} s).`);
        } else {
          out.push(`A keyboard user needs ${fmtSeconds(kb.seconds)} s.`);
        }
      }
    }
  }

  const mouse = personas.mouse;
  if (mouse) {
    if (mouse.blocked) out.push(blockedSentence("The mouse user", idx, task, mouse));
    else out.push(`The mouse user needs ${fmtSeconds(mouse.seconds)} s.`);
  }
  return out;
}
