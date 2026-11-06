import { handleProxyRequest } from "@/lib/proxy/handler";

// Node.js runtime (the default). The `runtime` segment config is not allowed with cacheComponents.
// Reading `req.url` in the handler makes this route dynamic (never prerendered at build time).
export async function GET(req: Request): Promise<Response> {
  return handleProxyRequest(req);
}
