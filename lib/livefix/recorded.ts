// Recorded fix edits for the demo sites (fixtures/fix/<siteId>.json), so the demo costs no model call, plus the
// recording mode that creates those files from real agent runs. Server-side only.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "@/lib/llm/bedrock";
import { DEMO_FIX_RECORDINGS, DEMO_FIX_SITE_IDS, parseRecordingFile, type FixRecordingFile } from "@/fixtures/fix";
import type { FixEdits, FixRequestItem } from "./types";
import { validateEdits } from "./validate";

export function isDemoSite(siteId: string): boolean {
  return (DEMO_FIX_SITE_IDS as readonly string[]).includes(siteId);
}

/**
 * The recorded edits for a fix of a demo site, or null. Served only when the fix id matches and every target's
 * outer HTML equals the recorded one (the page is the page the edit was written for), and the edits still pass
 * the validator. Returns source "recorded".
 */
export function recordedEdits(siteId: string, item: FixRequestItem, recordings: Record<string, FixRecordingFile> = DEMO_FIX_RECORDINGS): FixEdits | null {
  if (!isDemoSite(siteId) || !Object.hasOwn(recordings, siteId)) return null;
  const found = recordings[siteId].fixes.find(
    (f) => f.fixId === item.fixId && f.outerHTML.length === item.targets.length && f.outerHTML.every((html, i) => html === item.targets[i].outerHTML),
  );
  if (!found) return null;
  const checked = validateEdits(item, found.result);
  if (!("ok" in checked)) return null;
  return { ...checked.ok, source: "recorded" };
}

// ---------------------------------------------------------------------------------------------------------
// Recording mode

/** True when this run should write agent results into fixtures/fix: LIVEFIX_RECORD=1, not production, demo site. */
export function recordingEnabled(siteId: string, env: Env = process.env): boolean {
  return env.LIVEFIX_RECORD === "1" && env.NODE_ENV !== "production" && isDemoSite(siteId);
}

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Saves one agent result into fixtures/fix/<siteId>.json (created, or merged by fixId). Does nothing unless
 * recordingEnabled. Writes are serialised so concurrent fixes of one run do not overwrite each other. Never throws.
 */
export function recordEdits(siteId: string, item: FixRequestItem, result: FixEdits, opts: { env?: Env; dir?: string } = {}): Promise<void> {
  if (!recordingEnabled(siteId, opts.env ?? process.env) || result.source !== "agent") return Promise.resolve();
  const dir = opts.dir ?? path.join(process.cwd(), "fixtures", "fix");
  const file = path.join(dir, `${siteId}.json`);
  const run = async (): Promise<void> => {
    let existing: FixRecordingFile = { fixes: [] };
    try {
      existing = parseRecordingFile(JSON.parse(await readFile(file, "utf8")));
    } catch {
      // No file yet (or unreadable): start a new one.
    }
    const entry = { fixId: item.fixId, outerHTML: item.targets.map((t) => t.outerHTML), result };
    const fixes = [...existing.fixes.filter((f) => f.fixId !== item.fixId), entry];
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${JSON.stringify({ fixes }, null, 2)}\n`, "utf8");
  };
  writeQueue = writeQueue.then(run).catch(() => {
    console.error(`[fix] could not record ${item.kind}`);
  });
  return writeQueue;
}
