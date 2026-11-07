import { expect, test } from "@playwright/test";
import {
  NORTHWIND_TASK,
  PERSONAS,
  RIVERSIDE_TASK,
  afterRegion,
  chooseSite,
  openAnalyze,
  planAndFixWithMouse,
  raceRegion,
  readAfter,
  runTaskWithMouse,
  secondsOf,
} from "./helpers";

test("Northwind: keyboard is blocked, a 3-fix plan lets it finish and does not slow the screen reader", async ({ page }) => {
  await openAnalyze(page);
  await chooseSite(page, /Northwind/);

  // Race: three lanes; mouse and screen reader get seconds, keyboard cannot finish.
  const before = await runTaskWithMouse(page, NORTHWIND_TASK);
  for (const persona of PERSONAS) {
    await expect(raceRegion(page).getByRole("group", { name: `${persona} lane` })).toBeVisible();
  }
  expect(before.Mouse.seconds, "mouse seconds").toBeGreaterThan(0);
  expect(before["Screen reader"].seconds, "screen-reader seconds").toBeGreaterThan(0);
  expect(before.Keyboard.seconds, "keyboard cannot finish").toBeNull();
  // Same story in the visible lanes once the animation reaches the end.
  await expect(raceRegion(page).getByRole("group", { name: "Keyboard lane" })).toContainText(/Can.t finish/, { timeout: 30_000 });
  await expect(raceRegion(page).getByRole("group", { name: "Mouse lane" })).toContainText(/\d(\.\d)? s/);
  await expect(raceRegion(page).getByRole("group", { name: "Screen reader lane" })).toContainText(/\d(\.\d)? s/);

  // Plan with k = 3, fix the page, and compare the re-checked seconds against the "before" numbers.
  await planAndFixWithMouse(page);
  await expect(afterRegion(page).getByRole("heading", { level: 2, name: /Same task, same three people/ })).toBeFocused();
  const result = await readAfter(page, NORTHWIND_TASK);
  expect(secondsOf(result.before), "the after view repeats the same 'before' numbers").toEqual(secondsOf(before));
  expect(result.after.Keyboard.seconds, "keyboard can finish on the fixed page").toBeGreaterThan(0);
  expect(result.after["Screen reader"].seconds!, "screen reader is not slower after the fixes").toBeLessThanOrEqual(before["Screen reader"].seconds!);
  await expect(afterRegion(page).getByText("Unblocked").first()).toBeVisible();
});

test("Riverside: the income-limit task gets a time for every person", async ({ page }) => {
  await openAnalyze(page);
  await chooseSite(page, /Riverside/);

  const out = await runTaskWithMouse(page, RIVERSIDE_TASK);
  for (const persona of PERSONAS) {
    await expect(raceRegion(page).getByRole("group", { name: `${persona} lane` })).toBeVisible();
  }
  expect(out.Mouse.seconds, "mouse seconds").toBeGreaterThan(0);
  // Reading a table row by ear is never faster than looking at it.
  if (out["Screen reader"].seconds !== null) {
    expect(out["Screen reader"].seconds).toBeGreaterThan(out.Mouse.seconds!);
  }
  await expect(page.getByText(/Analysis failed/)).toHaveCount(0);
});
