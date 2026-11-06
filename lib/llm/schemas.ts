// zod schemas for untrusted input to /api/ground. They mirror lib/contracts/page.ts and are
// type-checked against it, so a contract change that is not reflected here fails `npm run typecheck`.

import { z } from "zod";
import type { A11yNode, PageModel } from "@/lib/contracts";
import { MAX_GROUND_TEXT } from "./guard";

const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const landmarkRoleSchema = z.enum(["banner", "navigation", "main", "complementary", "contentinfo", "search", "form", "region"]);

const hintsSchema = z.object({
  looksLikeHeading: z
    .object({
      fontSizeRatio: z.number(),
      fontWeight: z.number(),
      suggestedLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    })
    .optional(),
  fakeButton: z.boolean().optional(),
  unlabeled: z.boolean().optional(),
  visualLabel: z.string().optional(),
  repetitiveBlock: z.boolean().optional(),
});

const nodeSchema = z.object({
  id: z.string(),
  role: z.string(),
  name: z.string(),
  level: z.number().optional(),
  states: z.array(z.string()),
  focusable: z.boolean(),
  tabIndex: z.number().nullable(),
  actionable: z.boolean(),
  rect: rectSchema.nullable(),
  landmark: landmarkRoleSchema.optional(),
  parentId: z.string().nullable(),
  children: z.array(z.string()),
  announcement: z.string(),
  selector: z.string(),
  tag: z.string(),
  hints: hintsSchema,
}) satisfies z.ZodType<A11yNode>;

export const pageModelSchema = z.object({
  version: z.literal(1),
  url: z.string(),
  title: z.string(),
  viewport: z.object({ w: z.number(), h: z.number() }),
  docHeight: z.number(),
  root: z.string(),
  nodes: z.record(z.string(), nodeSchema),
  readingOrder: z.array(z.string()),
  focusOrder: z.array(z.string()),
  headings: z.array(z.string()),
  landmarks: z.array(z.string()),
  skipLinks: z.array(z.object({ from: z.string(), to: z.string() })),
}) satisfies z.ZodType<PageModel>;

export const MAX_TASK_TEXT = MAX_GROUND_TEXT;

export const groundRequestSchema = z.object({
  siteId: z.string().trim().min(1).max(100),
  page: pageModelSchema,
  text: z.string().trim().min(1).max(MAX_TASK_TEXT),
});

export type GroundRequest = z.infer<typeof groundRequestSchema>;
