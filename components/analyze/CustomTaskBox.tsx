"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import type { PageModel, Task } from "@/lib/contracts";

export type CustomState =
  | { siteId: string; status: "idle" }
  | { siteId: string; status: "working"; text: string }
  | { siteId: string; status: "done"; text: string; task: Task }
  | { siteId: string; status: "unavailable"; text: string }
  | { siteId: string; status: "error"; text: string; error: string };

const MAX_TEXT = 200; // the server rejects longer task descriptions

const ACTION_VERB: Record<string, string> = { activate: "Press", select: "Choose", type: "Type into", read: "Read" };

function describeStep(page: PageModel | undefined, step: Task["steps"][number]): string {
  const n = page?.nodes[step.target];
  const verb = ACTION_VERB[step.action] ?? step.action;
  if (!n) return `${verb} ${step.target}`;
  const name = n.name.trim() || n.hints.visualLabel?.trim() || "";
  const what = n.role === "generic" || n.role === "text" || n.role === "paragraph" ? n.tag : n.role;
  const typed = step.action === "type" && step.text ? ` “${step.text}”` : "";
  return `${verb}${typed} ${what}${name ? ` “${name.length > 60 ? `${name.slice(0, 59)}…` : name}”` : ""}`;
}

/** Ground a sentence on the page with the LLM (validated), then run it like any other task. */
export function CustomTaskBox({ state, page, busy, onSubmit }: { state: CustomState; page?: PageModel; busy: boolean; onSubmit: (text: string) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const working = state.status === "working";

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim().replace(/\s+/g, " ");
    if (t && !busy) onSubmit(t);
  }

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-xl border border-rule bg-surface p-4">
      <h3 id={`${id}-h`} className="text-sm font-bold">
        Describe a task in your own words
      </h3>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={`${id}-t`} className="sr-only">
            Task, in your own words
          </label>
          <input
            id={`${id}-t`}
            type="text"
            value={text}
            maxLength={MAX_TEXT}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: find out how to contact the store"
            autoComplete="off"
            aria-describedby={`${id}-s`}
            className="min-h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-[0.9375rem] placeholder:text-muted"
          />
        </div>
        <button type="submit" className="btn btn-sm" disabled={busy || !text.trim()} aria-busy={working}>
          {working ? "Grounding…" : "Ground and run"}
          <ArrowRightIcon size={14} />
        </button>
      </form>

      <div id={`${id}-s`} role="status" aria-live="polite" className="mt-3 text-sm">
        {state.status === "working" && <p className="animate-pulse text-muted">Claude is matching your words to elements on this page…</p>}
        {state.status === "unavailable" && (
          <p className="rounded-lg border border-rule-strong bg-paper-2 p-3">
            <strong>Custom tasks need the LLM (Bedrock) configured.</strong> The built-in tasks above run without it. The model only ever picks which
            elements a task touches; it never produces a number.
          </p>
        )}
        {state.status === "error" && <p className="rounded-lg border border-blocked bg-surface p-3 text-blocked">{state.error}</p>}
        {state.status === "done" && (
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-lime px-2.5 py-0.5 font-bold">
              <CheckIcon size={14} /> Grounded by Claude (Bedrock), validated against the page
            </p>
            <p className="mt-2 font-semibold">{state.task.label}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted">
              {state.task.steps.map((s, i) => (
                <li key={`${s.target}-${i}`}>
                  {describeStep(page, s)} <code className="rounded bg-paper-2 px-1 font-mono text-xs">{s.target}</code>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
