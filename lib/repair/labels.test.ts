import { beforeAll, describe, expect, it } from "vitest";
import type { PageModel } from "@/lib/contracts";
import { TEST_ENV, scriptedSend, toolUseOutput, userTextOf } from "@/lib/llm/testing";
import { checkLabel, fallbackLabel, needsProposedLabel, proposeLabels } from "./labels";
import { loadSite } from "./testing";

let northwind: PageModel;

beforeAll(async () => {
  northwind = await loadSite("northwind");
}, 60_000);

describe("proposeLabels", () => {
  it("targets only unlabeled controls with no visible hint (the wishlist toggle on northwind)", () => {
    const ids = Object.keys(northwind.nodes).filter((id) => needsProposedLabel(northwind.nodes[id]));
    expect(ids).toEqual(["wish-toggle"]);
  });

  it("validates the model's labels, retries the invalid ones once, and shows the model the control's context", async () => {
    const first = toolUseOutput("submit_labels", { labels: [{ id: "wish-toggle", label: "Add this jacket to my wishlist" }] });
    const second = toolUseOutput("submit_labels", { labels: [{ id: "wish-toggle", label: '"Add to wishlist."' }] });
    const { send, calls } = scriptedSend(first, second);
    const out = await proposeLabels(northwind, ["wish-toggle", "product-title", "no-such-node"], { send, env: TEST_ENV });
    expect(out).toEqual({ "wish-toggle": { text: "Add to wishlist", source: "llm" } });
    expect(calls).toHaveLength(2);
    expect(userTextOf(calls[0])).toContain("btn-wish");
    expect(userTextOf(calls[1])).toContain("more than 4 words");
  });

  it("falls back to class-name words without an LLM, and skips controls with no usable class", async () => {
    const out = await proposeLabels(northwind, ["wish-toggle"], { env: {} });
    expect(out).toEqual({ "wish-toggle": { text: "Wish", source: "fallback" } });
    expect(fallbackLabel({ ...northwind.nodes["wish-toggle"], hints: { className: "icon-btn icon-heart" } })).toBe("Heart");
    expect(fallbackLabel({ ...northwind.nodes["wish-toggle"], hints: { className: "btn" } })).toBeNull();
    expect(checkLabel("Button")).toHaveProperty("error");
  });
});
