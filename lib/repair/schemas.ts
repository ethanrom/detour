// zod schema for POST /api/repair. The page schema is /api/ground's, widened with the two hints that
// repair needs and that schema would otherwise strip: styleKey (fix grouping) and className (label fallback).

import { z } from "zod";
import type { PageModel, Task } from "@/lib/contracts";
import { pageModelSchema } from "@/lib/llm/schemas";

const nodeSchema = pageModelSchema.shape.nodes.valueType;

export const repairPageSchema = pageModelSchema.extend({
  nodes: z.record(
    z.string(),
    nodeSchema.extend({
      hints: nodeSchema.shape.hints.extend({
        styleKey: z.string().optional(),
        className: z.string().optional(),
      }),
    }),
  ),
}) satisfies z.ZodType<PageModel>;

export const taskSchema = z.object({
  id: z.string().min(1).max(200),
  siteId: z.string().max(100),
  label: z.string().max(500),
  steps: z
    .array(
      z.object({
        target: z.string(),
        action: z.enum(["activate", "type", "select", "read"]),
        text: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .min(1)
    .max(30),
  grounding: z.enum(["fixture", "llm"]),
}) satisfies z.ZodType<Task>;

export const repairRequestSchema = z.object({
  siteId: z.string().trim().min(1).max(100),
  page: repairPageSchema,
  tasks: z.array(taskSchema).max(20),
});

export type RepairRequest = z.infer<typeof repairRequestSchema>;
