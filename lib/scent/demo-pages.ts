// Page builders for scent tests and demos: parametric sectioned pages, a civic-style page whose target
// section's heading text is a parameter (the "vague heading" story), and two small page transforms.
// Built on fixtures/pagemodels/builder.ts so announcements match the rest of the system.

import { announce } from "@/lib/a11y/announce";
import type { NodeId, PageModel, Task } from "@/lib/contracts";
import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";

const words = (n: number, seed = "word"): string => Array.from({ length: n }, (_, i) => (i === 0 ? seed : "word")).join(" ");

export interface SectionSpec {
  heading: string;
  /** Word count of each paragraph stop in the section. */
  stops: number[];
}

/** A page of paragraphs split by level-2 headings. Ids: preamble `pre-j`, heading `h-k`, stop `s-k-j`. */
export function sectionedPage(spec: { preamble?: number[]; sections: SectionSpec[] }): PageModel {
  const children: Spec[] = [];
  (spec.preamble ?? []).forEach((n, j) => children.push({ id: `pre-${j}`, role: "paragraph", name: words(n), tag: "p" }));
  spec.sections.forEach((sec, k) => {
    children.push({ id: `h-${k}`, role: "heading", level: 2, name: sec.heading, tag: "h2" });
    sec.stops.forEach((n, j) => children.push({ id: `s-${k}-${j}`, role: "paragraph", name: words(n), tag: "p" }));
  });
  return buildPage({ id: "root", role: "document", stop: false, children }, { url: "fixture://sectioned", title: "Sectioned page" });
}

export const CIVIC_TARGET: NodeId = "limit-hh3";

/** A benefits-agency page. The section that holds the answer to the income-limit task has the heading
 *  `targetHeading`: "Income limits" (clear) or "More information" (vague). */
export function civicPage(targetHeading = "Income limits"): PageModel {
  const p = (id: string, n: number, text?: string): Spec => ({ id, role: "paragraph", name: text ?? words(n), tag: "p" });
  const h2 = (id: string, name: string): Spec => ({ id, role: "heading", level: 2, name, tag: "h2" });
  const link = (id: string, name: string): Spec => ({ id, role: "link", name, tag: "a" });
  const navNames = ["Home", "Benefits", "Health care", "Food assistance", "Housing", "Jobs and training", "Taxes", "Contact"];
  const root: Spec = {
    id: "root",
    role: "document",
    stop: false,
    children: [
      {
        id: "header",
        role: "generic",
        tag: "header",
        stop: false,
        children: [
          link("gov-logo", "State Benefits Portal home"),
          link("lang", "Español"),
          { id: "nav", role: "navigation", landmark: "navigation", tag: "nav", stop: false, children: [{ id: "nav-list", role: "list", tag: "ul", stop: false, children: navNames.map((n, i) => link(`nav-${i}`, n)) }] },
        ],
      },
      {
        id: "main",
        role: "generic",
        landmark: "main",
        tag: "main",
        stop: false,
        children: [
          { id: "title", role: "heading", level: 1, name: "Food Assistance Program", tag: "h1" },
          p("intro", 30, "This program helps families buy groceries each month. Most applications are decided within thirty days of being received."),
          h2("h-who", "Who can apply"),
          p("who-1", 35),
          p("who-2", 25),
          p("who-3", 20),
          h2("h-how", "How to apply"),
          p("how-1", 30),
          link("apply-online", "Start your application online"),
          link("apply-paper", "Download the paper application"),
          p("how-2", 20),
          h2("h-target", targetHeading),
          p("limit-intro", 18, "Your household's gross monthly income must be at or below the limit for its size."),
          p("limit-hh1", 6, "Household of 1: $1,632 per month"),
          p("limit-hh2", 6, "Household of 2: $2,215 per month"),
          p(CIVIC_TARGET, 6, "Household of 3: $2,798 per month"),
          p("limit-hh4", 6, "Household of 4: $3,380 per month"),
          p("limit-hh5", 6, "Household of 5: $3,963 per month"),
          p("limit-note", 20),
          h2("h-docs", "Documents you need"),
          p("docs-1", 30),
          p("docs-2", 20),
          h2("h-contact", "Contact us"),
          p("contact-1", 15),
          link("contact-phone", "Call 1-800-555-0100"),
          link("contact-email", "Email the benefits office"),
        ],
      },
      {
        id: "footer",
        role: "generic",
        landmark: "contentinfo",
        tag: "footer",
        stop: false,
        children: ["Privacy", "Accessibility", "Terms of use", "Sitemap"].map((n, i) => link(`foot-${i}`, n)),
      },
    ],
  };
  return buildPage(root, { url: "fixture://civic", title: "Food Assistance Program | State Benefits Portal" });
}

export const civicTask: Task = {
  id: "income-limit",
  siteId: "civic",
  label: "Find the monthly income limit for a household of 3",
  grounding: "fixture",
  steps: [{ target: CIVIC_TARGET, action: "read", note: "Read the income limit for a household of 3" }],
};

function clonePage(page: PageModel): PageModel {
  return structuredClone(page);
}

/** What the "promote-heading" fix does to the model: expose styled text as role=heading (default level 2). */
export function promoteHeadings(page: PageModel, ids: NodeId[], level = 2): PageModel {
  const out = clonePage(page);
  for (const id of ids) {
    const n = out.nodes[id];
    if (!n) throw new Error(`promoteHeadings: unknown node ${id}`);
    n.role = "heading";
    n.level = level;
    n.announcement = announce(n);
  }
  const pos = new Map(out.readingOrder.map((id, i) => [id, i] as const));
  const all = new Set([...out.headings, ...ids]);
  out.headings = [...all].filter((id) => pos.has(id)).sort((a, b) => pos.get(a)! - pos.get(b)!);
  return out;
}

/** Changes a heading's visible/accessible text and re-announces it. */
export function renameHeading(page: PageModel, id: NodeId, name: string): PageModel {
  const out = clonePage(page);
  const n = out.nodes[id];
  if (!n || n.role !== "heading") throw new Error(`renameHeading: ${id} is not a heading`);
  n.name = name;
  n.announcement = announce(n);
  return out;
}
