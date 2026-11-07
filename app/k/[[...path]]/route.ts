import { handleKeyword } from "../../../server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function GET(request: Request): Promise<Response> {
  return handleKeyword(request);
}
