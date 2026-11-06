import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  converseTool,
  isLlmConfigured,
  LlmError,
  LlmNotConfiguredError,
  LlmOutputError,
  LlmRequestError,
  resolveModelId,
} from "./bedrock";
import { scriptedSend, TEST_ENV, textOutput, toolUseOutput } from "./testing";

const schema = z.object({ answer: z.number() });
const base = {
  tier: "fast" as const,
  system: "sys",
  user: "usr",
  toolName: "answer_tool",
  description: "d",
  inputSchema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
  parse: (x: unknown) => schema.parse(x),
  env: TEST_ENV,
};

describe("isLlmConfigured / resolveModelId", () => {
  it("is false for an empty environment", () => {
    expect(isLlmConfigured({})).toBe(false);
  });
  it("is true with credentials, region and a model", () => {
    expect(isLlmConfigured(TEST_ENV)).toBe(true);
  });
  it.each(["CLAUDE_AWS_ACCESS_KEY", "CLAUDE_AWS_SECRET_KEY", "CLAUDE_AWS_REGION"])("is false without %s", (key) => {
    expect(isLlmConfigured({ ...TEST_ENV, [key]: "" })).toBe(false);
  });
  it("is false without any model id", () => {
    expect(isLlmConfigured({ ...TEST_ENV, CLAUDE_AWS_MODEL: undefined, CLAUDE_AWS_FAST_MODEL: undefined })).toBe(false);
  });
  it("passes model ids through unchanged per tier", () => {
    const env = { ...TEST_ENV, CLAUDE_AWS_MODEL: "arn:aws:bedrock:us-east-1:123:inference-profile/x.y", CLAUDE_AWS_FAST_MODEL: "us.vendor.fast-v1:0" };
    expect(resolveModelId("strong", env)).toBe("arn:aws:bedrock:us-east-1:123:inference-profile/x.y");
    expect(resolveModelId("fast", env)).toBe("us.vendor.fast-v1:0");
  });
  it("falls back to the other tier when one model is missing", () => {
    expect(resolveModelId("fast", { ...TEST_ENV, CLAUDE_AWS_FAST_MODEL: "" })).toBe("test-strong-model");
    expect(resolveModelId("strong", { ...TEST_ENV, CLAUDE_AWS_MODEL: "" })).toBe("test-fast-model");
  });
  it("throws a typed error when unconfigured", () => {
    expect(() => resolveModelId("fast", {})).toThrow(LlmNotConfiguredError);
  });
});

describe("converseTool", () => {
  it("forces the tool, sends the tier's model id and returns the parsed input", async () => {
    const { send, calls } = scriptedSend(toolUseOutput("answer_tool", { answer: 42 }));
    const out = await converseTool({ ...base, send });
    expect(out).toEqual({ answer: 42 });
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.modelId).toBe("test-fast-model");
    expect(req.toolConfig?.toolChoice).toEqual({ tool: { name: "answer_tool" } });
    expect(req.toolConfig?.tools?.[0]).toMatchObject({ toolSpec: { name: "answer_tool", description: "d" } });
    expect(req.system).toEqual([{ text: "sys" }]);
    expect(req.messages?.[0]).toEqual({ role: "user", content: [{ text: "usr" }] });
  });

  it("uses the strong model for the strong tier", async () => {
    const { send, calls } = scriptedSend(toolUseOutput("answer_tool", { answer: 1 }));
    await converseTool({ ...base, tier: "strong", send });
    expect(calls[0].modelId).toBe("test-strong-model");
  });

  it("omits temperature unless given", async () => {
    const a = scriptedSend(toolUseOutput("answer_tool", { answer: 1 }));
    await converseTool({ ...base, send: a.send });
    expect(a.calls[0].inferenceConfig).not.toHaveProperty("temperature");
    const b = scriptedSend(toolUseOutput("answer_tool", { answer: 1 }));
    await converseTool({ ...base, temperature: 0, send: b.send });
    expect(b.calls[0].inferenceConfig?.temperature).toBe(0);
  });

  it("throws LlmOutputError(no-tool-use) when the model answers in text", async () => {
    const { send } = scriptedSend(textOutput("sorry"));
    await expect(converseTool({ ...base, send })).rejects.toMatchObject({ name: "LlmOutputError", code: "no-tool-use" });
  });

  it("throws LlmOutputError(invalid-output) naming the failing field when parse rejects", async () => {
    const { send } = scriptedSend(toolUseOutput("answer_tool", { answer: "forty-two" }));
    const err = await converseTool({ ...base, send }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmOutputError);
    expect((err as LlmOutputError).code).toBe("invalid-output");
    expect((err as LlmOutputError).message).toContain("answer");
  });

  it("wraps transport failures in LlmRequestError and redacts secrets", async () => {
    const { send } = scriptedSend(new Error(`denied for ${TEST_ENV.CLAUDE_AWS_SECRET_KEY} and ${TEST_ENV.CLAUDE_AWS_ACCESS_KEY}`));
    const err = await converseTool({ ...base, send }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmRequestError);
    expect(err).toBeInstanceOf(LlmError);
    const message = (err as Error).message;
    expect(message).not.toContain(TEST_ENV.CLAUDE_AWS_SECRET_KEY);
    expect(message).not.toContain(TEST_ENV.CLAUDE_AWS_ACCESS_KEY);
    expect(message).toContain("[redacted]");
  });

  it("aborts the request after timeoutMs", async () => {
    const send = (_input: unknown, options?: { abortSignal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        options?.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(converseTool({ ...base, timeoutMs: 20, send })).rejects.toBeInstanceOf(LlmRequestError);
  });

  it("throws LlmNotConfiguredError without calling send when the environment is empty", async () => {
    const { send, calls } = scriptedSend(toolUseOutput("answer_tool", { answer: 1 }));
    await expect(converseTool({ ...base, env: {}, send })).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});
