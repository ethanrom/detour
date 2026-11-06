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

/** Reading position of the last stop attributed to the block, or -1. */
function lastStopOf(idx: PageIndex, blockId: NodeId): number {
  const ro = idx.page.readingOrder;
  for (let i = ro.length - 1; i >= 0; i--) if (idx.blockOf(ro[i]) === blockId) return i;
  return -1;
}

/**
 * "; 24 of them are in the navigation menu, which has no skip link" (or "" when no block dominates).
 * The skip-link tail is only attached to navigation landmarks and repetitive blocks, never when the
 * path itself used a skip link, and never when some skip link lands after the block.
 */
function blockClause(idx: PageIndex, nodeIds: NodeId[], lead: string, verb = "are in", usedSkipLink = false): string {
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
  if ((block.landmark === "navigation" || block.hints.repetitiveBlock === true) && !usedSkipLink) {
    const last = lastStopOf(idx, top);
    if (idx.page.skipLinks.length === 0) skip = ", which has no skip link";
    else if (!idx.page.skipLinks.some((sl) => idx.resolveStop(sl.to) > last)) skip = ", which no skip link bypasses";
  }
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

/** Targets the screen-reader user activates or selects that are fake controls (the user must verify them). */
export function verifiedControls(idx: PageIndex, task: Task): A11yNode[] {
  const out: A11yNode[] = [];
  for (const s of task.steps) {
    const n = idx.page.nodes[s.target];
    if (n && (s.action === "activate" || s.action === "select") && n.hints.fakeButton && !out.includes(n)) out.push(n);
  }
  return out;
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
  if (task.steps.length === 0) return ["The task has no steps, so there is nothing to time."];
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
        out.push(`A screen-reader user hears ${plural(heard.length, "announcement", "announcements")} before reaching “${final}” (${fmtSeconds(sr.seconds)} s)${clause}.`);
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
        const fakes = verifiedControls(idx, task);
        if (fakes.length === 1) {
          out.push(`“${clip(nodeName(fakes[0]), 40)}” is a clickable <${fakes[0].tag}>: the screen reader announces no role or selected state, so the user has to re-check it.`);
        } else if (fakes.length > 1) {
          out.push(`${fakes.map((n) => `“${clip(nodeName(n), 40)}”`).join(" and ")} are clickable elements: the screen reader announces no role or state, so the user has to re-check each one.`);
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
          out.push(`A keyboard user presses Tab ${plural(stops.length, "time", "times")}${via} before reaching “${final}” (${fmtSeconds(kb.seconds)} s)${blockClause(idx, stops, "; ", "are in", skips > 0)}.`);
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
