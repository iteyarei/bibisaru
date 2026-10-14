import type { PlatformId, PlatformStatus } from "./types";

/**
 * One attempt. A scraped shop may run a second attempt after a short pause.
 * Shops run at the same time, so the wait is the slower shop, not the sum.
 * Two 8s attempts plus the pause stay under the Pages request limit of about 30s.
 */
export const PLATFORM_TIMEOUT_MS = 8_000;
export const PLATFORM_RETRY_DELAY_MS = 300;
export const PAGES_REQUEST_LIMIT_MS = 30_000;

/** Long edge cache. Shortened when a shop we expect to scrape did not answer. */
export const SEARCH_CACHE_SECONDS = 180;
export const SEARCH_CACHE_BROWSER_SECONDS = 30;
export const SEARCH_DEGRADED_CACHE_SECONDS = 20;

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
  "kingstone",
  "sanmin",
];

export function worstScrapedWaitMs(): number {
  return PLATFORM_TIMEOUT_MS * 2 + PLATFORM_RETRY_DELAY_MS;
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
): Promise<T> {
  const first = await run({ fresh: false });
  if (first.status === "ok") return first;
  await wait(PLATFORM_RETRY_DELAY_MS);
  return run({ fresh: true });
}

export function searchCacheSeconds(
  platforms: readonly { id: PlatformId; status: PlatformStatus }[],
): number {
  const scrapedFailed = platforms.some(
    (platform) => platform.status === "unavailable" && !EXPECTED_UNAVAILABLE.includes(platform.id),
  );
  return scrapedFailed ? SEARCH_DEGRADED_CACHE_SECONDS : SEARCH_CACHE_SECONDS;
}

export function searchCacheControl(
  platforms: readonly { id: PlatformId; status: PlatformStatus }[],
): string {
  const seconds = searchCacheSeconds(platforms);
  if (seconds < SEARCH_CACHE_SECONDS) return `public, max-age=${seconds}, s-maxage=${seconds}`;
  return `public, max-age=${SEARCH_CACHE_BROWSER_SECONDS}, s-maxage=${SEARCH_CACHE_SECONDS}`;
}
