export const KEYWORD_MAX = 40;
export const COOLDOWN_MS = 4_000;

export type ShopName = "coupang" | "rakuten";

export type ProbeBody =
  | { platform: ShopName; keyword: string }
  | { error: "bad_request" | "empty_keyword" | "keyword_too_long" };

/** Upstream calls run only on the published app, never on a local or preview host. */
export function liveProbeEnabled(env: Record<string, string | undefined>, stage: string | undefined): boolean {
  return Boolean(env.CURSOR_APP_ID?.trim()) && stage === "production";
}

export function parseProbeBody(body: unknown): ProbeBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "bad_request" };
  const record = body as Record<string, unknown>;
  if (record.platform !== "coupang" && record.platform !== "rakuten") return { error: "bad_request" };
  if (typeof record.keyword !== "string") return { error: "bad_request" };
  const keyword = record.keyword.trim();
  if (!keyword) return { error: "empty_keyword" };
  if (keyword.length > KEYWORD_MAX) return { error: "keyword_too_long" };
  if (/[\u0000-\u001f\u007f]/.test(keyword)) return { error: "bad_request" };
  return { platform: record.platform, keyword };
}

function hostnameOf(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * A browser form from another site sends that site's Origin. The app host is
 * the Host header the browser used; the platform may rewrite `request.url`.
 */
export function sameOrigin(
  request: { url: string; host: string | null; forwardedHost: string | null },
  origin: string | null,
): boolean {
  if (!origin) return true;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
  const names = new Set<string>();
  for (const value of [request.host, request.forwardedHost]) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const name = hostnameOf(part);
      if (name) names.add(name);
    }
  }
  try {
    names.add(new URL(request.url).hostname.toLowerCase());
  } catch {
    // The request URL is not needed when a forwarded host already matched.
  }
  return names.has(originUrl.hostname.toLowerCase());
}

/**
 * The published host may drop the page's custom header. A same-origin fetch is
 * still the page itself. A cross-site page is refused.
 */
export function acceptsProbeCall(input: {
  site: string | null;
  origin: string | null;
  url: string;
  host: string | null;
  forwardedHost: string | null;
}): boolean {
  const site = (input.site ?? "").trim().toLowerCase();
  if (site === "cross-site" || site === "same-site") return false;
  if (site === "same-origin") return true;
  return sameOrigin(input, input.origin);
}

const lastSent = new Map<string, number>();
const inFlight = new Set<string>();

function slot(viewer: string, platform: ShopName): string {
  return `${platform}\u0000${viewer}`;
}

export function beginProbe(viewer: string, platform: ShopName, now: number): "ok" | "cooldown" | "busy" {
  const key = slot(viewer, platform);
  if (inFlight.has(key)) return "busy";
  const prev = lastSent.get(key);
  if (prev !== undefined && now - prev < COOLDOWN_MS) return "cooldown";
  inFlight.add(key);
  lastSent.set(key, now);
  return "ok";
}

export function endProbe(viewer: string, platform: ShopName): void {
  inFlight.delete(slot(viewer, platform));
}

export function resetProbeSlots(): void {
  lastSent.clear();
  inFlight.clear();
}
