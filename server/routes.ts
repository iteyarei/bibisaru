import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchers } from "../functions/lib/providers";
import { handleKPath } from "../shared/k-route";
import { messages } from "../shared/i18n";
import { PLATFORM_IDS, parsePlatformParam } from "../shared/platforms";
import { normalizeQuery } from "../shared/query";
import { createRateLimiter } from "../shared/rate-limit";
import {
  logUnavailableShops,
  searchCacheControl,
  searchCacheKeyFromRequest,
  searchCacheVersion,
} from "../shared/reliability";
import { searchPlatforms } from "../shared/search";
import { buildSitemap } from "../shared/sitemap";
import { SITE_ORIGIN } from "../shared/k-slugs";
import { readMemoryCache, writeMemoryCache } from "./memory-cache";
import { visitorKey, withinBudget } from "./visitor";

/**
 * Official public origin for 比比猴 on this host.
 * Canonical, Open Graph, sitemap, robots, and structured-data URLs use this.
 * They must not follow the temporary Vercel deployment hostname the proxy
 * presents as Host / x-forwarded-host. The Cloudflare site keeps SITE_ORIGIN.
 */
export const OFFICIAL_ORIGIN = "https://bibisaru.apps.grok.bot";

/** Swap the built-in pages.dev origin for the official host, leaving every other URL alone. */
export function withOfficialOrigin(html: string): string {
  return html.replaceAll(SITE_ORIGIN, OFFICIAL_ORIGIN);
}

/**
 * Host the proxy connected to. Only the in-memory cache key uses it, so two
 * deployment hostnames do not share one entry. It is not a public URL.
 */
function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const rawHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0]?.trim() ?? "";
  const host = /^[A-Za-z0-9.-]+(?::\d+)?$/.test(rawHost) ? rawHost : url.host;
  const rawProto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0]?.trim() ?? "";
  const proto = rawProto === "http" || rawProto === "https" ? rawProto : "https";
  return `${proto}://${host}`;
}

/** This host has no Cloudflare colo. The label tells the card where the fetch ran. */
export const HOST_COLO = "cursor";

const allowSearchVisitor = createRateLimiter(20, 60_000);
const allowSearchAll = createRateLimiter(180, 60_000);
const allowLiveVisitor = createRateLimiter(20, 60_000);
const allowLiveAll = createRateLimiter(180, 60_000);

function deployVersion(): string {
  return searchCacheVersion(process.env.BIBISARU_BUILD || process.env.CF_PAGES_COMMIT_SHA);
}

function json(body: unknown, status: number, cacheControl: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? cacheControl : "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

export async function handleSearch(request: Request, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  if (!query) return json({ error: messages.missingQuery }, 400, "no-store");

  const ids = parsePlatformParam(url.searchParams.get("platforms"));
  if (!ids.length) return json({ error: messages.enableOne }, 400, "no-store");

  const version = deployVersion();
  const cacheKey = searchCacheKeyFromRequest(request.url, version);
  if (cacheKey) {
    const cached = readMemoryCache(cacheKey, now);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: {
          "content-type": cached.contentType,
          "cache-control": cached.cacheControl,
          "x-content-type-options": "nosniff",
        },
      });
    }
  }

  const ip = visitorKey(request);
  if (!withinBudget(allowSearchVisitor, allowSearchAll, ip, now)) {
    return json({ error: messages.rateLimited }, 429, "no-store", { "retry-after": "60" });
  }

  const body = await searchPlatforms(query, ids, fetchers, () => new Date(now), "", undefined);
  body.meta.fetchColo = HOST_COLO;
  logUnavailableShops(body.platforms, "", console.log, body.meta.fetchColo);
  const cacheControl = searchCacheControl(body.platforms);
  const payload = JSON.stringify(body);
  if (cacheKey) {
    writeMemoryCache(cacheKey, {
      status: 200,
      body: payload,
      cacheControl,
      contentType: "application/json; charset=utf-8",
    }, now);
  }
  return json(body, 200, cacheControl);
}

export async function handleKeyword(request: Request, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const version = deployVersion();
  const cacheKey = `k:${origin}:${url.pathname}:${version}`;
  const cached = readMemoryCache(cacheKey, now);
  if (cached) {
    return html(cached.body, cached.status, cached.cacheControl);
  }

  const ip = visitorKey(request);
  const result = await handleKPath({
    pathname: url.pathname,
    version,
    now: new Date(now),
    search: withinBudget(allowLiveVisitor, allowLiveAll, `k:${ip}`, now)
      ? (keyword, limits) => searchPlatforms(keyword, PLATFORM_IDS, fetchers, () => new Date(now), "", limits)
      : undefined,
  });
  const body = withOfficialOrigin(result.body);
  if (body) {
    writeMemoryCache(cacheKey, {
      status: result.status,
      body,
      cacheControl: result.cacheControl,
      contentType: "text/html; charset=utf-8",
    }, now);
  }
  return html(body, result.status, result.cacheControl);
}

export function handleRobots(_request: Request): Response {
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${OFFICIAL_ORIGIN}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export function handleSitemap(_request: Request): Response {
  const body = buildSitemap(OFFICIAL_ORIGIN);
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export function handleHome(_request: Request): Response {
  let htmlText: string;
  try {
    htmlText = readFileSync(join(process.cwd(), "dist", "index.html"), "utf8");
  } catch {
    return new Response("比比猴的頁面還沒建好。", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return html(withOfficialOrigin(htmlText), 200, "no-cache");
}

function html(body: string, status: number, cacheControl: string): Response {
  // Do not set X-Robots-Tag here. The live public host is fetched through a
  // Vercel deployment URL, so a host check cannot tell production from preview.
  // Vercel already sends noindex on that deployment URL; adding another one
  // would keep the official site out of search even after the platform stops.
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}
