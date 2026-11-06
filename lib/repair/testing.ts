// Test helpers for lib/repair. Only imported by *.test.ts.

import path from "node:path";
import { JSDOM } from "jsdom";
import type { PageModel } from "@/lib/contracts";
import { extractPage } from "@/lib/extract";
import { applyFixes, generateCandidates } from "@/lib/fixes";
import type { ConverseSend } from "@/lib/llm/bedrock";
import { toolUseOutput, userTextOf } from "@/lib/llm/testing";

/** Loads public/sites/<site>/index.html with its linked CSS and extracts the PageModel. */
export async function loadSite(site: string): Promise<PageModel> {
  const file = path.join(process.cwd(), "public", "sites", site, "index.html");
  const dom = await JSDOM.fromFile(file, { resources: "usable", pretendToBeVisual: true });
  const doc = dom.window.document;
  if (doc.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
  return extractPage(doc);
}

/** The page with every promote-heading fix applied (what repairPage works on when headings are fake). */
export function promoteAll(page: PageModel): PageModel {
  return applyFixes(page, generateCandidates(page).filter((f) => f.kind === "promote-heading"));
}

/** A Converse stand-in that answers submit_heading from a map of current heading -> new heading
 *  (unknown headings get an echo, which fails validation) and submit_labels with "Label for <id>". */
export function fakeBedrock(headings: Record<string, string>): { send: ConverseSend; calls: string[] } {
  const calls: string[] = [];
  const send: ConverseSend = async (input) => {
    const user = userTextOf(input);
    const tool = input.toolConfig?.tools?.[0]?.toolSpec?.name;
    calls.push(tool ?? "?");
    if (tool === "submit_labels") {
      const ids = [...user.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
      return toolUseOutput("submit_labels", { labels: ids.map((id) => ({ id, label: `Label for ${id}` })) });
    }
    const current = /Current heading: "(.*)"/.exec(user)?.[1] ?? "";
    return toolUseOutput("submit_heading", { heading: headings[current] ?? current });
  };
  return { send, calls };
}
