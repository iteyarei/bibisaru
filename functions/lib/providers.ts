import { searchCoupangPartners } from "../../shared/coupang-api";
import {
  etmallProducts,
  kingstoneProducts,
  momoProducts,
  normalizePchome,
  normalizeShopee,
  pxgoProducts,
  rakutenProducts,
  rutenProducts,
  rutenSearchIds,
  sanminProducts,
  yahooProducts,
} from "../../shared/normalize";
import { fetchProxiedShop, readProxyConfig } from "../../shared/proxy";
import { pxgoAttempt } from "../../shared/pxgo";
import { MAX_PER_PLATFORM, platformSearchUrl, rawSearchUrl } from "../../shared/platforms";
import {
  failureReason,
  PLATFORM_TIMEOUT_MS,
  retriesPlatform,
  retryDelayFor,
  retryPlatform,
} from "../../shared/reliability";
import { unavailableResult } from "../../shared/search";
import type { PlatformFetcher, PlatformId, PlatformResult, Product } from "../../shared/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DOCUMENT_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "upgrade-insecure-requests": "1",
};

const MAX_BYTES = 2_000_000;

function withEdgeCache(init: RequestInit): RequestInit {
  if (typeof caches === "undefined") return init;
  const cached = init as RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } };
  cached.cf = { cacheTtl: 180, cacheEverything: true };
  return cached;
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = MAX_BYTES - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (value.byteLength > room) break;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function request(
  url: string,
  headers: Record<string, string>,
  extra?: { method?: string; body?: string; fresh?: boolean; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; text: string }> {
  const method = extra?.method ?? "GET";
  const fresh = extra?.fresh ?? false;
  const init: RequestInit = {
    method,
    body: extra?.body,
    headers: { "user-agent": USER_AGENT, "accept-language": "zh-TW,zh;q=0.9,en;q=0.8", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(extra?.timeoutMs ?? PLATFORM_TIMEOUT_MS),
  };
  if (fresh) init.cache = "no-store";
  const response = await fetch(url, !fresh && method === "GET" ? withEdgeCache(init) : init);
  return { ok: response.ok, status: response.status, text: await readLimited(response) };
}

function httpFailure(id: PlatformId, query: string, status: number): PlatformResult {
  return unavailableResult(id, query, `http_${status}`);
}

function parseFailure(id: PlatformId, query: string): PlatformResult {
  return unavailableResult(id, query, "parse_error");
}

/** One fresh try after a failure. Coupang keeps its own API path and is not wrapped. */
function scrape(
  id: PlatformId,
  query: string,
  run: (fresh: boolean) => Promise<PlatformResult>,
  pauseMs: number = retryDelayFor(id),
): Promise<PlatformResult> {
  const once = async (fresh: boolean) => {
    try {
      return await run(fresh);
    } catch (error) {
      return unavailableResult(id, query, failureReason(error));
    }
  };
  if (!retriesPlatform(id)) return once(false);
  return retryPlatform(({ fresh }) => once(fresh), undefined, pauseMs);
}

function ok(id: PlatformId, query: string, products: Product[]): PlatformResult {
  return { id, status: "ok", products, searchUrl: platformSearchUrl(id, query) };
}

const fetchPchome: PlatformFetcher = (query) =>
  scrape("pchome", query, async (fresh) => {
    const url = `https://ecshweb.pchome.com.tw/search/v3.3/all/results?q=${encodeURIComponent(query)}&page=1&sort=rnk/dc`;
    const response = await request(
      url,
      { accept: "application/json, text/plain, */*", referer: "https://24h.pchome.com.tw/" },
      { fresh },
    );
    if (!response.ok) return httpFailure("pchome", query, response.status);
    const products = normalizePchome(JSON.parse(response.text) as unknown);
    return ok("pchome", query, products);
  });

const fetchYahoo: PlatformFetcher = (query) =>
  scrape("yahoo", query, async (fresh) => {
    const response = await request(
      rawSearchUrl("yahoo", query),
      { ...DOCUMENT_HEADERS, "sec-fetch-site": "none" },
      { fresh },
    );
    if (!response.ok) return httpFailure("yahoo", query, response.status);
    const products = yahooProducts(response.text);
    if (!products) return parseFailure("yahoo", query);
    return ok("yahoo", query, products);
  });

const fetchMomo: PlatformFetcher = (query) =>
  scrape("momo", query, async (fresh) => {
    const response = await request(
      rawSearchUrl("momo", query),
      { ...DOCUMENT_HEADERS, "sec-fetch-site": "none" },
      { fresh },
    );
    if (!response.ok) return httpFailure("momo", query, response.status);
    const products = momoProducts(response.text);
    if (!products) return parseFailure("momo", query);
    return ok("momo", query, products);
  });

export async function fetchCoupangDirect(
  query: string,
  keys?: { accessKey?: string; secretKey?: string },
): Promise<PlatformResult> {
  try {
    const outcome = await searchCoupangPartners(query, keys);
    if (!outcome.products) {
      return { ...unavailableResult("coupang", query), reason: outcome.reason ?? "exception: unknown" };
    }
    return ok("coupang", query, outcome.products);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").trim() : "unknown";
    const clipped = message.length > 120 ? message.slice(0, 120) : message;
    return { ...unavailableResult("coupang", query), reason: `exception: ${clipped || "unknown"}` };
  }
}

const fetchCoupang: PlatformFetcher = (query) => fetchProxiedShop("coupang", query, fetchCoupangDirect, readProxyConfig());

export const fetchPxgoDirect: PlatformFetcher = (query) =>
  scrape(
    "pxgo",
    query,
    async (fresh) => {
      const attempt = pxgoAttempt(query, fresh);
      const response = await request(attempt.url, attempt.headers, {
        method: "POST",
        body: attempt.body,
        fresh: attempt.fresh,
        timeoutMs: attempt.timeoutMs,
      });
      if (!response.ok) return httpFailure("pxgo", query, response.status);
      const products = pxgoProducts(JSON.parse(response.text) as unknown);
      if (!products) return parseFailure("pxgo", query);
      return ok("pxgo", query, products);
    },
    retryDelayFor("pxgo"),
  );

const fetchPxgo: PlatformFetcher = (query) => fetchProxiedShop("pxgo", query, fetchPxgoDirect, readProxyConfig());

const fetchEtmall: PlatformFetcher = (query) =>
  scrape("etmall", query, async (fresh) => {
    const response = await request(
      `https://www.etmall.com.tw/Search/Get?keyword=${encodeURIComponent(query)}`,
      {
        accept: "application/json, text/plain, */*",
        referer: rawSearchUrl("etmall", query),
      },
      { fresh },
    );
    if (!response.ok) return httpFailure("etmall", query, response.status);
    const products = etmallProducts(JSON.parse(response.text) as unknown);
    if (!products) return parseFailure("etmall", query);
    return ok("etmall", query, products);
  });

const fetchKingstone: PlatformFetcher = (query) =>
  scrape("kingstone", query, async (fresh) => {
    const response = await request(
      rawSearchUrl("kingstone", query),
      { ...DOCUMENT_HEADERS, referer: "https://www.kingstone.com.tw/", "sec-fetch-site": "same-origin" },
      { fresh },
    );
    if (!response.ok) return httpFailure("kingstone", query, response.status);
    const products = kingstoneProducts(response.text);
    if (!products) return parseFailure("kingstone", query);
    return ok("kingstone", query, products);
  });

const fetchSanmin: PlatformFetcher = (query) =>
  scrape("sanmin", query, async (fresh) => {
    const response = await request(
      rawSearchUrl("sanmin", query),
      { ...DOCUMENT_HEADERS, referer: "https://www.sanmin.com.tw/", "sec-fetch-site": "same-origin" },
      { fresh },
    );
    if (!response.ok) return httpFailure("sanmin", query, response.status);
    const products = sanminProducts(response.text);
    if (!products) return parseFailure("sanmin", query);
    return ok("sanmin", query, products);
  });

export const fetchRakutenDirect: PlatformFetcher = (query) =>
  scrape("rakuten", query, async (fresh) => {
    const response = await request(
      rawSearchUrl("rakuten", query),
      {
        ...DOCUMENT_HEADERS,
        // 樂天沒帶 accept-encoding 會直接斷線（Cloudflare 回 520），要明確帶上
        "accept-encoding": "gzip, deflate, br",
        referer: "https://www.rakuten.com.tw/",
        "sec-fetch-site": "same-origin",
      },
      { fresh },
    );
    if (!response.ok) return httpFailure("rakuten", query, response.status);
    const products = rakutenProducts(response.text);
    if (!products) return parseFailure("rakuten", query);
    return ok("rakuten", query, products);
  });

const fetchRakuten: PlatformFetcher = (query) =>
  fetchProxiedShop("rakuten", query, fetchRakutenDirect, readProxyConfig());

const RUTEN_API = "https://rtapi.ruten.com.tw/api";

/** 露天 public API: search for ids, then read the details for those ids. */
export const fetchRutenDirect: PlatformFetcher = (query) =>
  scrape("ruten", query, async (fresh) => {
    const headers = { accept: "application/json, text/plain, */*", referer: "https://www.ruten.com.tw/" };
    const search = await request(
      `${RUTEN_API}/search/v3/index.php/core/prod?q=${encodeURIComponent(query)}&type=direct&sort=rnk%2Fdc&offset=1&limit=${MAX_PER_PLATFORM}`,
      headers,
      { fresh },
    );
    if (!search.ok) return httpFailure("ruten", query, search.status);
    const ids = rutenSearchIds(JSON.parse(search.text) as unknown);
    if (!ids) return parseFailure("ruten", query);
    if (!ids.length) return ok("ruten", query, []);
    const detail = await request(
      `${RUTEN_API}/prod/v2/index.php/prod?id=${ids.join(",")}`,
      headers,
      { fresh },
    );
    if (!detail.ok) return httpFailure("ruten", query, detail.status);
    const products = rutenProducts(JSON.parse(detail.text) as unknown, ids);
    if (!products) return parseFailure("ruten", query);
    return ok("ruten", query, products);
  });

const fetchRuten: PlatformFetcher = (query) => fetchProxiedShop("ruten", query, fetchRutenDirect, readProxyConfig());

export const fetchShopeeDirect: PlatformFetcher = (query) =>
  scrape("shopee", query, async (fresh) => {
    const keyword = encodeURIComponent(query);
    const response = await request(
      `https://shopee.tw/api/v4/search/search_items?by=relevancy&keyword=${keyword}&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`,
      {
        accept: "application/json",
        referer: `https://shopee.tw/search?keyword=${keyword}`,
        "x-api-source": "pc",
        "x-shopee-language": "zh-Hant",
      },
      { fresh },
    );
    if (!response.ok) return httpFailure("shopee", query, response.status);
    const data = JSON.parse(response.text) as { error?: unknown };
    if (data.error) return unavailableResult("shopee", query, "exception: api error");
    return ok("shopee", query, normalizeShopee(data));
  });

const fetchShopee: PlatformFetcher = (query) => fetchProxiedShop("shopee", query, fetchShopeeDirect, readProxyConfig());

export const fetchers: Record<PlatformId, PlatformFetcher> = {
  momo: fetchMomo,
  pchome: fetchPchome,
  yahoo: fetchYahoo,
  coupang: fetchCoupang,
  shopee: fetchShopee,
  pxgo: fetchPxgo,
  etmall: fetchEtmall,
  kingstone: fetchKingstone,
  sanmin: fetchSanmin,
  rakuten: fetchRakuten,
  ruten: fetchRuten,
};
