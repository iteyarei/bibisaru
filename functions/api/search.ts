import { messages } from "../../shared/i18n";
import { parsePlatformParam } from "../../shared/platforms";
import { normalizeQuery } from "../../shared/query";
import { createRateLimiter } from "../../shared/rate-limit";
import {
  logUnavailableShops,
  normalizeColo,
  searchCacheControl,
  searchCacheUrl,
  searchCacheVersion,
} from "../../shared/reliability";
import { searchPlatforms } from "../../shared/search";
import { readFetchColo } from "../../shared/trace";
import { fetchers } from "../lib/providers";

const allow = createRateLimiter(20, 60_000);

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

async function matchCache(key: Request): Promise<Response | undefined> {
  try {
    return await caches.default.match(key);
  } catch {
    return undefined;
  }
}

interface SearchEnv {
  CF_PAGES_COMMIT_SHA?: string;
}

export const onRequestGet: PagesFunction<SearchEnv> = async (context) => {
  const url = new URL(context.request.url);
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  if (!query) return json({ error: messages.missingQuery }, 400, "no-store");

  const ids = parsePlatformParam(url.searchParams.get("platforms"));
  if (!ids.length) return json({ error: messages.enableOne }, 400, "no-store");

  const version = searchCacheVersion(context.env.CF_PAGES_COMMIT_SHA);
  const cacheKey = new Request(searchCacheUrl(context.request.url, query, ids, version), { method: "GET" });
  const cached = await matchCache(cacheKey);
  if (cached) return cached;

  const ip = context.request.headers.get("CF-Connecting-IP") ?? "local";
  if (!allow(ip, Date.now())) {
    return json({ error: messages.rateLimited }, 429, "no-store", { "retry-after": "60" });
  }

  const colo = normalizeColo(context.request.cf?.colo);
  const fetchColoPromise = readFetchColo();
  const body = await searchPlatforms(query, ids, fetchers, () => new Date(), colo);
  body.meta.fetchColo = await fetchColoPromise;
  logUnavailableShops(body.platforms, colo, console.log, body.meta.fetchColo);
  const cacheControl = searchCacheControl(body.platforms);
  const response = json(body, 200, cacheControl);
  if (cacheControl !== "no-store") {
    context.waitUntil(
      (async () => {
        try {
          await caches.default.put(cacheKey, response.clone());
        } catch {
          // Edge cache is best-effort. A miss still returns the fresh body.
        }
      })(),
    );
  }
  return response;
};
