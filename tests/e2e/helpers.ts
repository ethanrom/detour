import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

// Selectors use roles and accessible names only, so they survive restyling and the move from sample data to the
// live pipeline. Waits are generous because the live pipeline extracts, evaluates and plans for real.

export const PERSONAS = ["Mouse", "Keyboard", "Screen reader"] as const;
export type PersonaName = (typeof PERSONAS)[number];

export const NORTHWIND_TASK = "Add the Trail Jacket in size M to the cart";
export const RIVERSIDE_TASK = "Find the monthly income limit for a household of 3";

/** Longest wait for analysis or planning (the sample data source answers in under a second). */
export const PIPELINE_MS = 90_000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function openAnalyze(page: Page) {
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { level: 1, name: "Analyze a page" })).toBeVisible();
  // The radio group renders once the list of pages has loaded.
  await expect(page.getByRole("radio", { name: /Northwind/ })).toBeAttached();
}

export const siteRadio = (page: Page, name: RegExp) => page.getByRole("radio", { name });

/** Clicks the card, like a person would: the radio inside it is visually hidden, so it cannot be clicked itself. */
export async function chooseSite(page: Page, name: RegExp) {
  await page.locator("label").filter({ has: siteRadio(page, name) }).click();
  await expect(siteRadio(page, name)).toBeChecked();
}

/** The "Run" button of a task. Its name is "Run: <task>", "Run again: <task>" or "Analyzing…: <task>". */
export const runButton = (page: Page, task: string) =>
  page.getByRole("button", { name: new RegExp(`^(Run|Run again|Analyzing…): ${escapeRe(task)}$`) });

export const raceRegion = (page: Page) => page.getByRole("region", { name: /The race/ });
export const afterRegion = (page: Page) => page.getByRole("region", { name: /Same task, same three people/ });
export const planButton = (page: Page) => page.getByRole("button", { name: /^(Plan fixes|Plan again)$/ });
export const applyButton = (page: Page) => page.getByRole("button", { name: /^(Fix this page|Fix again)$/ });
/** The summary row of a finished fix run: "3 of 3 proven". It only exists once the run is over. */
export const proofSummary = (page: Page) => page.getByText(/\d+ of \d+ proven/);

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

/** Waits for the fix run to finish: the summary row shows "N of M proven" and the after section is on screen. */
export async function waitForFixRun(page: Page) {
  await expect(proofSummary(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(afterRegion(page)).toBeVisible({ timeout: PIPELINE_MS });
}

/** Chooses 3 fixes and plans (mouse). Resolves once the chosen fixes are listed. */
export async function planWithMouse(page: Page) {
  await page.locator("label").filter({ has: page.getByRole("radio", { name: "3", exact: true }) }).click();
  await expect(page.getByRole("radio", { name: "3", exact: true })).toBeChecked();
  await planButton(page).click();
  await expect(page.getByRole("list", { name: "Chosen fixes, best first" })).toBeVisible({ timeout: PIPELINE_MS });
}

/** Chooses 3 fixes, plans, fixes the page (mouse) and waits for the before/after section. */
export async function planAndFixWithMouse(page: Page) {
  await planWithMouse(page);
  await applyButton(page).click();
  await waitForFixRun(page);
}

/** The results of the applied plan for one task: the "Before" and "After" columns of the after-section race. */
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
