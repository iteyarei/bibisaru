import { handleKPath } from "../../shared/k-route";
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
    search: allowLiveFetch(`k:${ip}`, Date.now())
      ? (keyword) =>
          searchPlatforms(keyword, PLATFORM_IDS, fetchers, () => new Date(), normalizeColo(context.request.cf?.colo))
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
