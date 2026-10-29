import { handleKPath } from "../../shared/k-route";
import type { SearchLimits } from "../../shared/search";
import { PLATFORM_IDS } from "../../shared/platforms";
import { createRateLimiter } from "../../shared/rate-limit";
import { normalizeColo } from "../../shared/reliability";
import { searchPlatforms } from "../../shared/search";
import { fetchers } from "../lib/providers";

/**
 * Same budget as /api/search, on its own bucket: reading a landing page must
 * not spend the visitor's search allowance, and a crawler walking the sitemap
 * must not either. When the bucket is empty the page still renders, just
 * without live prices.
 */
const allowLiveFetch = createRateLimiter(20, 60_000);

interface KEnv {
  CF_PAGES_COMMIT_SHA?: string;
}

export const onRequestGet: PagesFunction<KEnv> = async (context) => {
  const url = new URL(context.request.url);
  const ip = context.request.headers.get("CF-Connecting-IP") ?? "local";

  const result = await handleKPath({
    pathname: url.pathname,
    version: context.env.CF_PAGES_COMMIT_SHA ?? "dev",
    // The budget comes from the route so one slow shop cannot hold the page;
    // anything it misses is picked up by the browser refresh right after.
    search: allowLiveFetch(`k:${ip}`, Date.now())
      ? (keyword: string, limits: SearchLimits) =>
          searchPlatforms(
            keyword,
            PLATFORM_IDS,
            fetchers,
            () => new Date(),
            normalizeColo(context.request.cf?.colo),
            limits,
          )
      : undefined,
  });

  return new Response(result.body, {
    status: result.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": result.cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
};
