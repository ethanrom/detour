"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { ExternalIcon } from "@/components/icons";
import type { SiteInfo } from "@/lib/ui/datasource";

const FRAME_W = 1280;
const FRAME_H = 800;

type Status = "checking" | "ok" | "missing";

interface Props {
  site: SiteInfo;
  /** Handed to DataSource.analyze() so the extractor can read the rendered DOM. */
  frameRef: Ref<HTMLIFrameElement>;
}

export function SitePreview({ site, frameRef }: Props) {
  const [status, setStatus] = useState<{ path: string; value: Status }>({ path: "", value: "checking" });
  const [scale, setScale] = useState(0.4);
  const box = useRef<HTMLDivElement>(null);

  // Is the page actually there? An <iframe> fires "load" for 404 pages too, so ask first.
  useEffect(() => {
    let alive = true;
    fetch(site.path, { method: "HEAD", cache: "no-store" })
      .then((r) => alive && setStatus({ path: site.path, value: r.ok ? "ok" : "missing" }))
      .catch(() => alive && setStatus({ path: site.path, value: "missing" }));
    return () => {
      alive = false;
    };
  }, [site.path]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / FRAME_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current: Status = status.path === site.path ? status.value : "checking";

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border-2 border-ink bg-surface">
        <div className="flex h-8 items-center gap-1.5 border-b-2 border-ink bg-paper-2 px-3" aria-hidden="true">
          <span className="size-2.5 rounded-full border border-ink" />
          <span className="size-2.5 rounded-full border border-ink" />
          <span className="size-2.5 rounded-full border border-ink" />
          <span className="ml-2 truncate rounded bg-surface px-2 py-0.5 font-mono text-[0.6875rem] text-muted">{site.path}</span>
        </div>
        <div ref={box} className="relative w-full overflow-hidden bg-paper-2" style={{ height: FRAME_H * scale }}>
          {current === "ok" ? (
            <iframe
              ref={frameRef}
              src={site.path}
              title={`Preview of ${site.name}`}
              width={FRAME_W}
              height={FRAME_H}
              tabIndex={-1}
              // The preview is for looking at. The page is analysed, not operated, so keep it out of the tab order.
              inert
              className="absolute left-0 top-0 border-0 bg-white"
              style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
          ) : (
            <Placeholder checking={current === "checking"} path={site.path} />
          )}
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {current === "ok" ? "Live preview at 1280 × 800, scaled to fit. Read-only." : current === "checking" ? "Checking the page…" : "Preview unavailable; sample data is used."}
        </span>
        {current === "ok" && (
          <a className="inline-flex min-h-6 items-center gap-1 font-semibold text-ink" href={site.path} target="_blank" rel="noopener noreferrer">
            Open page <ExternalIcon />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </figcaption>
    </figure>
  );
}

function Placeholder({ checking, path }: { checking: boolean; path: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center">
      <svg viewBox="0 0 320 200" className="absolute inset-0 size-full opacity-60" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <rect x="14" y="14" width="292" height="16" rx="4" fill="#d9d3c4" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={14 + i * 36} y="40" width="30" height="8" rx="3" fill="#cfc8b6" />
        ))}
        <rect x="14" y="62" width="130" height="110" rx="6" fill="#d9d3c4" />
        <rect x="160" y="62" width="100" height="12" rx="4" fill="#cfc8b6" />
        <rect x="160" y="82" width="146" height="8" rx="3" fill="#d9d3c4" />
        <rect x="160" y="96" width="120" height="8" rx="3" fill="#d9d3c4" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={160 + i * 30} y="120" width="24" height="24" rx="4" fill="#cfc8b6" />
        ))}
        <rect x="160" y="154" width="120" height="20" rx="10" fill="#bdb59f" />
      </svg>
      <p className="relative max-w-[16rem] rounded-lg bg-surface/95 px-3 py-2 text-sm text-ink shadow">
        <strong>{checking ? "Loading preview…" : "Preview not available"}</strong>
        {!checking && (
          <span className="mt-0.5 block text-xs text-muted">
            <code className="font-mono">{path}</code> did not load. The analysis below still runs on sample data.
          </span>
        )}
      </p>
    </div>
  );
}
