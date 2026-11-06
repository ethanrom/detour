import { handleGroundRequest } from "@/lib/llm/groundRoute";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return handleGroundRequest(req);
}
