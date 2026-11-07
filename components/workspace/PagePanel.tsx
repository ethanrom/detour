"use client";

import { ExternalIcon } from "@/components/icons";
import { sourceUrl } from "@/lib/ui/any-url";
import { PageFrame } from "./PageFrame";
import { Bars, Panel, Segmented } from "./ui";
import type { WorkbenchApi } from "./useWorkbench";

const VERSIONS = [
  { value: "original", label: "Original" },
  { value: "fixed", label: "Fixed" },
] as const;

/** The Page column: the live preview, the Original | Fixed switch after a run, and the link to the real page. */
export function PagePanel({ wb, fill, className, onClose }: { wb: WorkbenchApi; fill: boolean; className?: string; onClose?: () => void }) {
  const { site, fixed, pick, ready } = wb;
  const address = site ? (site.kind === "url" ? sourceUrl(site) : site.path) : "";

  const actions = (
    <>
      {fixed &&
        (fixed.busy ? (
          <span role="status" className="text-xs text-muted">
            Fixing the page…
          </span>
        ) : (
          <>
            <Segmented
              label="Page version"
              name="page-version"
              options={VERSIONS}
              value={fixed.shown}
              onChange={(v) => {
                if (v !== fixed.shown) fixed.onToggle();
              }}
            />
            <span role="status" className="sr-only">
              {fixed.shown === "fixed" ? "Showing the fixed page." : "Showing the original page."}
            </span>
          </>
        ))}
      {site && (
        <a className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-ink" href={address} target="_blank" rel="noopener noreferrer">
          Open page <ExternalIcon />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      {onClose && (
        <button type="button" id="page-close" className="btn btn-sm xl:hidden!" onClick={onClose}>
          Close
        </button>
      )}
    </>
  );

  return (
    // The frame is 1280 × 800 whatever the panel's size (the engine's scroll model reads that height), so the panel is
    // as tall as the scaled frame needs. Only the pick overlay is as tall as the column.
    <Panel title="Page" actions={actions} className={`${fill ? "lg:h-full" : ""} ${className ?? ""}`} bodyClassName="flex flex-col p-0">
      {site ? (
        <>
          <p className="shrink-0 truncate px-4 py-2 text-xs leading-4 text-muted" title={address}>
            {address}
          </p>
          <PageFrame
            key={site.id}
            site={site}
            frameRef={wb.frameRef}
            fill={fill}
            pick={
              site.kind === "url"
                ? {
                    active: pick.active,
                    page: ready?.page,
                    onHover: pick.onHover,
                    onPick: (n) => void pick.choose(n.id),
                    onCancel: pick.onCancel,
                    highlight: pick.highlight,
                  }
                : undefined
            }
          />
        </>
      ) : (
        <div className="p-4">
          <Bars widths={["70%", "40%"]} />
        </div>
      )}
    </Panel>
  );
}
