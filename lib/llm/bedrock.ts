// Minimal Amazon Bedrock Converse client with forced tool use (structured output).
//
// Credentials and model ids come only from the environment:
//   CLAUDE_AWS_ACCESS_KEY, CLAUDE_AWS_SECRET_KEY, CLAUDE_AWS_REGION
//   CLAUDE_AWS_MODEL        (strong tier)  } passed unchanged as the Converse `modelId`
//   CLAUDE_AWS_FAST_MODEL   (fast tier)    } (model id, inference profile id or ARN)
// No model id is ever hard-coded here. Server-side only: never import this from client components.

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

export type LlmTier = "fast" | "strong";

export type LlmErrorCode = "not-configured" | "request-failed" | "no-tool-use" | "invalid-output";

/** Base class of every error thrown by this module. Messages never contain credentials. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Credentials, region or model id missing from the environment. */
export class LlmNotConfiguredError extends LlmError {
  constructor(message = "Bedrock is not configured (missing CLAUDE_AWS_* environment variables).") {
    super("not-configured", message);
  }
}

/** The Bedrock call itself failed (network, auth, throttling, timeout, validation). */
export class LlmRequestError extends LlmError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("request-failed", message, options);
  }
}

/** The model answered, but not with a usable tool call (`no-tool-use`) or the input failed `parse`
 *  (`invalid-output`). The message is safe to feed back to the model in a retry prompt. */
export class LlmOutputError extends LlmError {
  constructor(code: "no-tool-use" | "invalid-output", message: string, options?: { cause?: unknown }) {
    super(code, message, options);
  }
}

export type Env = Record<string, string | undefined>;

/** Every Converse call sets inferenceConfig.maxTokens: this when the caller gives none, never more than the hard cap. */
export const DEFAULT_MAX_TOKENS = 512;
export const HARD_MAX_TOKENS = 1024;

export interface BedrockConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  model?: string;
  fastModel?: string;
}

function readConfig(env: Env): BedrockConfig | null {
  const accessKeyId = env.CLAUDE_AWS_ACCESS_KEY?.trim();
  const secretAccessKey = env.CLAUDE_AWS_SECRET_KEY?.trim();
  const region = env.CLAUDE_AWS_REGION?.trim();
  const model = env.CLAUDE_AWS_MODEL?.trim() || undefined;
  const fastModel = env.CLAUDE_AWS_FAST_MODEL?.trim() || undefined;
  if (!accessKeyId || !secretAccessKey || !region || (!model && !fastModel)) return null;
  return { accessKeyId, secretAccessKey, region, model, fastModel };
}

/** True when credentials, a region and at least one model id are present. */
export function isLlmConfigured(env: Env = process.env): boolean {
  return readConfig(env) !== null;
}

/** Model id for a tier. A tier with no model of its own falls back to the other tier's model. */
export function resolveModelId(tier: LlmTier, env: Env = process.env): string {
  const cfg = readConfig(env);
  if (!cfg) throw new LlmNotConfiguredError();
  const id = tier === "fast" ? (cfg.fastModel ?? cfg.model) : (cfg.model ?? cfg.fastModel);
  if (!id) throw new LlmNotConfiguredError();
  return id;
}

/** Sends one Converse request. Injectable so tests never touch the network. */
export type ConverseSend = (input: ConverseCommandInput, options?: { abortSignal?: AbortSignal }) => Promise<ConverseCommandOutput>;

let cachedClient: { key: string; client: BedrockRuntimeClient } | undefined;

function defaultSend(env: Env): ConverseSend {
  const cfg = readConfig(env);
  if (!cfg) throw new LlmNotConfiguredError();
  const key = `${cfg.region}\n${cfg.accessKeyId}\n${cfg.secretAccessKey}`; // in-memory cache key only; never logged
  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = {
      key,
      client: new BedrockRuntimeClient({
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      }),
    };
  }
  const { client } = cachedClient;
  return (input, options) => client.send(new ConverseCommand(input), options);
}

export interface ConverseToolOptions<T> {
  tier: LlmTier;
  system: string;
  user: string;
  toolName: string;
  description: string;
  /** JSON Schema of the tool input (an object schema). */
  inputSchema: Record<string, unknown>;
  /** Validates the raw tool input, returning the typed value or throwing (e.g. a zod `schema.parse`). */
  parse: (input: unknown) => T;
  /** Output cap (inferenceConfig.maxTokens). Defaults to DEFAULT_MAX_TOKENS and is clamped to HARD_MAX_TOKENS. */
  maxTokens?: number;
  /** Omitted from the request when undefined (some models reject sampling parameters). */
  temperature?: number;
  /** Abort the request after this many milliseconds (default 30000). */
  timeoutMs?: number;
  /** Test seam: replaces the real Bedrock client. */
  send?: ConverseSend;
  /** Test seam: replaces process.env. */
  env?: Env;
}

function secretsOf(env: Env): string[] {
  return [env.CLAUDE_AWS_ACCESS_KEY, env.CLAUDE_AWS_SECRET_KEY].filter((s): s is string => !!s && s.length >= 8);
}

function redact(message: string, env: Env): string {
  let out = message;
  for (const s of secretsOf(env)) out = out.split(s).join("[redacted]");
  return out;
}

function describeIssues(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown }).issues)) {
    const issues = (err as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
    return issues
      .slice(0, 8)
      .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message ?? "invalid"}`)
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/** Calls the model with exactly one tool and forces it, then returns the parsed tool input. */
export async function converseTool<T>(opts: ConverseToolOptions<T>): Promise<T> {
  const env = opts.env ?? process.env;
  const modelId = resolveModelId(opts.tier, env);
  const send = opts.send ?? defaultSend(env);

  const input: ConverseCommandInput = {
    modelId,
    system: [{ text: opts.system }],
    messages: [{ role: "user", content: [{ text: opts.user }] }],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: opts.toolName,
            description: opts.description,
            inputSchema: { json: opts.inputSchema as never },
          },
        },
      ],
      toolChoice: { tool: { name: opts.toolName } },
    },
    inferenceConfig: {
      maxTokens: Math.max(1, Math.min(Math.floor(opts.maxTokens ?? DEFAULT_MAX_TOKENS), HARD_MAX_TOKENS)),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let output: ConverseCommandOutput;
  try {
    output = await send(input, { abortSignal: controller.signal });
  } catch (err) {
    // Do not attach the raw SDK error as `cause`: it carries the signed request (access key id, headers).
    const name = err instanceof Error ? err.name : "Error";
    const detail = err instanceof Error ? redact(err.message, env) : "";
    const safe = new Error(detail || name);
    safe.name = name;
    throw new LlmRequestError(`Bedrock Converse call failed (${name})${detail ? `: ${detail}` : ""}`, { cause: safe });
  } finally {
    clearTimeout(timer);
  }

  const blocks = output.output?.message?.content ?? [];
  const toolUse = blocks.find((b) => b.toolUse?.name === opts.toolName)?.toolUse;
  if (!toolUse) {
    throw new LlmOutputError("no-tool-use", `The model did not call the "${opts.toolName}" tool (stop reason: ${output.stopReason ?? "unknown"}).`);
  }
  try {
    return opts.parse(toolUse.input);
  } catch (err) {
    throw new LlmOutputError("invalid-output", `The tool input did not match the schema: ${describeIssues(err)}`, { cause: err });
  }
}
