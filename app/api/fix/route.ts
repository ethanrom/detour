import { handleFixRequest } from "@/lib/livefix/route";

// Node.js runtime (the default). Streams NDJSON through a plain ReadableStream.
// Each fix runs in parallel; one agent attempt may take up to 20 s and there is at most one retry, so allow 60 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  return handleFixRequest(req);
}
