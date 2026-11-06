import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import type { PageModel, Task } from "@/lib/contracts";
import { evaluateAll, normalizeTasks, planAll } from "./pipeline";

describe("live pipeline (pure part)", () => {
  it("leaves targets that are reading stops alone", () => {
    expect(normalizeTasks(miniShop, miniShopTasks)).toBe(miniShopTasks);
  });

  it("retargets a container that a real browser split into several stops", () => {
    const row = "row";
    const page: PageModel = structuredClone(miniShop);
    page.nodes[row] = { ...page.nodes["product-title"], id: row, role: "generic", name: "", announcement: "", children: ["a", "b"], parentId: page.root };
    page.nodes["a"] = { ...page.nodes["product-title"], id: "a", role: "text", name: "3 people", parentId: row, children: [] };
    page.nodes["b"] = { ...page.nodes["product-title"], id: "b", role: "text", name: "$3,108 per month", parentId: row, children: [] };
    page.readingOrder = [...page.readingOrder, "a", "b"];
    const task: Task = { id: "t", siteId: "s", label: "Read the limit", grounding: "fixture", steps: [{ target: row, action: "read" }] };
    const [fixed] = normalizeTasks(page, [task]);
    expect(fixed.steps[0].target).toBe("b");
    expect(task.steps[0].target).toBe(row);
  });

  it("evaluates, plans and re-evaluates the mini shop", () => {
    const before = evaluateAll(miniShop, miniShopTasks);
    expect(before.map((r) => r.taskId)).toEqual(miniShopTasks.map((t) => t.id));
    const out = planAll(miniShop, miniShopTasks, 3);
    expect(out.plan.chosen.length).toBeGreaterThan(0);
    expect(out.plan.plannedObjective).toBeLessThan(out.plan.baselineObjective);
    expect(out.results).toHaveLength(miniShopTasks.length);
    // The fixed page really changed: at least one chosen target was patched.
    expect(out.page).not.toEqual(miniShop);
  });
});
