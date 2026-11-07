import { requireIdentity } from "../../../cursor/identity.js";
import { beginProbe, endProbe, liveProbeEnabled, parseProbeBody, sameOrigin, type ShopName } from "../../../lib/gate";
import { probeShop } from "../../../lib/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const HEADER = "x-shop-reach";

function envOf(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function withPrivate(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}

function held(platform: ShopName | null, reason: string) {
  return {
    platform,
    testedAt: new Date().toISOString(),
    sent: false,
    httpStatus: null,
    parsed: false,
    count: null,
    ok: false,
    reason,
  };
}

export async function POST(request: Request): Promise<Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return withPrivate(identity);
  if (identity.kind !== "person" || typeof identity.sub !== "string" || identity.sub.length === 0) {
    return json(held(null, "person_only"), 403);
  }
  if (request.headers.get(HEADER) !== "1") return json(held(null, "bad_request"), 400);
  if (
    !sameOrigin(
      {
        url: request.url,
        host: request.headers.get("host"),
        forwardedHost: request.headers.get("x-forwarded-host"),
      },
      request.headers.get("origin"),
    )
  ) {
    return json(held(null, "bad_request"), 400);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 4_096) return json(held(null, "bad_request"), 400);
  const raw = await request.text();
  if (raw.length > 4_096) return json(held(null, "bad_request"), 400);
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return json(held(null, "bad_request"), 400);
  }
  const parsed = parseProbeBody(body);
  if ("error" in parsed) return json(held(null, parsed.error), 400);

  const stage = typeof identity.stage === "string" ? identity.stage : undefined;
  if (!liveProbeEnabled(envOf(), stage)) {
    const reason = stage === "preview" ? "preview_host" : "preview_only";
    return json({ ...held(parsed.platform, reason), platform: parsed.platform });
  }

  const slot = beginProbe(identity.sub, parsed.platform, Date.now());
  if (slot !== "ok") return json({ ...held(parsed.platform, slot), platform: parsed.platform });
  try {
    const result = await probeShop(parsed.platform, parsed.keyword);
    return json(result);
  } catch {
    return json({ ...held(parsed.platform, "exception: unknown"), platform: parsed.platform });
  } finally {
    endProbe(identity.sub, parsed.platform);
  }
}
