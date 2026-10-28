import { HOT_KEYWORDS } from "./hot-keywords";
import { pickKProducts } from "./k-pick";
import { snapshotDate, snapshotForSlug, type KSnapshot } from "./k-snapshots";
import { scrapedShopFailed } from "./reliability";
import { K_PAGE_ITEMS, renderKNotFound, renderKOverview, renderKPage, type KPageData } from "./k-page";
import { resolveKPath } from "./k-slugs";
import type { PlatformId, Product, SearchResponse } from "./types";

/**
 * Same edge window as /api/search, but the browser always revalidates: a reader
 * who comes back after a minute should not see yesterday's price.
 */
export const K_PAGE_CACHE_CONTROL = "public, max-age=0, s-maxage=180";

/** Live prices are reused for a moment inside one isolate so a crawl burst is cheap. */
export const K_REUSE_MS = 120_000;

const reuse = new Map<string, { at: number; body: SearchResponse }>();

/** Tests only: forget the per-isolate reuse so each case starts clean. */
export function resetKReuse(): void {
  reuse.clear();
}

function remember(key: string, body: SearchResponse, now: number): void {
  if (reuse.size > 200) {
    for (const [cached, entry] of reuse) if (now - entry.at > K_REUSE_MS) reuse.delete(cached);
    if (reuse.size > 400) reuse.clear();
  }
  reuse.set(key, { at: now, body });
}

export interface TopProductOptions {
  /** How many listings the page wants. */
  limit?: number;
  /** Shops that must not appear on this page. */
  excludePlatforms?: readonly PlatformId[];
  /** Round-robin order. Defaults to the canonical platform order. */
  platformOrder?: readonly PlatformId[];
}

/**
 * What one /k/ page shows: only listings whose title really carries the keyword,
 * spread across shops, then sorted cheapest first for the reader.
 *
 * It used to be "cheapest N of everything the shops sent back", which is how a
 * page titled 除濕機 ended up listing a NT$159 除濕盒 instead of a machine.
 */
export function topProducts(
  results: readonly Product[],
  keyword: string,
  options: TopProductOptions = {},
): Product[] {
  return pickKProducts(results, {
    keyword,
    limit: options.limit ?? K_PAGE_ITEMS,
    excludePlatforms: options.excludePlatforms ?? [],
    platformOrder: options.platformOrder,
  });
}

export interface KResult {
  status: number;
  body: string;
  cacheControl: string;
}

export interface KRouteOptions {
  pathname: string;
  /** Deploy id, so a new build never reuses the previous build's prices. */
  version?: string;
  /** Wall clock, injectable for tests. */
  now?: Date;
  /**
   * Runs the live shop search. Called only for a keyword on this week's list,
   * and only when the caller decides the visitor still has budget. Rejections
   * are swallowed: the page renders without prices instead.
   */
  search?: (keyword: string) => Promise<SearchResponse>;
  /** Slug map override. Tests use it to stand in for a keyword that was retired. */
  slugs?: ReadonlyMap<string, string>;
  /** Snapshot store override, normally `shared/k-snapshots.json`. */
  snapshots?: Readonly<Record<string, KSnapshot>>;
}

/**
 * The whole /k/ route, free of Cloudflare globals so it can be tested directly.
 * A known slug always answers 200 — even when every shop fails — because the
 * page still has its title, intro and live-search link. An unknown slug is a
 * real 404, never the homepage with a 200.
 */
export async function handleKPath(options: KRouteOptions): Promise<KResult> {
  const { pathname } = options;
  const now = options.now ?? new Date();
  const route = options.slugs ? resolveKPath(pathname, options.slugs) : resolveKPath(pathname);

  if (route.kind === "not-found") {
    return { status: 404, body: renderKNotFound(pathname), cacheControl: "no-store" };
  }
  if (route.kind === "overview") {
    return { status: 200, body: renderKOverview(now), cacheControl: K_PAGE_CACHE_CONTROL };
  }

  const { keyword, slug } = route;
  const hot = HOT_KEYWORDS.find((item) => item.keyword === keyword);

  // A keyword that fell off the hot list keeps its page forever. It is not
  // regenerated any more: the HTML carries the stored snapshot, dated the day
  // it was captured, and the browser-side refresh still looks for live prices.
  if (!hot) {
    const snapshot = snapshotForSlug(slug, options.snapshots);
    const archivedCategory = snapshot?.category ?? "其他";
    const products = topProducts(snapshot?.products ?? [], keyword);
    const data: KPageData = {
      keyword,
      slug,
      category: archivedCategory,
      reason: "",
      archived: true,
      products,
      platforms: [],
      fetchedAt: snapshot ? snapshotDate(snapshot) : now,
    };
    return {
      status: 200,
      body: renderKPage(data),
      cacheControl: products.length ? K_PAGE_CACHE_CONTROL : "no-store",
    };
  }

  const stamp = now.getTime();
  const key = `${slug}:${options.version ?? "dev"}`;
  const cached = reuse.get(key);
  let body: SearchResponse | null = null;
  if (cached && stamp - cached.at <= K_REUSE_MS) {
    body = cached.body;
  } else if (cached) {
    reuse.delete(key);
  }

  if (!body && options.search) {
    try {
      body = await options.search(keyword);
      remember(key, body, stamp);
    } catch {
      body = null;
    }
  }

  const data: KPageData = {
    keyword,
    slug,
    category: hot.category,
    reason: hot.reason,
    products: topProducts(body?.results ?? [], keyword),
    platforms: body?.platforms ?? [],
    fetchedAt: body ? new Date(body.fetchedAt) : now,
  };

  // A shop that failed must not be pinned at the edge for three minutes, the
  // same rule /api/search follows. A page with no data at all is never cached.
  const cacheControl =
    body && data.products.length > 0 && !scrapedShopFailed(body.platforms) ? K_PAGE_CACHE_CONTROL : "no-store";
  return { status: 200, body: renderKPage(data, now), cacheControl };
}
