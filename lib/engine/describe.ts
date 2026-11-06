// Deterministic wording helpers shared by the planners and the explanation builder.

import type { A11yNode, NodeId, StepAction, TaskStep } from "@/lib/contracts";
import type { PageIndex } from "./pageindex";

export function clip(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Best human name for a node: accessible name, else visual label, else its id. */
export function nodeName(n: A11yNode): string {
  return n.name.trim() || n.hints.visualLabel?.trim() || n.id;
}

/** True for steps that operate a control (as opposed to reading content). */
export function isOperation(action: StepAction): boolean {
  return action !== "read";
}

/** One or two words naming what kind of control this is. */
export function roleNoun(n: A11yNode): string {
  switch (n.role) {
    case "link":
      return "link";
    case "button":
      return "button";
    case "textbox":
    case "searchbox":
      return "field";
    case "checkbox":
      return "check box";
    case "radio":
      return "radio button";
    case "combobox":
      return "drop-down";
    case "heading":
      return "heading";
    default:
      return n.hints.fakeButton ? "control" : n.role;
  }
}

const LABEL_FILLER = new Set(["select", "choose", "pick", "enter", "your", "a", "an", "the", "please"]);

/** "Size: Select a size" -> "size"; "Select a size" -> "size"; long prose -> null. */
function nounFromLabel(text: string): string | null {
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  const colon = lower.indexOf(":");
  const head = (colon > 0 ? lower.slice(0, colon) : lower).replace(/[*]/g, " ");
  const words = head.split(/\s+/).filter(Boolean);
  while (words.length && LABEL_FILLER.has(words[0])) words.shift();
  const max = colon > 0 ? 2 : 3;
  return words.length > 0 && words.length <= max ? words.join(" ") : null;
}

/** True when the subtree of node `id` holds at least two reading stops. */
function isGroup(idx: PageIndex, id: string): boolean {
  let found = 0;
  const stack = [id];
  while (stack.length && found < 2) {
    const cur = stack.pop()!;
    if (idx.readPos.has(cur)) found++;
    const n = idx.page.nodes[cur];
    if (n) for (const c of n.children) stack.push(c);
  }
  return found >= 2;
}

/**
 * What a group of controls is for. The group is the nearest ancestor holding two or more reading
 * stops (the options of a picker); its label is the closest *preceding* non-interactive text,
 * looked for within three stops before the group's first member ("Size: Select a size" -> "size").
 * When the task step has a note ("Choose size M") the noun must appear in it. Null when unsure:
 * a missing noun is better than a wrong one.
 */
export function contextNoun(idx: PageIndex, node: A11yNode, note?: string): string | null {
  let group: A11yNode | undefined = node.parentId ? idx.page.nodes[node.parentId] : undefined;
  for (let depth = 0; group && depth < 3 && !isGroup(idx, group.id); depth++) group = group.parentId ? idx.page.nodes[group.parentId] : undefined;
  if (!group || !isGroup(idx, group.id)) return null;
  const first = idx.resolveStop(group.id);
  for (let j = first - 1, looked = 0; j >= 0 && looked < 3; j--, looked++) {
    const n = idx.page.nodes[idx.page.readingOrder[j]];
    if (!n || n.actionable || !n.name.trim()) continue;
    const noun = nounFromLabel(n.name);
    if (!noun) return null;
    if (note && !note.toLowerCase().includes(noun)) return null;
    return noun;
  }
  return null;
}

/** Why the keyboard cannot reach this node, e.g. "it is a clickable <div> that cannot receive focus." */
function whyNotFocusable(n: A11yNode): string {
  if (n.hints.fakeButton) return `it is a clickable <${n.tag}> that cannot receive focus.`;
  if (n.states.includes("disabled")) return "it is disabled.";
  if (n.tabIndex !== null && n.tabIndex < 0) return `it has tabindex="${n.tabIndex}", so Tab skips it.`;
  return `it is a <${n.tag}> that is not in the keyboard focus order.`;
}

/** Reason a keyboard-only user cannot operate `node`. */
export function keyboardBlockReason(idx: PageIndex, node: A11yNode, action: StepAction, note?: string): string {
  const name = nodeName(node);
  let subject: string;
  if (action === "select") {
    const ctx = contextNoun(idx, node, note);
    subject = ctx ? `The ${ctx} picker option “${clip(name, 40)}”` : `The option “${clip(name, 40)}”`;
  } else if (action === "type") {
    subject = `The “${clip(name, 40)}” field`;
  } else {
    subject = `The “${clip(name, 40)}” ${roleNoun(node)}`;
  }
  return `${subject} can't be reached with the keyboard: ${whyNotFocusable(node)}`;
}

/** True when a screen-reader user could not tell what this control is. */
export function isUnlabeledControl(n: A11yNode): boolean {
  return n.actionable && (n.hints.unlabeled === true || n.name.trim() === "");
}

/** Reason a screen-reader user cannot operate an unnamed control. */
export function unlabeledReason(n: A11yNode): string {
  const vl = n.hints.visualLabel?.trim() ?? "";
  let what: string;
  if (!vl) what = "what it does";
  else if (vl.split(/\s+/).length <= 2) what = `it is the ${vl.toLowerCase()}`;
  else what = `what it does (visually it reads “${clip(vl, 40)}”)`;
  return `“${roleNoun(n)}” has no name, so a screen-reader user cannot tell ${what}.`;
}

/** "choose size M" from a note "Choose size M"; falls back to "<verb> “name”". */
export function stepPhrase(step: TaskStep, name: string): string {
  const note = step.note?.trim();
  if (note) return note.charAt(0).toLowerCase() + note.slice(1);
  const verb = step.action === "type" ? "type into" : step.action === "select" ? "select" : step.action === "read" ? "read" : "activate";
  return `${verb} “${clip(name, 40)}”`;
}

export function missingTargetReason(id: NodeId): string {
  return `The target “${clip(id, 40)}” is not on the page.`;
}
