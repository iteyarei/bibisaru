import { platformSearchUrl } from "./platforms";
import { normalizeQuery } from "./query";
import { normalizeColo } from "./reliability";
import { unavailableResult } from "./search";
import type { PlatformFetcher, PlatformId, PlatformResult, Product } from "./types";

/** Header carrying the shared secret. The value is never written to logs or URLs. */
export const PROXY_TOKEN_HEADER = "PROXY_TOKEN";
export const PROXY_FETCH_PATH = "/v1/fetch";
export const PROXY_PLATFORMS = ["pxgo", "coupang", "shopee", "rakuten", "ruten", "yahoo"] as const;
export type ProxyPlatform = (typeof PROXY_PLATFORMS)[number];

/** Long enough for 全聯's two 10s attempts plus the pause, still under the Pages limit. */
export const PROXY_CLIENT_TIMEOUT_MS = 25_000;

export interface ProxyShopResponse {
  fetchColo: string;
  platform: ProxyPlatform;
  status: "ok" | "unavailable";
  products: Product[];
  reason?: string;
}

export function isProxyPlatform(value: string): value is ProxyPlatform {
  return (PROXY_PLATFORMS as readonly string[]).includes(value);
}

function processEnv(): Record<string, string | undefined> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env ?? {};
}

export function cleanProxyToken(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, "").trim();
}

/** https only, except loopback for tests. Rejects anything else. */
export function proxyBaseUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function readProxyConfig(env: { FETCH_PROXY_URL?: string; PROXY_TOKEN?: string } = processEnv()): {
  url: string;
  token: string;
} | null {
  const url = proxyBaseUrl(env.FETCH_PROXY_URL);
  const token = cleanProxyToken(env.PROXY_TOKEN);
  if (!url || !token) return null;
  return { url, token };
}

/** Constant-time compare. An empty expected token never matches. */
export function proxyTokensMatch(provided: string, expected: string): boolean {
  const left = new TextEncoder().encode(provided);
  const right = new TextEncoder().encode(expected);
  if (expected.length === 0 || left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export function redactProxyToken(text: string, token: string): string {
  const secret = cleanProxyToken(token);
  if (secret.length < 8 || !text.includes(secret)) return text;
  return text.split(secret).join("[redacted]");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sanitizeProxyProducts(platform: PlatformId, value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  const products: Product[] = [];
  for (const item of value) {
    if (products.length >= 24) break;
    const row = asRecord(item);
    if (!row) continue;
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 300) : "";
    const price = typeof row.price === "number" && Number.isFinite(row.price) ? Math.round(row.price) : 0;
    const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image : "";
    const url = typeof row.url === "string" && row.url.startsWith("https://") ? row.url : "";
    if (!title || price <= 0 || !url) continue;
    const rank = typeof row.rank === "number" && Number.isFinite(row.rank) ? Math.max(0, Math.round(row.rank)) : products.length;
    products.push({ platform, title, price, image, url, rank });
  }
  return products;
}

export function parseProxyShopResponse(value: unknown, expected: ProxyPlatform): ProxyShopResponse | null {
  const row = asRecord(value);
  if (!row) return null;
  if (row.platform !== expected || (row.status !== "ok" && row.status !== "unavailable")) return null;
  const fetchColo = normalizeColo(typeof row.fetchColo === "string" ? row.fetchColo : "");
  const reason = typeof row.reason === "string" ? row.reason.replace(/[\r\n]+/g, " ").trim().slice(0, 160) : undefined;
  const parsed: ProxyShopResponse = {
    fetchColo,
    platform: expected,
    status: row.status,
    products: row.status === "ok" ? sanitizeProxyProducts(expected, row.products) : [],
  };
  if (reason) parsed.reason = reason;
  return parsed;
}

export interface ProxyCall {
  result: PlatformResult | null;
  /** 401 from the Worker. Do not fall back; the token is wrong and the reason is safe. */
  unauthorized: boolean;
}

/**
 * Ask the US Worker to fetch one shop. Returns a result to use, or null when the
 * caller should fall back to a direct fetch. Never puts the token in the URL.
 */
export async function callFetchProxy(
  platform: ProxyPlatform,
  query: string,
  config: { url: string; token: string },
  doFetch: typeof fetch = fetch,
): Promise<ProxyCall> {
  const base = proxyBaseUrl(config.url);
  const token = cleanProxyToken(config.token);
  if (!base || !token || !normalizeQuery(query)) return { result: null, unauthorized: false };
  try {
    const response = await doFetch(`${base}${PROXY_FETCH_PATH}`, {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        [PROXY_TOKEN_HEADER]: token,
      },
      body: JSON.stringify({ platform, query }),
      signal: AbortSignal.timeout(PROXY_CLIENT_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return {
        result: { ...unavailableResult(platform, query, "exception: proxy unauthorized"), fetchColo: "" },
        unauthorized: true,
      };
    }
    if (!response.ok) return { result: null, unauthorized: false };
    const parsed = parseProxyShopResponse(JSON.parse(await response.text()) as unknown, platform);
    if (!parsed) return { result: null, unauthorized: false };
    const result: PlatformResult = {
      id: platform,
      status: parsed.status,
      products: parsed.products,
      searchUrl: platformSearchUrl(platform, query),
      fetchColo: parsed.fetchColo,
    };
    if (parsed.reason) result.reason = redactProxyToken(parsed.reason, token);
    return { result, unauthorized: false };
  } catch {
    return { result: null, unauthorized: false };
  }
}

/** Use the US Worker for 全聯, 酷澎, 蝦皮, 樂天, and 露天 when both env values are set. */
export async function fetchProxiedShop(
  platform: ProxyPlatform,
  query: string,
  direct: PlatformFetcher,
  config: { url: string; token: string } | null = readProxyConfig(),
  doFetch: typeof fetch = fetch,
): Promise<PlatformResult> {
  if (!config) return direct(query);
  const remote = await callFetchProxy(platform, query, config, doFetch);
  if (remote.unauthorized && remote.result) return remote.result;
  if (remote.result) return remote.result;
  return direct(query);
}
