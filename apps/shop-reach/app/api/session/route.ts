import { getIdentity } from "../../../cursor/identity.js";
import { liveProbeEnabled } from "../../../lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envOf(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const identity = await getIdentity(request);
  if (!identity.verified || identity.kind !== "person") {
    return json({ signedIn: false, live: false, simulated: false }, 401);
  }
  const stage = typeof identity.stage === "string" ? identity.stage : undefined;
  return json({
    signedIn: true,
    live: liveProbeEnabled(envOf(), stage),
    simulated: identity.simulated === true,
  });
}
