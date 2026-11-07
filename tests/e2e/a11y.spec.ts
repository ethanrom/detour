import { expect, test } from "@playwright/test";
import {
  NORTHWIND_TASK,
  applyButton,
  changeDrawer,
  expectNoAxeViolations,
  openAnalyze,
  openRecheck,
  planWithMouse,
  runTaskWithMouse,
  viewChange,
  waitForFixRun,
} from "./helpers";

// Detour is judged by its own standard: every screen must pass axe (WCAG 2.0 to 2.2, A and AA) with 0 violations.
// Reduced motion keeps the scans deterministic: the hero teaser and the race rest on their final frame, which is the
// state a person looking at the finished screen sees. The demo-site iframe is excluded inside expectNoAxeViolations.
test.use({ reducedMotion: "reduce" });

test("axe: home page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoAxeViolations(page, "/");
});

test("axe: method page", async ({ page }) => {
  await page.goto("/method");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoAxeViolations(page, "/method");
});

test("axe: analyze page, empty / after a race / plan / after the page is fixed / change drawer / re-check", async ({ page }) => {
  await openAnalyze(page);
  // The preview iframe is excluded from the scan but must have settled, or the layout would still be moving.
  await expect(page.getByTitle(/Preview of Northwind/)).toBeVisible();
  await expectNoAxeViolations(page, "/analyze (empty)");

  await runTaskWithMouse(page, NORTHWIND_TASK);
  await expect(page.getByRole("status").filter({ hasText: /Race finished/ })).toHaveCount(1);
  await expectNoAxeViolations(page, "/analyze (after a race)");

  await planWithMouse(page);
  await expectNoAxeViolations(page, "/analyze (plan)");

  await applyButton(page).click();
  await waitForFixRun(page);
  await expectNoAxeViolations(page, "/analyze (after the page is fixed)");

  await viewChange(page, /^View change: /).first().click();
  await expect(changeDrawer(page)).toBeVisible();
  await expectNoAxeViolations(page, "/analyze (change drawer open)");
  await page.keyboard.press("Escape");
  await expect(changeDrawer(page)).toBeHidden();

  await openRecheck(page);
  await expect(page.getByRole("status").filter({ hasText: /After the fixes\./ })).toHaveCount(1);
  await expectNoAxeViolations(page, "/analyze (re-check)");
});
