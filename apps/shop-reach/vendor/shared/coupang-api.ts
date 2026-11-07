import { canonicalImageUrl, cleanTitle, parsePrice } from "./text";
import type { Product } from "./types";

/** Partners product search. The query string is signed exactly as it is sent, without `?`. */
export const COUPANG_API_ORIGIN = "https://api-gateway.tw.coupang.com";
export const COUPANG_API_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
export const COUPANG_SUB_ID = "bibisaru";
export const COUPANG_SEARCH_LIMIT = 10;

const COUPANG_HOST = /(^|\.)coupang\.com$/i;

function rawEnv(name: string): string | null | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

/** Drop embedded newlines, then trim. Pages secrets are often pasted with a trailing line break. */
export function cleanCoupangKey(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, "").trim();
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

export interface CoupangSearchOutcome {
  products: Product[] | null;
  /** Set only on failure. Safe to return in the API response. */
  reason?: string;
}

const REASON_LIMIT = 120;

function keyMaterial(options: CoupangSearchOptions): {
  accessKey: string;
  secretKey: string;
  accessPresent: boolean;
  secretPresent: boolean;
} {
  const accessKey = cleanCoupangKey(options.accessKey === undefined ? rawEnv("COUPANG_ACCESS_KEY") : options.accessKey);
  const secretKey = cleanCoupangKey(options.secretKey === undefined ? rawEnv("COUPANG_SECRET_KEY") : options.secretKey);
  return {
    accessKey,
    secretKey,
    accessPresent: accessKey.length > 0,
    secretPresent: secretKey.length > 0,
  };
}

function missingKeysReason(accessPresent: boolean, secretPresent: boolean): string {
  return `missing_keys COUPANG_ACCESS_KEY=${accessPresent} COUPANG_SECRET_KEY=${secretPresent}`;
}

function publicText(text: string, secrets: readonly string[], limit = REASON_LIMIT): string {
  let out = text.replace(/[\r\n]+/g, " ");
  const needles = secrets.filter((secret) => secret.length >= 8).sort((a, b) => b.length - a.length);
  for (const secret of needles) out = out.split(secret).join("[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > limit ? out.slice(0, limit) : out;
}

/** Title text when the gateway returns a document, otherwise the start of the body with tags removed. */
function htmlReason(status: number, text: string, secrets: readonly string[]): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const source = title?.[1]?.trim() ? title[1] : text;
  const stripped = source.replace(/<[^>]*>/g, " ");
  return `html_${status}: ${publicText(stripped, secrets, 150)}`;
}

function exceptionReason(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : "unknown";
  return `exception: ${publicText(message, secrets) || "unknown"}`;
}

function withEdgeCache(init: RequestInit): RequestInit {
  if (typeof caches === "undefined") return init;
  const cached = init as RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } };
  cached.cf = { cacheTtl: 180, cacheEverything: true };
  return cached;
}

/**
 * Search Coupang through the Partners Open API.
 * `products` is null when the keys are missing or the call fails. `reason` explains
 * that failure without ever including key values.
 */
export async function searchCoupangPartners(
  keyword: string,
  options: CoupangSearchOptions = {},
): Promise<CoupangSearchOutcome> {
  const keys = keyMaterial(options);
  if (!keys.accessPresent || !keys.secretPresent) {
    return { products: null, reason: missingKeysReason(keys.accessPresent, keys.secretPresent) };
  }
  const trimmed = keyword.trim();
  if (!trimmed) return { products: null, reason: "exception: empty keyword" };
  const secrets = [keys.accessKey, keys.secretKey];
  const query = coupangSearchQuery(trimmed);
  try {
    const signedDate = coupangSignedDate(options.now ?? new Date());
    const signature = await coupangHmacHex(keys.secretKey, coupangSignMessage(signedDate, query));
    const url = `${COUPANG_API_ORIGIN}${COUPANG_API_PATH}?${query}`;
    const response = await (options.fetchImpl ?? fetch)(
      url,
      withEdgeCache({
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
          "User-Agent": "bibisaru/1.0",
          Authorization: coupangAuthorization(keys.accessKey, signedDate, signature),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      }),
    );
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return { products: null, reason: htmlReason(response.status, text, secrets) };
    }
    if (!response.ok) return { products: null, reason: `http_${response.status}` };
    const root = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
    if (!root || String(root.rCode) !== "0") {
      const code = root ? String(root.rCode) : "missing";
      const message = typeof root?.rMessage === "string" ? root.rMessage : "";
      return { products: null, reason: `rcode_${code}: ${publicText(message, secrets)}` };
    }
    const products = productsFromCoupangSearch(payload);
    if (!products) return { products: null, reason: "exception: invalid payload" };
    return { products };
  } catch (error) {
    return { products: null, reason: exceptionReason(error, secrets) };
  }
}
