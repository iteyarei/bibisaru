import { canonicalImageUrl, cleanTitle, parsePrice } from "./text";
import type { Product } from "./types";

/** Partners product search. The query string is signed exactly as it is sent, without `?`. */
export const COUPANG_API_ORIGIN = "https://api-gateway.tw.coupang.com";
export const COUPANG_API_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
export const COUPANG_SUB_ID = "bibisaru";
export const COUPANG_SEARCH_LIMIT = 10;

const COUPANG_HOST = /(^|\.)coupang\.com$/i;

function envValue(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name]?.trim() || undefined;
}

/** UTC timestamp in the Partners format `yyMMdd'T'HHmmss'Z'`. */
export function coupangSignedDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = pad(now.getUTCFullYear() % 100);
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());
  const second = pad(now.getUTCSeconds());
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/** Query exactly as it appears after `?`. `keyword` is URL-encoded. */
export function coupangSearchQuery(keyword: string): string {
  return `keyword=${encodeURIComponent(keyword)}&limit=${COUPANG_SEARCH_LIMIT}&subId=${encodeURIComponent(COUPANG_SUB_ID)}`;
}

export function coupangSignMessage(signedDate: string, query: string): string {
  return `${signedDate}GET${COUPANG_API_PATH}${query}`;
}

/** Lowercase hex HMAC-SHA256. The secret is only used as the HMAC key. */
export async function coupangHmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function coupangAuthorization(accessKey: string, signedDate: string, signature: string): string {
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keep an already-affiliate product URL. Do not rebuild or re-sign it. */
function coupangProductLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !COUPANG_HOST.test(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return raw;
}

/**
 * `null` when the payload is an error (`rCode` other than `"0"`, including HTTP 200 errors).
 * An empty `productData` array is a successful search with nothing to show.
 * The listed price is `productPrice`, not `firstPurchasePrice`.
 */
export function productsFromCoupangSearch(payload: unknown): Product[] | null {
  const root = asRecord(payload);
  if (!root || String(root.rCode) !== "0") return null;
  const data = asRecord(root.data);
  const list = data?.productData;
  if (!Array.isArray(list)) return null;
  const products: Product[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length && products.length < COUPANG_SEARCH_LIMIT; index += 1) {
    const row = asRecord(list[index]);
    if (!row) continue;
    const title = cleanTitle(typeof row.productName === "string" ? row.productName : "");
    const price = parsePrice(row.productPrice);
    const url = coupangProductLink(row.productUrl);
    if (!title || price === null || !url || seen.has(url)) continue;
    seen.add(url);
    products.push({
      platform: "coupang",
      title,
      price,
      image: canonicalImageUrl(typeof row.productImage === "string" ? row.productImage : ""),
      url,
      rank: index,
    });
  }
  return products;
}

export interface CoupangSearchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Pass `null` to force the missing-key path. Omit to read Pages secrets. */
  accessKey?: string | null;
  secretKey?: string | null;
}

function resolveKeys(options: CoupangSearchOptions): { accessKey: string; secretKey: string } | null {
  const accessKey = (options.accessKey === undefined ? envValue("COUPANG_ACCESS_KEY") : options.accessKey)?.trim() ?? "";
  const secretKey = (options.secretKey === undefined ? envValue("COUPANG_SECRET_KEY") : options.secretKey)?.trim() ?? "";
  if (!accessKey || !secretKey) return null;
  return { accessKey, secretKey };
}

function withEdgeCache(init: RequestInit): RequestInit {
  if (typeof caches === "undefined") return init;
  const cached = init as RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } };
  cached.cf = { cacheTtl: 180, cacheEverything: true };
  return cached;
}

/**
 * Search Coupang through the Partners Open API.
 * Returns `null` when the keys are missing or the call fails, so the caller can
 * show 暫時無法取得 and the affiliate search link. Keys are never written to logs.
 */
export async function searchCoupangPartners(keyword: string, options: CoupangSearchOptions = {}): Promise<Product[] | null> {
  const keys = resolveKeys(options);
  const trimmed = keyword.trim();
  if (!keys || !trimmed) return null;
  const query = coupangSearchQuery(trimmed);
  const signedDate = coupangSignedDate(options.now ?? new Date());
  const signature = await coupangHmacHex(keys.secretKey, coupangSignMessage(signedDate, query));
  const url = `${COUPANG_API_ORIGIN}${COUPANG_API_PATH}?${query}`;
  try {
    const response = await (options.fetchImpl ?? fetch)(
      url,
      withEdgeCache({
        method: "GET",
        headers: {
          accept: "application/json",
          Authorization: coupangAuthorization(keys.accessKey, signedDate, signature),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!response.ok) return null;
    return productsFromCoupangSearch(JSON.parse(await response.text()) as unknown);
  } catch {
    return null;
  }
}
