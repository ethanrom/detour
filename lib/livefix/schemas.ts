// zod schemas for the live fix route: the request body of POST /api/fix, the raw tool output of the fix agent,
// and the shape of a recorded run (fixtures/fix/<siteId>.json). Lengths are capped here so one request cannot
// be large; the finer limits (edit counts, HTML and CSS sizes) are the validator's, which says why in words.

import { z } from "zod";
import type { FixKind } from "@/lib/contracts";
import { MAX_FIXES_PER_RUN, type EditOp, type EditSource, type FixRequestItem, type FixRunRequest, type InsertPosition } from "./types";

export const MAX_TARGETS_PER_FIX = 30;
const MAX_OUTER_HTML_REQUEST = 2000;
const MAX_PARENT_HTML_REQUEST = 800;
const MAX_FEEDBACK = 600;

const FIX_KINDS = ["skip-link", "promote-heading", "add-landmark", "add-label", "real-button", "remove-positive-tabindex"] as const satisfies readonly FixKind[];

const style = z.string().max(200).default("");

const targetSchema = z.object({
  nodeId: z.string().min(1).max(200),
  selector: z.string().min(1).max(500),
  outerHTML: z.string().max(MAX_OUTER_HTML_REQUEST),
  parentHTML: z.string().max(MAX_PARENT_HTML_REQUEST),
  nearbyText: z.array(z.string().max(300)).max(6),
  style: z.object({
    display: style,
    fontSize: style,
    fontWeight: style,
    color: style,
    background: style,
    border: style,
    padding: style,
    margin: style,
    cursor: style,
  }),
});

const itemSchema = z.object({
  fixId: z.string().min(1).max(200),
  kind: z.enum(FIX_KINDS),
  title: z.string().max(300),
  params: z
    .record(z.string().max(120), z.union([z.string().max(300), z.number(), z.boolean()]))
    .refine((p) => Object.keys(p).length <= 80, "too many params"),
  wcag: z.array(z.string().max(80)).max(6),
  targets: z.array(targetSchema).min(1).max(MAX_TARGETS_PER_FIX),
  extraSelectors: z.array(z.string().min(1).max(500)).max(10).optional(),
  feedback: z.string().max(MAX_FEEDBACK).optional(),
}) satisfies z.ZodType<FixRequestItem>;

export const fixRunRequestSchema = z.object({
  siteId: z.string().trim().min(1).max(100),
  pageTitle: z.string().max(300),
  fixes: z
    .array(itemSchema)
    .min(1)
    .max(MAX_FIXES_PER_RUN)
    .refine((fixes) => new Set(fixes.map((f) => f.fixId)).size === fixes.length, "fixId values must be unique"),
}) satisfies z.ZodType<FixRunRequest>;

// ---------------------------------------------------------------------------------------------------------
// Raw agent output / recorded edits

/** A model may write tabindex: 0 or aria-pressed: false; those are read as strings. */
const attributeValue = z.union([z.string(), z.number(), z.boolean()]).transform(String);
const attributes = z.record(z.string().max(60), attributeValue).refine((a) => Object.keys(a).length <= 20, "too many attributes");

const selector = z.string().min(1).max(500);
const POSITIONS = ["beforebegin", "afterbegin", "beforeend", "afterend"] as const satisfies readonly InsertPosition[];

export const editOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), selector, html: z.string().max(40_000) }),
  z.object({ op: z.literal("wrapChildren"), selector, tag: z.enum(["button", "span"]), attributes }),
  z.object({ op: z.literal("setAttributes"), selector, attributes }),
  z.object({ op: z.literal("removeAttributes"), selector, names: z.array(z.string().max(60)).max(20) }),
  z.object({ op: z.literal("insert"), selector, position: z.enum(POSITIONS), html: z.string().max(40_000) }),
  z.object({ op: z.literal("setText"), selector, text: z.string().max(2000) }),
]) satisfies z.ZodType<EditOp>;

/** What the agent submits (and what a recording holds): edits, optional scoped CSS and a note. */
export const rawEditsSchema = z.object({
  edits: z.array(editOpSchema).max(50),
  css: z
    .string()
    .max(40_000)
    .nullish()
    .transform((c) => c ?? undefined),
  note: z.string().max(2000),
});

export type RawEdits = z.infer<typeof rawEditsSchema>;

const SOURCES = ["agent", "recorded", "fallback", "wording"] as const satisfies readonly EditSource[];

export const recordingFileSchema = z.object({
  fixes: z.array(
    z.object({
      fixId: z.string().min(1).max(200),
      outerHTML: z.array(z.string().max(MAX_OUTER_HTML_REQUEST)).min(1).max(MAX_TARGETS_PER_FIX),
      result: rawEditsSchema.extend({ fixId: z.string().max(200), source: z.enum(SOURCES), ms: z.number().optional() }),
    }),
  ),
});
