import { searchCoupangPartners } from "../../shared/coupang-api";
import {
  etmallProducts,
  kingstoneProducts,
  momoProducts,
  normalizePchome,
  normalizeShopee,
  pxgoProducts,
  sanminProducts,
  yahooProducts,
} from "../../shared/normalize";
import { platformSearchUrl, rawSearchUrl } from "../../shared/platforms";
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

const TIMEOUT_MS = 8_000;
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
  extra?: { method?: string; body?: string },
): Promise<{ ok: boolean; text: string }> {
  const method = extra?.method ?? "GET";
  const init: RequestInit = {
    method,
    body: extra?.body,
    headers: { "user-agent": USER_AGENT, "accept-language": "zh-TW,zh;q=0.9,en;q=0.8", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  const response = await fetch(url, method === "GET" ? withEdgeCache(init) : init);
  return { ok: response.ok, text: await readLimited(response) };
}

function ok(id: PlatformId, query: string, products: Product[]): PlatformResult {
  return { id, status: "ok", products, searchUrl: platformSearchUrl(id, query) };
}

const fetchPchome: PlatformFetcher = async (query) => {
  try {
    const url = `https://ecshweb.pchome.com.tw/search/v3.3/all/results?q=${encodeURIComponent(query)}&page=1&sort=rnk/dc`;
    const { ok: fine, text } = await request(url, {
      accept: "application/json, text/plain, */*",
      referer: "https://24h.pchome.com.tw/",
    });
    if (!fine) return unavailableResult("pchome", query);
    const products = normalizePchome(JSON.parse(text) as unknown);
    return ok("pchome", query, products);
  } catch {
    return unavailableResult("pchome", query);
  }
};

const fetchYahoo: PlatformFetcher = async (query) => {
  try {
    const { ok: fine, text } = await request(rawSearchUrl("yahoo", query), {
      ...DOCUMENT_HEADERS,
      "sec-fetch-site": "none",
    });
    const products = fine ? yahooProducts(text) : null;
    if (!products) return unavailableResult("yahoo", query);
    return ok("yahoo", query, products);
  } catch {
    return unavailableResult("yahoo", query);
  }
};

const fetchMomo: PlatformFetcher = async (query) => {
  try {
    const { ok: fine, text } = await request(rawSearchUrl("momo", query), {
      ...DOCUMENT_HEADERS,
      "sec-fetch-site": "none",
    });
    const products = fine ? momoProducts(text) : null;
    if (!products) return unavailableResult("momo", query);
    return ok("momo", query, products);
  } catch {
    return unavailableResult("momo", query);
  }
};

const fetchCoupang: PlatformFetcher = async (query) => {
  try {
    const products = await searchCoupangPartners(query);
    if (!products) return unavailableResult("coupang", query);
    return ok("coupang", query, products);
  } catch {
    return unavailableResult("coupang", query);
  }
};

const fetchPxgo: PlatformFetcher = async (query) => {
  try {
    const body = JSON.stringify({
      search_setting_type: 1,
      keyword: query,
      sort_type: 0,
      page_index: 1,
      page_size: 24,
      filters: [],
      visitor_id: "bibisaru",
      user_info_id: "",
      is_using_prod_es: false,
      skip_brand_detection: false,
    });
    const { ok: fine, text } = await request(
      "https://api-pxbox.es.pxmart.com.tw/app/3.0/spu/single_search",
      {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://pxbox.es.pxmart.com.tw",
        referer: "https://pxbox.es.pxmart.com.tw/",
      },
      { method: "POST", body },
    );
    const products = fine ? pxgoProducts(JSON.parse(text) as unknown) : null;
    if (!products) return unavailableResult("pxgo", query);
    return ok("pxgo", query, products);
  } catch {
    return unavailableResult("pxgo", query);
  }
};

const fetchEtmall: PlatformFetcher = async (query) => {
  try {
    const { ok: fine, text } = await request(
      `https://www.etmall.com.tw/Search/Get?keyword=${encodeURIComponent(query)}`,
      {
        accept: "application/json, text/plain, */*",
        referer: rawSearchUrl("etmall", query),
      },
    );
    const products = fine ? etmallProducts(JSON.parse(text) as unknown) : null;
    if (!products) return unavailableResult("etmall", query);
    return ok("etmall", query, products);
  } catch {
    return unavailableResult("etmall", query);
  }
};

const fetchKingstone: PlatformFetcher = async (query) => {
  try {
    const { ok: fine, text } = await request(rawSearchUrl("kingstone", query), {
      ...DOCUMENT_HEADERS,
      referer: "https://www.kingstone.com.tw/",
      "sec-fetch-site": "same-origin",
    });
    const products = fine ? kingstoneProducts(text) : null;
    if (!products) return unavailableResult("kingstone", query);
    return ok("kingstone", query, products);
  } catch {
    return unavailableResult("kingstone", query);
  }
};

const fetchSanmin: PlatformFetcher = async (query) => {
  try {
    const { ok: fine, text } = await request(rawSearchUrl("sanmin", query), {
      ...DOCUMENT_HEADERS,
      referer: "https://www.sanmin.com.tw/",
      "sec-fetch-site": "same-origin",
    });
    const products = fine ? sanminProducts(text) : null;
    if (!products) return unavailableResult("sanmin", query);
    return ok("sanmin", query, products);
  } catch {
    return unavailableResult("sanmin", query);
  }
};

/** 誠品線上 sits behind a Cloudflare challenge from this environment. Link out, don't invent rows. */
const fetchEslite: PlatformFetcher = async (query) => unavailableResult("eslite", query);

const fetchShopee: PlatformFetcher = async (query) => {
  try {
    const keyword = encodeURIComponent(query);
    const { ok: fine, text } = await request(
      `https://shopee.tw/api/v4/search/search_items?by=relevancy&keyword=${keyword}&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`,
      {
        accept: "application/json",
        referer: `https://shopee.tw/search?keyword=${keyword}`,
        "x-api-source": "pc",
        "x-shopee-language": "zh-Hant",
      },
    );
    if (!fine) return unavailableResult("shopee", query);
    const data = JSON.parse(text) as { error?: unknown };
    if (data.error) return unavailableResult("shopee", query);
    return ok("shopee", query, normalizeShopee(data));
  } catch {
    return unavailableResult("shopee", query);
  }
};

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
  eslite: fetchEslite,
};
