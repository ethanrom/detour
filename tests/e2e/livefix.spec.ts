import { expect, test } from "@playwright/test";
import {
  NORTHWIND_TASK,
  PIPELINE_MS,
  afterRegion,
  applyButton,
  chooseSite,
  openAnalyze,
  planWithMouse,
  proofSummary,
  readAfter,
  runTaskWithMouse,
  waitForFixRun,
} from "./helpers";

// "Fix this page" on Northwind with no keys: the server answers every fix with the deterministic template edit,
// the browser applies it to the live preview, and Detour re-reads and re-times the page.
test("Northwind: Fix this page proves all three fixes and the keyboard lane finishes", async ({ page }) => {
  await openAnalyze(page);
  await chooseSite(page, /Northwind/);
  await runTaskWithMouse(page, NORTHWIND_TASK);
  await planWithMouse(page);

  // The plan alone shows no code: the diffs come from the page that was really edited.
  const fixes = page.getByRole("list", { name: "Chosen fixes, best first" });
  await expect(fixes.getByRole("group", { name: /Code change for/ })).toHaveCount(0);

  await applyButton(page).click();
  await expect(page.getByRole("button", { name: "Fixing…" })).toBeDisabled();
  await waitForFixRun(page);

  await expect(proofSummary(page)).toHaveText("3 of 3 proven");
  await expect(page.getByText(/elements? kept their place|elements? moved/)).toBeVisible();
  // The demo store replays the one recorded Claude run (fixtures/fix/northwind.json); without it, template edits.
  await expect(fixes.getByText(/^(Recorded Claude run|Template edit \(no AI\))$/)).toHaveCount(3);
  await expect(fixes.getByText("Proven", { exact: true })).toHaveCount(3);
  // The real diff, per edited element, and the re-checked chips.
  await expect(fixes.getByRole("group", { name: /Code change for/ }).first()).toBeVisible();
  await expect(fixes.getByText(/Keyboard:.*can.t finish.*predicted/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Download patch" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy report" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Fix again" })).toBeVisible();

  // The after race: re-checked on the fixed page, with the prediction beside it.
  const after = afterRegion(page);
  await expect(after.getByText("Re-checked on the fixed page. Predicted seconds are shown in grey.")).toBeVisible();
  const lane = after.getByRole("group", { name: "Keyboard lane" });
  await expect(lane).toContainText(/\d(\.\d)? s/, { timeout: 30_000 });
  await expect(lane).toContainText("predicted");
  const result = await readAfter(page, NORTHWIND_TASK);
  expect(result.after.Keyboard.seconds, "the keyboard lane finishes on the fixed page").toBeGreaterThan(0);

  // The preview can flip back to the original page and forward again without reloading.
  await page.getByRole("button", { name: "Show original" }).click();
  await expect(page.getByText("Showing the original page.")).toBeVisible();
  await page.getByRole("button", { name: "Show fixed" }).click();
  await expect(page.getByText("Showing the fixed page.")).toBeVisible();
});

test("Northwind: the patch downloads as detour-patch.txt", async ({ page }) => {
  await openAnalyze(page);
  await chooseSite(page, /Northwind/);
  await runTaskWithMouse(page, NORTHWIND_TASK);
  await planWithMouse(page);
  await applyButton(page).click();
  await expect(proofSummary(page)).toBeVisible({ timeout: PIPELINE_MS });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download patch" }).click();
  expect((await download).suggestedFilename()).toBe("detour-patch.txt");
});
