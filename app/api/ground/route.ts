import { handleGroundRequest } from "@/lib/llm/groundRoute";

// Node.js runtime (the default). The `runtime` segment config is not allowed with cacheComponents.
export async function POST(req: Request): Promise<Response> {
  return handleGroundRequest(req);
}
