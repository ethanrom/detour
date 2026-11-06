import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "./mini-shop";

describe("mini-shop fixture", () => {
  it("has the structure the engine and fixes tests rely on", () => {
    expect(miniShop.headings).toEqual(["product-title"]);
    expect(miniShop.landmarks).toEqual(["nav"]);
    expect(miniShop.skipLinks).toEqual([]);
    expect(miniShop.focusOrder[0]).toBe("logo");
    expect(miniShop.focusOrder).not.toContain("size-m");
    expect(miniShop.readingOrder).toContain("size-m");
    expect(miniShop.nodes["nav-0"].announcement).toBe("navigation landmark, list with 24 items, link, Men");
    expect(miniShop.nodes["size-m"].announcement).toBe("clickable, M");
    expect(miniShop.nodes["cart-icon"].announcement).toBe("button");
  });

  it("task targets exist", () => {
    for (const t of miniShopTasks) for (const s of t.steps) expect(miniShop.nodes[s.target]).toBeDefined();
  });
});
