// Recorded /api/fix runs for the demo sites, so the public demo spends no Bedrock call on them. Each file is
// { fixes: [{ fixId, outerHTML: string[], result: FixEdits }] }: one real agent run per fix, together with the
// outer HTML of the targets it was written for (a recording is only served when the page still has that HTML).
// Record with LIVEFIX_RECORD=1 in `npm run dev` (see lib/livefix/recorded.ts); the files start empty and a
// missing or malformed entry is simply not served.

import { recordingFileSchema } from "@/lib/livefix/schemas";
import type { FixEdits } from "@/lib/livefix/types";
import alpine from "./alpine.json";
import northwind from "./northwind.json";
import riverside from "./riverside.json";

export interface FixRecording {
  fixId: string;
  /** Outer HTML of each target, in the request's target order. */
  outerHTML: string[];
  result: FixEdits;
}

export interface FixRecordingFile {
  fixes: FixRecording[];
}

/** Reads a recording file. A malformed file counts as empty, so a bad recording never breaks the route. */
export function parseRecordingFile(raw: unknown): FixRecordingFile {
  const parsed = recordingFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : { fixes: [] };
}

export const DEMO_FIX_SITE_IDS = ["northwind", "riverside", "alpine"] as const;

export const DEMO_FIX_RECORDINGS: Record<string, FixRecordingFile> = {
  northwind: parseRecordingFile(northwind),
  riverside: parseRecordingFile(riverside),
  alpine: parseRecordingFile(alpine),
};
