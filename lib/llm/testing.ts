// Test helpers for the LLM layer: scripted Converse responses, no network. Only imported by *.test.ts.

import type { ConverseCommandInput, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import type { ConverseSend, Env } from "./bedrock";

/** A fake environment that satisfies isLlmConfigured(). The values are obviously not real. */
export const TEST_ENV: Env = {
  CLAUDE_AWS_ACCESS_KEY: "AKIATESTACCESSKEY00",
  CLAUDE_AWS_SECRET_KEY: "test-secret-key-not-real",
  CLAUDE_AWS_REGION: "us-test-1",
  CLAUDE_AWS_MODEL: "test-strong-model",
  CLAUDE_AWS_FAST_MODEL: "test-fast-model",
};

export function toolUseOutput(name: string, input: unknown): ConverseCommandOutput {
  return {
    $metadata: {},
    stopReason: "tool_use",
    output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "tu-1", name, input: input as never } }] } },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metrics: { latencyMs: 1 },
  };
}

export function textOutput(text: string): ConverseCommandOutput {
  return {
    $metadata: {},
    stopReason: "end_turn",
    output: { message: { role: "assistant", content: [{ text }] } },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metrics: { latencyMs: 1 },
  };
}

export interface ScriptedSend {
  send: ConverseSend;
  /** Every request passed to send, in order. */
  calls: ConverseCommandInput[];
}

/** Returns each scripted item in turn (an Error item is thrown); the last item repeats. */
export function scriptedSend(...script: Array<ConverseCommandOutput | Error>): ScriptedSend {
  const calls: ConverseCommandInput[] = [];
  const send: ConverseSend = async (input) => {
    calls.push(input);
    const item = script[Math.min(calls.length - 1, script.length - 1)];
    if (item instanceof Error) throw item;
    return item;
  };
  return { send, calls };
}

/** The text of the first user message of a recorded request. */
export function userTextOf(call: ConverseCommandInput): string {
  return call.messages?.[0]?.content?.map((b) => ("text" in b ? (b.text ?? "") : "")).join("") ?? "";
}
