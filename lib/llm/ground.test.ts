import { describe, expect, it } from "vitest";
import { miniShop, miniShopTasks } from "@/fixtures/pagemodels/mini-shop";
import { buildPage } from "@/fixtures/pagemodels/builder";
import type { TaskStep } from "@/lib/contracts";
import { LlmNotConfiguredError, LlmRequestError } from "./bedrock";
import { buildListing, customTaskId, GROUND_TOOL_NAME, GroundingError, groundTask, validateSteps } from "./ground";
import { scriptedSend, TEST_ENV, textOutput, toolUseOutput, userTextOf } from "./testing";

const GOOD = { steps: [{ target: "size-m", action: "select", note: "Choose size M" }, { target: "add-to-cart", action: "activate", note: "Press Add to cart" }] };
const BAD_ID = { steps: [{ target: "size-medium", action: "select" }, { target: "add-to-cart", action: "activate" }] };
const TEXT = "Add the Trail Jacket in size M to the cart";

describe("buildListing", () => {
  const lines = buildListing(miniShop).split("\n");

  it("has exactly four pipe-separated fields per line, and the name is at most 80 characters", () => {
    for (const line of lines) {
      const parts = line.split(" | ");
      expect(parts, line).toHaveLength(4);
      expect(parts[2].length, line).toBeLessThanOrEqual(80);
    }
  });

  it("lists every reading stop and focusable once, in document order", () => {
    const ids = lines.map((l) => l.split(" | ")[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of miniShop.readingOrder) expect(ids).toContain(id);
    for (const id of miniShop.focusOrder) expect(ids).toContain(id);
    expect(ids).not.toContain("root");
    expect(ids).not.toContain("nav"); // landmark container, not a stop
    expect(ids.indexOf("product-title")).toBeLessThan(ids.indexOf("price"));
    expect(ids.indexOf("size-m")).toBeLessThan(ids.indexOf("add-to-cart"));
    expect(ids.indexOf("add-to-cart")).toBeLessThan(ids.indexOf("foot-0"));
  });

  it("shows the nearest preceding heading, including headings that are only styled as such", () => {
    expect(lines).toContain('size-m | generic+click | M | under "Select a size"');
    expect(lines).toContain('review-1 | paragraph | Kept me dry on a three-day trek in Patagonia. Runs slightly large. | under "Customer reviews"');
    expect(lines).toContain('price | paragraph | $189.00 | under "Trail Jacket"');
  });

  it("shows the enclosing landmark", () => {
    expect(lines).toContain("nav-0 | link | Men | in navigation");
    expect(lines).toContain("logo | link | Northwind Outfitters home | -");
  });

  it("shows what an unlabeled control looks like, and flags fake controls and headings", () => {
    expect(lines).toContain('cart-icon | button+unlabeled | (no accessible name; looks like "Cart") | -');
    expect(lines.find((l) => l.startsWith("size-label "))).toContain("generic+fake-heading");
    expect(lines.find((l) => l.startsWith("product-title "))).toContain("heading L1");
  });

  it("truncates long names to 80 characters and strips pipes and newlines", () => {
    const long = "x".repeat(200);
    const page = buildPage({
      id: "root",
      role: "document",
      stop: false,
      children: [
        { id: "a", role: "paragraph", name: long, tag: "p" },
        { id: "b", role: "link", name: "Tom | Jerry\n  and   friends", tag: "a" },
      ],
    });
    const [a, b] = buildListing(page).split("\n");
    expect(a.split(" | ")[2]).toHaveLength(80);
    expect(a.split(" | ")[2].endsWith("…")).toBe(true);
    expect(b).toBe("b | link | Tom / Jerry and friends | -");
  });

  it("caps the listing and reports how many elements were omitted", () => {
    const out = buildListing(miniShop, { maxLines: 5 }).split("\n");
    expect(out).toHaveLength(6);
    expect(out[5]).toMatch(/^\.\.\. \d+ more elements omitted$/);
  });
});

describe("validateSteps", () => {
  const step = (target: string, action: TaskStep["action"], text?: string): TaskStep => ({ target, action, ...(text === undefined ? {} : { text }) });

  it("accepts the hand-pinned fixture tasks", () => {
    for (const t of miniShopTasks) expect(validateSteps(miniShop, t.steps), t.id).toEqual([]);
  });

  it("rejects an empty step list", () => {
    expect(validateSteps(miniShop, [])).toEqual([expect.stringContaining("empty")]);
  });

  it("rejects unknown ids", () => {
    const errors = validateSteps(miniShop, [step("size-medium", "select")]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown id "size-medium"');
    expect(errors[0]).toContain("Step 1");
  });

  it("rejects activate and select on non-actionable nodes", () => {
    const errors = validateSteps(miniShop, [step("price", "activate"), step("desc", "select")]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Step 1: "activate".*not actionable/);
    expect(errors[1]).toMatch(/Step 2: "select".*not actionable/);
  });

  it("rejects type on a non-text field and requires text", () => {
    expect(validateSteps(miniShop, [step("add-to-cart", "type", "hello")])[0]).toMatch(/needs a text field/);
    expect(validateSteps(miniShop, [step("search", "type")])[0]).toMatch(/non-empty "text"/);
    expect(validateSteps(miniShop, [step("search", "type", "rain jacket")])).toEqual([]);
  });

  it("rejects read on containers", () => {
    expect(validateSteps(miniShop, [step("nav", "read")])[0]).toMatch(/reading stop/);
    expect(validateSteps(miniShop, [step("returns-body", "read")])).toEqual([]);
  });

  it("rejects an immediate duplicate step and over-long plans", () => {
    expect(validateSteps(miniShop, [step("size-m", "select"), step("size-m", "select")])[0]).toMatch(/repeats step 1/);
    const many = Array.from({ length: 13 }, (_, i) => step(i % 2 ? "size-m" : "size-s", "select"));
    expect(validateSteps(miniShop, many).join(" ")).toMatch(/Too many steps/);
  });
});

describe("groundTask", () => {
  it("returns a validated llm Task on the first try", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const task = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV });
    expect(calls).toHaveLength(1);
    expect(task.grounding).toBe("llm");
    expect(task.siteId).toBe("mini-shop");
    expect(task.label).toBe(TEXT);
    expect(task.id).toMatch(/^custom-[0-9a-f]{10}$/);
    expect(task.id).toBe(customTaskId("mini-shop", TEXT));
    expect(task.steps).toEqual([
      { target: "size-m", action: "select", note: "Choose size M" },
      { target: "add-to-cart", action: "activate", note: "Press Add to cart" },
    ]);
  });

  it("uses the fast tier, forces the tool, and puts the listing and task in the prompt", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV });
    expect(calls[0].modelId).toBe("test-fast-model");
    expect(calls[0].toolConfig?.toolChoice).toEqual({ tool: { name: GROUND_TOOL_NAME } });
    const user = userTextOf(calls[0]);
    expect(user).toContain(JSON.stringify(TEXT));
    expect(user).toContain('size-m | generic+click | M | under "Select a size"');
  });

  it("gives different tasks different ids, and the same task the same id", () => {
    expect(customTaskId("s", "Find returns")).toBe(customTaskId("s", "  find   RETURNS ")); // normalised
    expect(customTaskId("s", "Find returns")).not.toBe(customTaskId("s", "Find shipping"));
    expect(customTaskId("s", "Find returns")).not.toBe(customTaskId("t", "Find returns"));
  });

  it("drops text on non-type steps and keeps it on type steps", async () => {
    const { send } = scriptedSend(
      toolUseOutput(GROUND_TOOL_NAME, { steps: [{ target: "search", action: "type", text: "rain jacket" }, { target: "size-m", action: "select", text: "ignored" }] }),
    );
    const task = await groundTask(miniShop, "Search for a rain jacket", { siteId: "mini-shop", send, env: TEST_ENV });
    expect(task.steps).toEqual([{ target: "search", action: "type", text: "rain jacket" }, { target: "size-m", action: "select" }]);
  });

  it("retries once with the validation errors appended, then succeeds", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, BAD_ID), toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const task = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV });
    expect(calls).toHaveLength(2);
    const retry = userTextOf(calls[1]);
    expect(retry).toContain(userTextOf(calls[0])); // same task and listing
    expect(retry).toContain('unknown id "size-medium"');
    expect(retry).toContain("previous answer was rejected");
    expect(task.steps.map((s) => s.target)).toEqual(["size-m", "add-to-cart"]);
  });

  it("throws GroundingError with the details after the retry also fails", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, BAD_ID));
    const err = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroundingError);
    expect((err as GroundingError).details[0]).toContain('unknown id "size-medium"');
    expect((err as GroundingError).attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("treats an empty step list as a validation failure", async () => {
    const { send } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, { steps: [] }));
    const err = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroundingError);
    expect((err as GroundingError).details[0]).toContain("empty");
  });

  it("retries after a zod parse failure (bad action), feeding the schema error back", async () => {
    const bad = { steps: [{ target: "size-m", action: "click" }] };
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, bad), toolUseOutput(GROUND_TOOL_NAME, GOOD));
    const task = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV });
    expect(calls).toHaveLength(2);
    expect(userTextOf(calls[1])).toContain("steps.0.action");
    expect(task.steps).toHaveLength(2);
  });

  it("fails with GroundingError when the model never produces a parseable tool call", async () => {
    const { send, calls } = scriptedSend(textOutput("I cannot do that."));
    const err = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroundingError);
    expect(calls).toHaveLength(2);
  });

  it("fails with GroundingError on a wrong-shaped payload (steps missing)", async () => {
    const { send } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, { answer: 3 }));
    const err = await groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroundingError);
    expect((err as GroundingError).details[0]).toContain("steps");
  });

  it("does not retry transport failures", async () => {
    const { send, calls } = scriptedSend(new Error("boom"));
    await expect(groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: TEST_ENV })).rejects.toBeInstanceOf(LlmRequestError);
    expect(calls).toHaveLength(1);
  });

  it("throws LlmNotConfiguredError when the environment is empty", async () => {
    const { send, calls } = scriptedSend(toolUseOutput(GROUND_TOOL_NAME, GOOD));
    await expect(groundTask(miniShop, TEXT, { siteId: "mini-shop", send, env: {} })).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});
