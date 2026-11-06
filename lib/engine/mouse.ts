// Mouse persona, strategy "point": KLM-GOMS with Fitts's-law pointing.
// Per step: M, scroll if the target is off-screen, point (Fitts), then click (2B).
// Pointer coordinates are viewport coordinates; the pointer starts at the viewport centre with the
// page scrolled to the top, and each step starts where the previous one left the pointer.

import { wordCount } from "@/lib/a11y/announce";
import type { PageModel, Task } from "@/lib/contracts";
import { clip, missingTargetReason, nodeName } from "./describe";
import { centreY, scrollTo, viewportHeight } from "./geometry";
import type { Params } from "./params";
import { TraceBuilder, type Planned } from "./trace";

export function planMouse(page: PageModel, task: Task, p: Params): Planned {
  const tb = new TraceBuilder("point", p);
  const vh = viewportHeight(page);
  let px = page.viewport.w / 2;
  let py = vh / 2;
  let scrollY = 0;

  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const node = page.nodes[step.target];
    if (!node) return tb.done({ stepIndex: si, reason: missingTargetReason(step.target) });
    const name = clip(nodeName(node));
    tb.begin(si, node.id);
    tb.event("think", null, "Think", { M: 1 });

    const r = node.rect;
    if (r) {
      const move = scrollTo(page, scrollY, r);
      if (move) {
        for (let k = 0; k < move.count; k++) tb.event("scroll", node.id, `Scroll ${move.direction} one screen`, { scrollVp: 1 });
        scrollY = move.scrollY;
      }
      const tx = r.x + r.w / 2;
      const ty = centreY(r) - scrollY;
      const D = Math.hypot(tx - px, ty - py);
      const W = Math.max(1, Math.min(r.w, r.h));
      tb.event("point", node.id, `Point → ${name}`, { fitA: 1, fitBits: Math.log2(D / W + 1) });
      px = tx;
      py = ty;
    } else {
      // No layout: fall back to the KLM pointing operator.
      tb.event("point", node.id, `Point → ${name}`, { P: 1 });
    }

    if (step.action === "read") {
      tb.event("think", node.id, `Read → ${name}`, { readWords: wordCount(node.name) }, { counted: false });
    } else {
      tb.event("click", node.id, `Click → ${name}`, { B: 2 });
      if (step.action === "type") {
        const text = step.text ?? "";
        tb.event("type", node.id, `Type “${clip(text, 30)}”`, { H: 2, chars: text.length });
      }
    }
    tb.end();
  }
  return tb.done();
}
