"use client";

// The live preview of the page: the iframe the extractor reads, scaled to the room the Page panel has. The iframe
// keeps its 1280 × 800 viewport whatever the panel's size: the engine's scroll model reads that height, so a taller
// frame would change the predicted seconds. Pick mode and the highlight work as they did in SitePreview.

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { A11yNode, PageModel } from "@/lib/contracts";
import type { SiteInfo } from "@/lib/ui/datasource";
import { frameDocument } from "@/lib/ui/fix-page";
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
  /** The panel is as tall as the column (a drawer, or the pick overlay) rather than as tall as the frame. */
  fill?: boolean;
}

export function PageFrame({ site, frameRef, pick, fill }: Props) {
  const isUrl = site.kind === "url";
  const [status, setStatus] = useState<{ path: string; value: Status }>({ path: "", value: "checking" });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);

  // Fit the whole 1280 × 800 frame into the box; centre it when the box is wider than the scaled frame.
  const fitW = size.w / FRAME_W;
  const scale = size.w > 0 ? (size.h > 0 ? Math.min(fitW, size.h / FRAME_H) : fitW) : 0.3;
  const offsetX = Math.max(0, (size.w - FRAME_W * scale) / 2);
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
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current: Status = isUrl ? "ok" : status.path === site.path ? status.value : "checking";

  return (
    <>
      <div
        ref={box}
        // The frame's own 8:5 shape, so the panel is as tall as the preview needs. Filling (the pick overlay): all the room there is.
        className={`relative aspect-[8/5] shrink-0 overflow-hidden bg-paper-2 ${fill ? "xl:aspect-auto xl:min-h-40 xl:flex-1" : ""}`}
      >
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
            onLoad={
              isUrl
                ? (e) => {
                    const doc = frameDocument(e.currentTarget);
                    if (doc) lockNavigation(doc);
                  }
                : undefined
            }
            className="absolute top-0 border-0 bg-white"
            style={{ left: offsetX, width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: "top left" }}
          />
        ) : (
          <Placeholder checking={current === "checking"} path={site.path} />
        )}
      </div>
      <p className="shrink-0 border-t border-rule px-4 py-2 text-xs leading-4 text-muted">
        {current === "ok"
          ? picking
            ? "Pick mode: point at the page and click an element to choose it. Escape leaves pick mode."
            : isUrl
              ? "Live preview at 1280 × 800, scaled to fit. Scripts are off."
              : "Live preview at 1280 × 800, scaled to fit. Read-only."
          : current === "checking"
            ? "Checking the page…"
            : "Preview unavailable; sample data is used."}
      </p>
    </>
  );
}

function Placeholder({ checking, path }: { checking: boolean; path: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center">
      <p className="max-w-[16rem] rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink">
        <strong>{checking ? "Loading preview…" : "Preview not available"}</strong>
        {!checking && (
          <span className="mt-0.5 block text-xs text-muted">
            <code>{path}</code> did not load. The analysis still runs on sample data.
          </span>
        )}
      </p>
    </div>
  );
}
