import { expect, test } from "@playwright/test";
import {
  NORTHWIND_TASK,
  PIPELINE_MS,
  afterRegion,
  applyButton,
  changeDrawer,
  fixProgress,
  fixResults,
  fixRegion,
  openAnalyze,
  openRecheck,
  planWithMouse,
  proofSummary,
  readAfter,
  recheckButton,
  runTaskWithMouse,
  viewChange,
  waitForFixRun,
} from "./helpers";

// "Fix this page" on Northwind with no keys: the server answers every fix with the deterministic template edit (or the
// one recorded Claude run), the browser applies it to the live preview, and Detour re-reads and re-times the page.
test("Northwind: Fix this page proves all three fixes and the keyboard lane finishes", async ({ page }) => {
  await openAnalyze(page);
  await runTaskWithMouse(page, NORTHWIND_TASK);
  await planWithMouse(page);

  // The plan alone shows no code: the diffs come from the page that was really edited.
  const codeChange = page.getByRole("group", { name: /Code change for/ });
  await expect(codeChange).toHaveCount(0);

  await applyButton(page).click();
  await expect(page.getByRole("button", { name: "Fixing…" })).toBeDisabled();
  await waitForFixRun(page);

  await expect(proofSummary(page)).toHaveText("3 of 3 proven");
  await expect(fixResults(page).getByText(/elements? kept their place|elements? moved/)).toBeVisible();
  // The demo store replays the one recorded Claude run (fixtures/fix/northwind.json); without it, template edits.
  const fixes = fixProgress(page);
  await expect(fixes.getByText(/^(Recorded Claude run|Template edit \(no AI\))$/)).toHaveCount(3);
  await expect(fixes.getByText("Proven", { exact: true })).toHaveCount(3);
  await expect(fixes.getByText(/Keyboard:.*can.t finish.*predicted/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Download patch" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy report" })).toBeEnabled();
  await expect(fixRegion(page).getByRole("button", { name: "Fix again" })).toBeVisible();

  // The real diff, per edited element, is in the change drawer and nowhere in the list.
  await expect(codeChange).toHaveCount(0);
  const view = viewChange(page, /^View change: /).first();
  await view.click();
  const drawer = changeDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("group", { name: /Code change for/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(view).toBeFocused();
  await expect(codeChange).toHaveCount(0);

  // The preview can flip back to the original page and forward again without reloading.
  const original = page.getByRole("radio", { name: "Original" });
  const fixed = page.getByRole("radio", { name: "Fixed" });
  await expect(fixed).toBeChecked();
  await page.getByRole("radiogroup", { name: "Page version" }).locator("label").filter({ has: original }).click();
  await expect(original).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Showing the original page." })).toHaveCount(1);
  await page.getByRole("radiogroup", { name: "Page version" }).locator("label").filter({ has: fixed }).click();
  await expect(fixed).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Showing the fixed page." })).toHaveCount(1);

  // The re-check race: re-checked on the fixed page, with the prediction beside it.
  await openRecheck(page);
  const after = afterRegion(page);
  await expect(after.getByText("Re-checked on the fixed page. Predicted seconds are shown in grey.")).toBeVisible();
  const lane = after.getByRole("group", { name: "Keyboard lane" });
  await expect(lane).toContainText(/\d(\.\d)? s/, { timeout: 30_000 });
  await expect(lane).toContainText("predicted");
  const result = await readAfter(page, NORTHWIND_TASK);
  expect(result.after.Keyboard.seconds, "the keyboard lane finishes on the fixed page").toBeGreaterThan(0);
});

test("Northwind: the patch downloads as detour-patch.txt", async ({ page }) => {
  await openAnalyze(page);
  await runTaskWithMouse(page, NORTHWIND_TASK);
  await planWithMouse(page);
  await applyButton(page).click();
  await expect(proofSummary(page)).toBeVisible({ timeout: PIPELINE_MS });
  await expect(recheckButton(page)).toBeEnabled({ timeout: PIPELINE_MS });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download patch" }).click();
  expect((await download).suggestedFilename()).toBe("detour-patch.txt");
});
