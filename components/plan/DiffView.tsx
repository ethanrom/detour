import type { HtmlPatch } from "@/lib/contracts";
import { diffHtml, type DiffKind } from "@/lib/ui/diff";

const STYLE: Record<DiffKind, { row: string; mark: string; word: string }> = {
  add: { row: "bg-add-bg text-add-fg border-add-fg", mark: "+", word: "Added: " },
  del: { row: "bg-del-bg text-del-fg border-del-fg", mark: "−", word: "Removed: " },
  ctx: { row: "text-ink border-transparent", mark: " ", word: "Unchanged: " },
};

/** Red/green diff that never relies on colour alone: each line has a +/− marker and a left rule. Real code, so monospace. */
export function DiffView({ patch }: { patch: HtmlPatch }) {
  const lines = diffHtml(patch.before, patch.after);
  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-rule bg-surface">
      <figcaption className="flex items-center justify-between gap-3 border-b border-rule px-3 py-1.5 text-[0.8125rem]">
        <span className="font-medium">HTML change</span>
        <code className="truncate font-mono text-muted">{patch.selector}</code>
      </figcaption>
      <div role="group" aria-label={`Code change for ${patch.selector}`} className="overflow-x-auto py-1 font-mono text-[0.8125rem] leading-6">
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
