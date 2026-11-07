import type { HtmlPatch } from "@/lib/contracts";
import { diffHtml, type DiffKind } from "@/lib/ui/diff";
import { cssLines } from "@/lib/ui/fix-run";

const STYLE: Record<DiffKind, { row: string; mark: string; word: string }> = {
  add: { row: "bg-add-bg text-add-fg border-add-fg", mark: "+", word: "Added: " },
  del: { row: "bg-del-bg text-del-fg border-del-fg", mark: "−", word: "Removed: " },
  ctx: { row: "text-ink border-transparent", mark: " ", word: "Unchanged: " },
};

/** Height of a diff of `lines` lines, in rem: the caption plus the lines. Used to hold the space before the diff arrives. */
export function diffHeightRem(lines: number): number {
  return 2.25 + 0.5 + Math.min(lines, 10) * 1.5;
}

/** Red/green diff that never relies on colour alone: each line has a +/− marker and a left rule. Real code, so monospace. */
export function DiffView({ patch }: { patch: HtmlPatch }) {
  const lines = diffHtml(patch.before, patch.after);
  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-rule bg-surface">
      <figcaption className="flex items-center justify-between gap-3 border-b border-rule px-3 py-1.5 text-[0.8125rem]">
        <span className="font-medium">HTML change</span>
        <code className="truncate font-mono text-muted">{patch.selector}</code>
      </figcaption>
      {/* Focusable so the keyboard can scroll it when a long line or a long diff overflows. */}
      <div
        role="group"
        aria-label={`Code change for ${patch.selector}`}
        tabIndex={0}
        className="max-h-64 overflow-auto py-1 font-mono text-[0.8125rem] leading-6"
      >
        {lines.map((l, i) => {
          const s = STYLE[l.kind];
          return (
            <div key={i} className={`grid min-w-max grid-cols-[1.75rem_1fr] border-l-4 pr-3 ${s.row}`}>
              <span aria-hidden="true" className="select-none text-center font-semibold">
                {s.mark}
              </span>
              <span className="whitespace-pre">
                <span className="sr-only">{s.word}</span>
                {l.text || " "}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** The CSS an edit added: every line is an addition, so the same +/− treatment applies. */
export function CssView({ css }: { css: string }) {
  const lines = cssLines(css).split("\n");
  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-rule bg-surface">
      <figcaption className="border-b border-rule px-3 py-1.5 text-[0.8125rem] font-medium">CSS added</figcaption>
      <div role="group" aria-label="CSS added by this fix" tabIndex={0} className="max-h-64 overflow-auto py-1 font-mono text-[0.8125rem] leading-6">
        {lines.map((l, i) => (
          <div key={i} className={`grid min-w-max grid-cols-[1.75rem_1fr] border-l-4 pr-3 ${STYLE.add.row}`}>
            <span aria-hidden="true" className="select-none text-center font-semibold">
              {STYLE.add.mark}
            </span>
            <span className="whitespace-pre">
              <span className="sr-only">{STYLE.add.word}</span>
              {l || " "}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
