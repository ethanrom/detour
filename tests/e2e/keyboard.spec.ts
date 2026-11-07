import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  NORTHWIND_TASK,
  PIPELINE_MS,
  afterRegion,
  applyButton,
  changeDrawer,
  fixCount,
  fixProgress,
  fixRegion,
  menuButton,
  openAnalyze,
  pageHeading,
  pageMenu,
  planButton,
  planRegion,
  plannedFixes,
  proofSummary,
  raceRegion,
  readAfter,
  recheckButton,
  runButton,
  siteRadio,
  stepTab,
  viewChange,
  waitForRace,
} from "./helpers";

/** Presses Tab (or Shift+Tab) until `target` has focus. Fails if it is not reached within `maxPresses` presses. */
async function tabTo(page: Page, target: Locator, direction: "forward" | "back" = "forward", maxPresses = 150) {
  await expect(target).toBeAttached();
  const focused = () => target.evaluate((el) => el === document.activeElement, undefined, { timeout: 2_000 });
  for (let presses = 0; presses < maxPresses; presses++) {
    if (await focused()) return;
    await page.keyboard.press(direction === "forward" ? "Tab" : "Shift+Tab");
  }
  expect(await focused(), `${direction === "forward" ? "Tab" : "Shift+Tab"} should reach ${target} within ${maxPresses} presses`).toBe(true);
}

// This test never touches the mouse: every step is Tab, Shift+Tab, arrow keys, Enter, Space or Escape.
test("the whole flow works with the keyboard alone", async ({ page }) => {
  await openAnalyze(page);

  // 1. The first Tab stop is the skip link; Enter takes focus to the main area.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator("#main")).toBeFocused();

  // 2. Open "Change page" (it is above the main area: Shift+Tab), arrow to another page and back to Northwind.
  await tabTo(page, menuButton(page), "back");
  await page.keyboard.press("Enter");
  await expect(pageMenu(page)).toBeVisible();
  const northwind = siteRadio(page, /Northwind/);
  const riverside = siteRadio(page, /Riverside/);
  await expect(northwind).toBeFocused(); // focus starts on the page that is chosen
  await page.keyboard.press("ArrowDown");
  await expect(riverside).toBeChecked();
  await expect(riverside).toBeFocused();
  await expect(pageHeading(page)).toHaveText(/Riverside/);
  await page.keyboard.press("ArrowUp");
  await expect(northwind).toBeChecked();
  await expect(northwind).toBeFocused();
  await expect(pageHeading(page)).toHaveText(/Northwind/);
  // Escape closes the menu and focus goes back to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(pageMenu(page)).toBeHidden();
  await expect(menuButton(page)).toBeFocused();

  // 3. Run the task from the Tasks list with Enter. Focus moves to the race heading.
  await tabTo(page, runButton(page, NORTHWIND_TASK));
  await page.keyboard.press("Enter");
  const before = await waitForRace(page, NORTHWIND_TASK);
  expect(before.Mouse.seconds).toBeGreaterThan(0);
  expect(before["Screen reader"].seconds).toBeGreaterThan(0);
  expect(before.Keyboard.seconds, "keyboard cannot finish before the fixes").toBeNull();
  await expect(raceRegion(page).getByRole("heading", { level: 2, name: "The race" })).toBeFocused();

  // 4. Plan fixes is in the rail above the panel: Shift+Tab, then Enter. Focus moves to the plan heading.
  const planHeading = planRegion(page).getByRole("heading", { level: 2, name: "The plan" });
  await tabTo(page, planButton(page), "back");
  await page.keyboard.press("Enter");
  await expect(plannedFixes(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(plannedFixes(page).getByRole("listitem")).toHaveCount(3);
  await expect(planHeading).toBeFocused();

  // The Steps tabs take the arrow keys: Left opens the Race step and Right comes back to the plan, which is still there.
  await tabTo(page, stepTab(page, "Plan"), "back");
  await page.keyboard.press("ArrowLeft");
  await expect(stepTab(page, "Race")).toHaveAttribute("aria-selected", "true");
  await expect(stepTab(page, "Race")).toBeFocused();
  await expect(raceRegion(page)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(stepTab(page, "Plan")).toHaveAttribute("aria-selected", "true");
  await expect(plannedFixes(page)).toBeVisible();

  // The radio group sets how many fixes: another number is another plan, so Plan fixes is offered again.
  const three = fixCount(page).getByRole("radio", { name: "3", exact: true });
  await tabTo(page, three);
  await page.keyboard.press("ArrowLeft");
  await expect(fixCount(page).getByRole("radio", { name: "2", exact: true })).toBeChecked();
  await expect(plannedFixes(page)).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(three).toBeChecked();
  await tabTo(page, planButton(page), "back");
  await page.keyboard.press("Enter");
  await expect(plannedFixes(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(plannedFixes(page).getByRole("listitem")).toHaveCount(3);
  await expect(planHeading).toBeFocused();

  // 5. Fix this page (also in the rail) with Space. Focus moves to the Fix heading; wait for the run to finish.
  await tabTo(page, applyButton(page), "back");
  await page.keyboard.press("Space");
  await expect(fixRegion(page).getByRole("heading", { level: 2, name: "Fixes on the page" })).toBeFocused();
  await expect(proofSummary(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(recheckButton(page)).toBeEnabled({ timeout: PIPELINE_MS });

  // 6. Open a change with Enter, close it with Escape: focus is back on the "View change" button.
  const view = viewChange(page, /^View change: Make the size options real buttons/);
  await tabTo(page, view);
  await page.keyboard.press("Enter");
  await expect(changeDrawer(page)).toBeVisible();
  await expect(changeDrawer(page).getByRole("heading", { level: 2, name: /^Change: Make the size options real buttons/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(changeDrawer(page)).toBeHidden();
  await expect(view).toBeFocused();
  await expect(fixProgress(page)).toBeVisible();

  // 7. See the re-check (back up in the rail) with Enter. Focus moves to its heading.
  await tabTo(page, recheckButton(page), "back");
  await page.keyboard.press("Enter");
  await expect(afterRegion(page).getByRole("heading", { level: 2, name: /Same task, same three people/ })).toBeFocused();

  const result = await readAfter(page, NORTHWIND_TASK);
  expect(result.after.Keyboard.seconds, "keyboard can finish after the fixes").toBeGreaterThan(0);
  expect(result.after["Screen reader"].seconds!).toBeLessThanOrEqual(before["Screen reader"].seconds!);
});
