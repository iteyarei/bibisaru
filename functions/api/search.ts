import { messages } from "../../shared/i18n";
import { parsePlatformParam } from "../../shared/platforms";
import { normalizeQuery } from "../../shared/query";
import { createRateLimiter } from "../../shared/rate-limit";
import { searchCacheControl } from "../../shared/reliability";
import { searchPlatforms } from "../../shared/search";
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

export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  if (!query) return json({ error: messages.missingQuery }, 400, "no-store");

  const ids = parsePlatformParam(url.searchParams.get("platforms"));
  if (!ids.length) return json({ error: messages.enableOne }, 400, "no-store");

  const cacheUrl = new URL(context.request.url);
  cacheUrl.search = "";
  cacheUrl.searchParams.set("q", query);
  cacheUrl.searchParams.set("platforms", ids.join(","));
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cached = await matchCache(cacheKey);
  if (cached) return cached;

  const ip = context.request.headers.get("CF-Connecting-IP") ?? "local";
  if (!allow(ip, Date.now())) {
    return json({ error: messages.rateLimited }, 429, "no-store", { "retry-after": "60" });
  }

  const body = await searchPlatforms(query, ids, fetchers);
  const response = json(body, 200, searchCacheControl(body.platforms));
  context.waitUntil(
    (async () => {
      try {
        await caches.default.put(cacheKey, response.clone());
      } catch {
        // Edge cache is best-effort. A miss still returns the fresh body.
      }
    })(),
  );
  return response;
};
