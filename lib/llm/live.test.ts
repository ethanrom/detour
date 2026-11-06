// Live Bedrock test. Skipped unless CLAUDE_AWS_* are present (in the environment or in the shared .env
// of the main checkout). Makes real, billable calls; prints no environment values.

import { describe, expect, it } from "vitest";
import { miniShop } from "@/fixtures/pagemodels/mini-shop";
import { isLlmConfigured } from "./bedrock";
import { groundTask, validateSteps } from "./ground";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env there: rely on the ambient environment.
}

describe.skipIf(!isLlmConfigured())("live Bedrock grounding", () => {
  it("grounds 'Add the Trail Jacket in size M to the cart' on mini-shop", async () => {
    const task = await groundTask(miniShop, "Add the Trail Jacket in size M to the cart", { siteId: "mini-shop" });
    const targets = task.steps.map((s) => s.target);
    expect(task.grounding).toBe("llm");
    expect(validateSteps(miniShop, task.steps)).toEqual([]);
    expect(targets).toContain("size-m");
    expect(targets).toContain("add-to-cart");
    expect(targets.indexOf("size-m")).toBeLessThan(targets.indexOf("add-to-cart"));
  }, 60_000);

  it("grounds an information-finding task to a read step", async () => {
    const task = await groundTask(miniShop, "Find out how long you have to return it", { siteId: "mini-shop" });
    expect(validateSteps(miniShop, task.steps)).toEqual([]);
    expect(task.steps.map((s) => s.target)).toContain("returns-body");
  }, 60_000);
});
