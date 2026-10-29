import { parsePlatformParam } from "./platforms";
import { normalizeQuery } from "./query";
import type { PlatformId, PlatformStatus } from "./types";

/**
 * One attempt. A scraped shop may run a second attempt after a short pause.
 * Shops run at the same time, so the wait is the slower shop, not the sum.
 * 全聯 uses a longer timeout. Two attempts plus its pause stay under about 30s.
 */
export const PLATFORM_TIMEOUT_MS = 8_000;
export const PLATFORM_RETRY_DELAY_MS = 300;
export const PXGO_TIMEOUT_MS = 10_000;
export const PXGO_RETRY_DELAY_MS = 800;
export const PAGES_REQUEST_LIMIT_MS = 30_000;

/**
 * How long the /k/ landing page waits for the shops before it renders with
 * whatever came back. The page is a first paint, not the final word: the
 * browser then asks /api/search and swaps in the complete list, so a shop that
 * misses the budget still appears a second later. Without this cap one dead
 * shop (奇摩) held every landing page for over ten seconds.
 */
export const K_PAGE_FETCH_BUDGET_MS = 1_800;
/**
 * Extra time, granted once, when the budget ran out and no shop has returned a
 * single product yet. An empty page is worse than a slow one, so this is the
 * one case where the page keeps waiting.
 */
export const K_PAGE_FETCH_EXTEND_MS = 1_200;

/** Long edge cache. A failed scraped shop is not cached at all. */
export const SEARCH_CACHE_SECONDS = 180;
export const SEARCH_CACHE_BROWSER_SECONDS = 30;

/**
 * These shops are often only a search link. Their failure must not throw away
 * a good cache of the shops that did return products.
 */
export const EXPECTED_UNAVAILABLE: readonly PlatformId[] = ["coupang", "shopee"];

/** HTML or JSON scrapes. Coupang has its own API path and is not retried here. */
export const RETRIED_PLATFORMS: readonly PlatformId[] = [
  "momo",
  "pchome",
  "yahoo",
  "shopee",
  "pxgo",
  "etmall",
  "rakuten",
  "ruten",
];

export function timeoutFor(id: PlatformId): number {
  return id === "pxgo" ? PXGO_TIMEOUT_MS : PLATFORM_TIMEOUT_MS;
}

export function retryDelayFor(id: PlatformId): number {
  return id === "pxgo" ? PXGO_RETRY_DELAY_MS : PLATFORM_RETRY_DELAY_MS;
}

export function worstScrapedWaitMs(): number {
  const budgets = (RETRIED_PLATFORMS as readonly PlatformId[]).map(
    (id) => timeoutFor(id) * 2 + retryDelayFor(id),
  );
  return Math.max(...budgets);
}

export function retriesPlatform(id: PlatformId): boolean {
  return (RETRIED_PLATFORMS as readonly string[]).includes(id);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout/i.test(message);
}

/** Safe diagnostic for an unavailable shop. Never includes secrets. */
export function failureReason(error: unknown): string {
  if (isTimeoutError(error)) return "timeout";
  if (error instanceof SyntaxError) return "parse_error";
  const message = error instanceof Error ? error.message : "unknown";
  const flat = message.replace(/[\r\n]+/g, " ").trim();
  const clipped = flat.length > 120 ? flat.slice(0, 120) : flat;
  return `exception: ${clipped || "unknown"}`;
}

export async function retryPlatform<T extends { status: "ok" | "unavailable" }>(
  run: (attempt: { fresh: boolean }) => Promise<T>,
  wait: (ms: number) => Promise<void> = delay,
  pauseMs: number = PLATFORM_RETRY_DELAY_MS,
): Promise<T> {
  const first = await run({ fresh: false });
  if (first.status === "ok") return first;
  await wait(pauseMs);
  return run({ fresh: true });
}

export function scrapedShopFailed(
  platforms: readonly { id: PlatformId; status: PlatformStatus }[],
): boolean {
  return platforms.some(
    (platform) => platform.status === "unavailable" && !EXPECTED_UNAVAILABLE.includes(platform.id),
  );
}

/** no-store when a scraped shop failed. Link-only shops do not force that. */
export function searchCacheControl(
  platforms: readonly { id: PlatformId; status: PlatformStatus }[],
): string {
  if (scrapedShopFailed(platforms)) return "no-store";
  // 奇摩的 0 筆是它真的查無此商品（不是被擋），但這種答案不值得壓在邊緣 3 分鐘：
  // 換個字就該重問，所以照舊不寫入快取。
  if (platforms.some((platform) => platform.status === "empty" && platform.id === "yahoo")) {
    return "no-store";
  }
  return `public, max-age=${SEARCH_CACHE_BROWSER_SECONDS}, s-maxage=${SEARCH_CACHE_SECONDS}`;
}

/** Pages sets CF_PAGES_COMMIT_SHA. Anything else shares the dev cache. */
export function searchCacheVersion(commitSha: string | undefined | null): string {
  const sha = typeof commitSha === "string" ? commitSha.trim() : "";
  if (/^[0-9a-f]{7,64}$/i.test(sha)) return sha.toLowerCase();
  return "dev";
}

/**
 * Edge cache key. `version` is the deploy id, so a new build never reads the previous one.
 * The visitor's own `v` query is ignored here; the server version is the source of truth.
 */
export function searchCacheUrl(
  requestUrl: string,
  query: string,
  platforms: readonly string[],
  version: string,
): string {
  const url = new URL(requestUrl);
  url.search = "";
  url.searchParams.set("q", query);
  url.searchParams.set("platforms", platforms.join(","));
  url.searchParams.set("v", version || "dev");
  return url.toString();
}

/** Normalize the query the same way the handler does, then attach the deploy version. */
export function searchCacheKeyFromRequest(requestUrl: string, version: string): string | null {
  const url = new URL(requestUrl);
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  if (!query) return null;
  const ids = parsePlatformParam(url.searchParams.get("platforms"));
  if (!ids.length) return null;
  return searchCacheUrl(requestUrl, query, ids, searchCacheVersion(version));
}

export function normalizeColo(value: unknown): string {
  if (typeof value !== "string") return "";
  const colo = value.trim();
  if (!/^[A-Za-z]{3}$/.test(colo)) return "";
  return colo.toUpperCase();
}

export function unavailableLogLine(
  id: string,
  reason: string | undefined,
  colo: string,
  fetchColo = "",
): string {
  const why = reason?.replace(/[\r\n]+/g, " ").trim() || "unknown";
  const where = colo.trim() || "unknown";
  const fetched = fetchColo.trim();
  const fetchPart = fetched ? ` fetchColo=${fetched}` : "";
  return `reason=${why} colo=${where}${fetchPart} platform=${id}`;
}

export function logUnavailableShops(
  platforms: readonly { id: string; status: string; reason?: string; fetchColo?: string }[],
  colo: string,
  write: (line: string) => void = console.log,
  fetchColo = "",
): void {
  for (const platform of platforms) {
    if (platform.status !== "unavailable") continue;
    write(unavailableLogLine(platform.id, platform.reason, colo, platform.fetchColo || fetchColo));
  }
}
