import { handleSitemap } from "../../server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return handleSitemap(request);
}
