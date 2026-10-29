import { HOT_KEYWORDS } from "./hot-keywords";
import { flattenGroups, pickKGroups, type KPageGroup } from "./k-group";
import { pickKProducts } from "./k-pick";
import { snapshotDate, snapshotForSlug, type KSnapshot } from "./k-snapshots";
import { K_PAGE_FETCH_BUDGET_MS, K_PAGE_FETCH_EXTEND_MS, scrapedShopFailed } from "./reliability";
import { hasTimedOutShop, type SearchLimits } from "./search";
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
/**
 * The same idea, but for an answer where the fetch budget cut a shop off. It is
 * good enough to serve a burst of readers, but it is not the whole picture, so
 * it must not stand for two minutes while the shop may already be back.
 */
export const K_PARTIAL_REUSE_MS = 20_000;

/**
 * The landing page is a first paint, not the final word: the browser asks
 * /api/search right after it loads and swaps in the complete list. So the
 * server stops waiting early and renders what it has. One shop that is down
 * must not cost every reader ten seconds.
 */
export const K_SEARCH_LIMITS: SearchLimits = {
  budgetMs: K_PAGE_FETCH_BUDGET_MS,
  extendIfEmptyMs: K_PAGE_FETCH_EXTEND_MS,
};

const reuse = new Map<string, { at: number; body: SearchResponse; ttl?: number }>();

/** Tests only: forget the per-isolate reuse so each case starts clean. */
export function resetKReuse(): void {
  reuse.clear();
}

function remember(key: string, body: SearchResponse, now: number, ttl: number = K_REUSE_MS): void {
  if (reuse.size > 200) {
    for (const [cached, entry] of reuse) if (now - entry.at > K_REUSE_MS) reuse.delete(cached);
    if (reuse.size > 400) reuse.clear();
  }
  reuse.set(key, { at: now, body, ttl });
}

export interface KGroupOptions {
  keyword: string;
  category: string;
  /** Shops that must not appear on this page. */
  excludePlatforms?: readonly PlatformId[];
  /** Round-robin order. Defaults to the canonical platform order. */
  platformOrder?: readonly PlatformId[];
}

/**
 * The sections of one /k/ page. 3C and 家電 pages split into 主商品 and its
 * add-ons; every other category stays a single list, unchanged.
 */
export function pageGroups(results: readonly Product[], options: KGroupOptions): KPageGroup[] {
  return pickKGroups(results, {
    keyword: options.keyword,
    category: options.category,
    excludePlatforms: options.excludePlatforms ?? [],
    platformOrder: options.platformOrder,
  });
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
   * are swallowed: the page renders without prices instead. The limits are
   * handed over so the fetch itself can stop waiting; a caller that ignores
   * them simply waits for every shop.
   */
  search?: (keyword: string, limits: SearchLimits) => Promise<SearchResponse>;
  /** Slug map override. Tests use it to stand in for a keyword that was retired. */
  slugs?: ReadonlyMap<string, string>;
  /** Snapshot store override, normally `shared/k-snapshots.json`. */
  snapshots?: Readonly<Record<string, KSnapshot>>;
  /** Fetch limits handed to `search`. Tests shorten them to measure the cap. */
  limits?: SearchLimits;
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
    const groups = pageGroups(snapshot?.products ?? [], { keyword, category: archivedCategory });
    const products = flattenGroups(groups);
    const data: KPageData = {
      keyword,
      slug,
      category: archivedCategory,
      reason: "",
      archived: true,
      products,
      groups,
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
  if (cached && stamp - cached.at <= (cached.ttl ?? K_REUSE_MS)) {
    body = cached.body;
  } else if (cached) {
    reuse.delete(key);
  }

  if (!body && options.search) {
    try {
      body = await options.search(keyword, options.limits ?? K_SEARCH_LIMITS);
      // Reused for a burst of crawler hits, as before, so they do not each pay
      // for a fresh fan-out. An answer with a shop cut off by the budget is kept
      // only briefly: enough to cover a burst, short enough that the hole does
      // not outlive the moment it came from.
      remember(key, body, stamp, hasTimedOutShop(body.platforms) ? K_PARTIAL_REUSE_MS : K_REUSE_MS);
    } catch {
      body = null;
    }
  }

  const groups = pageGroups(body?.results ?? [], { keyword, category: hot.category });
  const data: KPageData = {
    keyword,
    slug,
    category: hot.category,
    reason: hot.reason,
    products: flattenGroups(groups),
    groups,
    platforms: body?.platforms ?? [],
    fetchedAt: body ? new Date(body.fetchedAt) : now,
  };

  // A shop that failed must not be pinned at the edge for three minutes, the
  // same rule /api/search follows. A page with no data at all is never cached.
  const cacheControl =
    body && data.products.length > 0 && !scrapedShopFailed(body.platforms) ? K_PAGE_CACHE_CONTROL : "no-store";
  return { status: 200, body: renderKPage(data, now), cacheControl };
}
