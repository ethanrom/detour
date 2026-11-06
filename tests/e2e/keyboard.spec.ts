import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  NORTHWIND_TASK,
  PIPELINE_MS,
  afterRegion,
  applyButton,
  openAnalyze,
  planButton,
  readAfter,
  runButton,
  siteRadio,
  waitForRace,
} from "./helpers";

/** Presses Tab until `target` has focus. Fails if it is not reachable within `maxTabs` presses. */
async function tabTo(page: Page, target: Locator, maxTabs = 150) {
  await expect(target).toBeAttached();
  const focused = () => target.evaluate((el) => el === document.activeElement, undefined, { timeout: 2_000 });
  for (let presses = 0; presses < maxTabs; presses++) {
    if (await focused()) return;
    await page.keyboard.press("Tab");
  }
  expect(await focused(), `Tab should reach ${target} within ${maxTabs} presses`).toBe(true);
}

// This test never touches the mouse: every step is Tab, arrow keys, Enter or Space.
test("the whole flow works with the keyboard alone", async ({ page }) => {
  await openAnalyze(page);

  // The first Tab stop is the skip link.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

  // Pick the page: Tab to the radio group, arrow to another page and back to Northwind.
  const northwind = siteRadio(page, /Northwind/);
  const riverside = siteRadio(page, /Riverside/);
  await tabTo(page, northwind);
  await page.keyboard.press("ArrowRight");
  await expect(riverside).toBeChecked();
  await expect(riverside).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(northwind).toBeChecked();
  await expect(northwind).toBeFocused();
  await page.keyboard.press("Space");
  await expect(northwind).toBeChecked();

  // Run the task with Enter.
  await tabTo(page, runButton(page, NORTHWIND_TASK));
  await page.keyboard.press("Enter");
  const before = await waitForRace(page, NORTHWIND_TASK);
  expect(before.Mouse.seconds).toBeGreaterThan(0);
  expect(before["Screen reader"].seconds).toBeGreaterThan(0);
  expect(before.Keyboard.seconds, "keyboard cannot finish before the fixes").toBeNull();

  // Plan with k = 3 (the radio group is keyboard operable), then Enter on "Plan fixes".
  const three = page.getByRole("radio", { name: "3", exact: true });
  await tabTo(page, three);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "2", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(three).toBeChecked();
  await tabTo(page, planButton(page));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Chosen fixes, best first" })).toBeVisible({ timeout: PIPELINE_MS });

  // Apply with Space. Focus moves to the "After the fixes" heading.
  await tabTo(page, applyButton(page));
  await page.keyboard.press("Space");
  await expect(afterRegion(page).getByRole("heading", { level: 2, name: /Same task, same three people/ })).toBeFocused();

  const result = await readAfter(page, NORTHWIND_TASK);
  expect(result.after.Keyboard.seconds, "keyboard can finish after the fixes").toBeGreaterThan(0);
  expect(result.after["Screen reader"].seconds!).toBeLessThanOrEqual(before["Screen reader"].seconds!);
});
