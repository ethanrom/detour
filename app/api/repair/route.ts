import { handleRepairRequest } from "@/lib/repair/route";

// Node.js runtime (the default). The `runtime` segment config is not allowed with cacheComponents.
export async function POST(req: Request): Promise<Response> {
  return handleRepairRequest(req);
}
