"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { ExternalIcon } from "@/components/icons";
import type { A11yNode, PageModel } from "@/lib/contracts";
import { sourceUrl } from "@/lib/ui/any-url";
import type { SiteInfo } from "@/lib/ui/datasource";
import { createOverlay, lockNavigation, scrollNodeIntoView, startPicking } from "@/lib/ui/page-picker";

const FRAME_W = 1280;
const FRAME_H = 800;

type Status = "checking" | "ok" | "missing";

/** Pick mode: the preview follows the pointer, outlines the node under it and reports clicks. */
export interface PickProps {
  active: boolean;
  /** The page model the preview was read into; pick mode needs it to map elements to nodes. */
  page?: PageModel;
  onHover: (node: A11yNode | null) => void;
  onPick: (node: A11yNode) => void;
  onCancel: () => void;
  /** Outline this node and scroll it into view (the option the keyboard user is on). */
  highlight?: A11yNode | null;
}

interface Props {
  site: SiteInfo;
  /** Handed to DataSource.analyze() so the extractor can read the rendered DOM. */
  frameRef: RefObject<HTMLIFrameElement | null>;
  pick?: PickProps;
}

function frameDocument(frame: HTMLIFrameElement | null): Document | null {
  try {
    const doc = frame?.contentDocument ?? null;
    return doc?.body ? doc : null;
  } catch {
    return null;
  }
}

export function SitePreview({ site, frameRef, pick }: Props) {
  const isUrl = site.kind === "url";
  const [status, setStatus] = useState<{ path: string; value: Status }>({ path: "", value: "checking" });
  const [scale, setScale] = useState(0.4);
  const box = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const pickPage = pick?.page;
  const picking = !!pick?.active && !!pickPage;
  const highlight = pick?.highlight ?? null;
  const onHover = useEffectEvent((n: A11yNode | null) => pick?.onHover(n));
  const onChoose = useEffectEvent((n: A11yNode) => pick?.onPick(n));
  const onCancel = useEffectEvent(() => pick?.onCancel());

  // Pick mode: hover outlines, a click chooses. Escape (here or inside the page) leaves it.
  useEffect(() => {
    if (!picking || !pickPage) return;
    const doc = frameDocument(frameRef.current);
    if (!doc) return;
    const stop = startPicking({ doc, page: pickPage, scale: () => scaleRef.current, onHover: (n) => onHover(n), onPick: (n) => onChoose(n), onCancel: () => onCancel() });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [picking, pickPage, frameRef]);

  // The option the keyboard user is on: show where it is on the page.
  useEffect(() => {
    if (!highlight) return;
    const doc = frameDocument(frameRef.current);
    if (!doc) return;
    const overlay = createOverlay(doc, () => scaleRef.current);
    scrollNodeIntoView(doc, highlight);
    overlay.show(highlight);
    return () => overlay.destroy();
  }, [highlight, frameRef]);

  // Is the page actually there? An <iframe> fires "load" for 404 pages too, so ask first. Pages from the
  // proxy were just checked (mode=check); asking again would make the server fetch the page a second time.
  useEffect(() => {
    if (isUrl) return;
    let alive = true;
    fetch(site.path, { method: "HEAD", cache: "no-store" })
      .then((r) => alive && setStatus({ path: site.path, value: r.ok ? "ok" : "missing" }))
      .catch(() => alive && setStatus({ path: site.path, value: "missing" }));
    return () => {
      alive = false;
    };
  }, [site.path, isUrl]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / FRAME_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current: Status = isUrl ? "ok" : status.path === site.path ? status.value : "checking";
  const address = isUrl ? sourceUrl(site) : site.path;

  return (
    <figure className="m-0">
      <div className={`overflow-hidden rounded-lg border bg-surface ${picking ? "border-ink" : "border-rule"}`}>
        <div className="flex h-9 items-center gap-2 border-b border-rule bg-paper px-3" aria-hidden="true">
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">{address}</span>
          {picking && <span className="shrink-0 rounded bg-lime px-2 py-0.5 text-[0.8125rem] font-medium text-ink">Pick mode</span>}
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
              // Pages from the proxy get no scripts at all. allow-same-origin keeps the document readable for the extractor.
              sandbox={isUrl ? "allow-same-origin" : undefined}
              referrerPolicy={isUrl ? "no-referrer" : undefined}
              // The preview is for looking at. The page is analysed, not operated, so keep it out of the tab order
              // and away from the pointer. Only pick mode lets the pointer in.
              inert={!picking}
              onLoad={isUrl ? (e) => {
                const doc = frameDocument(e.currentTarget);
                if (doc) lockNavigation(doc);
              } : undefined}
              className="absolute left-0 top-0 border-0 bg-white"
              style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
          ) : (
            <Placeholder checking={current === "checking"} path={site.path} />
          )}
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-muted">
        <span>
          {current === "ok"
            ? picking
              ? "Pick mode: point at the page and click an element to choose it. Escape leaves pick mode."
              : isUrl
                ? "Live preview at 1280 × 800, scaled to fit. Scripts are off."
                : "Live preview at 1280 × 800, scaled to fit. Read-only."
            : current === "checking"
              ? "Checking the page…"
              : "Preview unavailable; sample data is used."}
        </span>
        {current === "ok" && (
          <a className="inline-flex min-h-6 items-center gap-1 font-medium text-ink" href={address} target="_blank" rel="noopener noreferrer">
            {isUrl ? "Open original page" : "Open page"} <ExternalIcon />
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
        <rect x="14" y="14" width="292" height="16" rx="4" fill="#dde4e8" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={14 + i * 36} y="40" width="30" height="8" rx="3" fill="#d0d9de" />
        ))}
        <rect x="14" y="62" width="130" height="110" rx="6" fill="#dde4e8" />
        <rect x="160" y="62" width="100" height="12" rx="4" fill="#d0d9de" />
        <rect x="160" y="82" width="146" height="8" rx="3" fill="#dde4e8" />
        <rect x="160" y="96" width="120" height="8" rx="3" fill="#dde4e8" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={160 + i * 30} y="120" width="24" height="24" rx="4" fill="#d0d9de" />
        ))}
        <rect x="160" y="154" width="120" height="20" rx="10" fill="#c3ccd1" />
      </svg>
      <p className="relative max-w-[16rem] rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink">
        <strong>{checking ? "Loading preview…" : "Preview not available"}</strong>
        {!checking && (
          <span className="mt-0.5 block text-[0.8125rem] text-muted">
            <code>{path}</code> did not load. The analysis below still runs on sample data.
          </span>
        )}
      </p>
    </div>
  );
}
