import { handleFixRequest } from "@/lib/livefix/route";

// Node.js runtime (the default). Streams NDJSON through a plain ReadableStream, so no route config is needed.
export async function POST(req: Request): Promise<Response> {
  return handleFixRequest(req);
}
