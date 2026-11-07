import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

// Selectors use roles and accessible names only, so they survive restyling and the move from sample data to the
// live pipeline. Waits are generous because the live pipeline extracts, evaluates and plans for real.
//
// The Analyze workspace: a top bar (the h1 is the page's name, "Change page" opens the page menu), a left column
// (the Page region and the Tasks region) and a centre column (the "Steps" tablist with its one primary action, and
// four tab panels, of which only the open one is visible). Role queries skip hidden panels, so a helper only finds a
// panel's content while that step is open.

export const PERSONAS = ["Mouse", "Keyboard", "Screen reader"] as const;
export type PersonaName = (typeof PERSONAS)[number];

export const NORTHWIND_TASK = "Add the Trail Jacket in size M to the cart";
export const RIVERSIDE_TASK = "Find the monthly income limit for a household of 3";

/** Longest wait for analysis or planning (the sample data source answers in under a second). */
export const PIPELINE_MS = 90_000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- pages ----------------------------------------------------------------------------------------------------------

/** The demo pages by id (the `?site=` deep link) and by the name their h1 and radio carry. */
const DEMO = {
  northwind: /Northwind/,
  riverside: /Riverside/,
  alpine: /Alpine/,
} as const;
export type DemoSite = keyof typeof DEMO;

/** The page's name: the h1 of the top bar. It reads "Analyze a page" until the list of pages has loaded. */
export const pageHeading = (page: Page) => page.getByRole("heading", { level: 1 });

/** Opens the workspace on a demo page (Northwind is the first, so the plain address shows it). */
export async function openAnalyze(page: Page, site: DemoSite = "northwind") {
  await page.goto(site === "northwind" ? "/analyze" : `/analyze?site=${site}`);
  // The name appears once the pages have loaded, which only happens after hydration: from here the page takes clicks.
  await expect(pageHeading(page)).toHaveText(DEMO[site]);
  await expect(page.getByRole("region", { name: "Tasks" }).getByRole("button", { name: /^Run: / }).first()).toBeVisible();
}

export const menuButton = (page: Page) => page.getByRole("button", { name: "Change page" });
export const pageMenu = (page: Page) => page.getByRole("dialog", { name: "Change page" });
export const siteRadio = (page: Page, name: RegExp) => pageMenu(page).getByRole("radio", { name });

/** Opens the "Change page" popover (mouse). */
export async function openPageMenu(page: Page) {
  await menuButton(page).click();
  await expect(pageMenu(page)).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Choose a page to analyze" })).toBeVisible();
}

/** Chooses a demo page from the "Change page" popover (mouse); a click closes the menu and the h1 takes the new name. */
export async function chooseSite(page: Page, name: RegExp) {
  await openPageMenu(page);
  await siteRadio(page, name).click();
  await expect(pageMenu(page)).toBeHidden();
  await expect(pageHeading(page)).toHaveText(name);
}

// --- steps ----------------------------------------------------------------------------------------------------------

export type StepName = "Race" | "Plan" | "Fix" | "Re-check";

/** A tab of the "Steps" rail. Its name carries "Done" for a finished step, so it is matched by its first word. */
export const stepTab = (page: Page, step: StepName) => page.getByRole("tab", { name: new RegExp(`^${escapeRe(step)}\\b`) });

export const raceRegion = (page: Page) => page.getByRole("region", { name: "The race", exact: true });
export const planRegion = (page: Page) => page.getByRole("region", { name: "The plan", exact: true });
export const fixRegion = (page: Page) => page.getByRole("region", { name: "Fixes on the page", exact: true });
export const afterRegion = (page: Page) => page.getByRole("region", { name: /Same task, same three people/ });

/** The "Run" button of a task. Its name is "Run: <task>", "Run again: <task>" or "Analyzing…: <task>". */
export const runButton = (page: Page, task: string) =>
  page.getByRole("button", { name: new RegExp(`^(Run|Run again|Analyzing…): ${escapeRe(task)}$`) });

// The one primary action of the step rail, by what it says.
export const planButton = (page: Page) => page.getByRole("button", { name: /^(Plan fixes|Plan again)$/ });
export const applyButton = (page: Page) => page.getByRole("button", { name: "Fix this page", exact: true });
export const recheckButton = (page: Page) => page.getByRole("button", { name: "See the re-check", exact: true });

/** The plan: the chosen fixes, and the radio group that sets how many. */
export const plannedFixes = (page: Page) => page.getByRole("list", { name: "Chosen fixes, best first" });
export const fixCount = (page: Page) => page.getByRole("radiogroup", { name: "Number of fixes" });

/** The fix run: the "Fix results" group ("3 of 3 proven" only exists once the run is over) and the list of fixes. */
export const fixResults = (page: Page) => page.getByRole("group", { name: "Fix results" });
export const proofSummary = (page: Page) => fixResults(page).getByText(/\d+ of \d+ proven/);
export const fixProgress = (page: Page) => page.getByRole("list", { name: "Fix progress" });

/** The "View change: <title>" button of a fix. Pass a RegExp to match part of the title. */
export const viewChange = (page: Page, title: string | RegExp) =>
  fixProgress(page).getByRole("button", { name: typeof title === "string" ? `View change: ${title}` : title });

/** The change drawer: a modal dialog whose heading starts "Change: ". */
export const changeDrawer = (page: Page) => page.getByRole("dialog", { name: /^Change: / });

/** The text alternative of a race: one row per person. */
export const resultsTable = (scope: Locator, task: string) =>
  scope.getByRole("table", { name: `Predicted times for the task: ${task}` });

export interface Outcome {
  /** Predicted seconds, or null when that person cannot finish the task. */
  seconds: number | null;
  text: string;
}

export function parseOutcome(text: string): Outcome {
  const t = text.trim();
  if (/can.t finish/i.test(t)) return { seconds: null, text: t };
  const m = /^(\d+(?:\.\d+)?)\s*s\b/.exec(t);
  if (!m) throw new Error(`Not a time or a "can't finish" state: "${t}"`);
  return { seconds: Number(m[1]), text: t };
}

/** Just the seconds of each person, for comparing two readings. */
export const secondsOf = (r: Record<PersonaName, Outcome>) => PERSONAS.map((p) => r[p].seconds);

/** Reads one column ("Prediction" before a plan; "Before" or "After" once it is applied) of a results table. */
export async function readRace(table: Locator, column: "Prediction" | "Before" | "After"): Promise<Record<PersonaName, Outcome>> {
  await expect(table).toBeAttached();
  const headers = (await table.locator("thead th").allTextContents()).map((h) => h.trim());
  const col = headers.indexOf(column);
  expect(col, `column "${column}" in [${headers.join(", ")}]`).toBeGreaterThan(0);
  const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.children, (c) => (c.textContent ?? "").trim())));
  const out = {} as Record<PersonaName, Outcome>;
  for (const persona of PERSONAS) {
    const row = rows.find((r) => r[0] === persona);
    expect(row, `a row for ${persona}`).toBeDefined();
    out[persona] = parseOutcome(row![col]);
  }
  return out;
}

/** Runs a task (mouse) and returns what the race predicts for each person. */
export async function runTaskWithMouse(page: Page, task: string): Promise<Record<PersonaName, Outcome>> {
  // Fails fast with a clear message if the page does not offer this task.
  await expect(runButton(page, task), `task "${task}" is listed`).toBeVisible({ timeout: 10_000 });
  await runButton(page, task).click();
  return waitForRace(page, task);
}

export async function waitForRace(page: Page, task: string): Promise<Record<PersonaName, Outcome>> {
  const table = resultsTable(raceRegion(page), task);
  await expect(table).toBeAttached({ timeout: PIPELINE_MS });
  return readRace(table, "Prediction");
}

/** Waits for the fix run to finish: "N of M proven" shows and the rail offers the re-check. */
export async function waitForFixRun(page: Page) {
  await expect(proofSummary(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(recheckButton(page)).toBeEnabled({ timeout: PIPELINE_MS });
}

/** Plans 3 fixes from the rail (mouse). Resolves once the chosen fixes are listed; the Plan step is open. */
export async function planWithMouse(page: Page) {
  await planButton(page).click();
  // Three is the number the plan starts with; the radios sit in labels and are visually hidden, so a click goes to the label.
  await expect(page.getByRole("radio", { name: "3", exact: true })).toBeChecked();
  await expect(plannedFixes(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(plannedFixes(page).getByRole("listitem")).toHaveCount(3);
}

/** Chooses 3 fixes, plans, fixes the page (mouse) and waits for the run to finish. The Fix step is open. */
export async function planAndFixWithMouse(page: Page) {
  await planWithMouse(page);
  await applyButton(page).click();
  await waitForFixRun(page);
}

/** Opens the Re-check step (mouse). Focus moves to its heading. */
export async function openRecheck(page: Page) {
  await recheckButton(page).click();
  await expect(afterRegion(page).getByRole("heading", { level: 2, name: /Same task, same three people/ })).toBeFocused();
}

/** The results of the applied plan for one task: the "Before" and "After" columns of the Re-check race. */
export async function readAfter(page: Page, task: string) {
  const table = resultsTable(afterRegion(page), task);
  return { before: await readRace(table, "Before"), after: await readRace(table, "After") };
}

// --- axe ------------------------------------------------------------------------------------------------------------

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Scans the page with axe (WCAG 2.0 to 2.2 A and AA) and fails on any violation, printing each one with its impact,
 * help text and the selectors of the offending elements. The demo-site iframe is excluded: those pages are
 * inaccessible on purpose.
 */
export async function expectNoAxeViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude("iframe").analyze();
  const report = violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `    - ${n.target.join(" >> ")}\n      ${n.html.replace(/\s+/g, " ").slice(0, 200)}\n      ${(n.failureSummary ?? "").replace(/\s+/g, " ")}`)
        .join("\n");
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.helpUrl})\n${nodes}`;
    })
    .join("\n");
  if (report) console.log(`axe violations on ${label}:\n${report}`);
  else console.log(`axe: 0 violations on ${label}`);
  expect.soft(violations, `axe violations on ${label}:\n${report}`).toHaveLength(0);
}
