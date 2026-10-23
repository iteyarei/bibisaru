import {
  fetchCoupangDirect,
  fetchPxgoDirect,
  fetchRakutenDirect,
  fetchRutenDirect,
  fetchShopeeDirect,
} from "../../../functions/lib/providers";
import { normalizeQuery } from "../../../shared/query";
import {
  isProxyPlatform,
  PROXY_FETCH_PATH,
  PROXY_TOKEN_HEADER,
  cleanProxyToken,
  proxyTokensMatch,
  type ProxyPlatform,
} from "../../../shared/proxy";
import { readFetchColo } from "../../../shared/trace";
import type { PlatformResult } from "../../../shared/types";

export interface ProxyEnv {
  PROXY_TOKEN?: string;
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
}

export interface ProxyDeps {
  fetchShop: (platform: ProxyPlatform, query: string, env: ProxyEnv) => Promise<PlatformResult>;
  readColo: () => Promise<string>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function fetchShopDirect(platform: ProxyPlatform, query: string, env: ProxyEnv): Promise<PlatformResult> {
  if (platform === "pxgo") return fetchPxgoDirect(query);
  if (platform === "shopee") return fetchShopeeDirect(query);
  if (platform === "rakuten") return fetchRakutenDirect(query);
  if (platform === "ruten") return fetchRutenDirect(query);
  return fetchCoupangDirect(query, {
    accessKey: env.COUPANG_ACCESS_KEY ?? "",
    secretKey: env.COUPANG_SECRET_KEY ?? "",
  });
}

export async function handleFetch(request: Request, env: ProxyEnv, deps: ProxyDeps = {
  fetchShop: fetchShopDirect,
  readColo: readFetchColo,
}): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== PROXY_FETCH_PATH) return json({ error: "not_found" }, 404);

  const expected = cleanProxyToken(env.PROXY_TOKEN);
  const provided = cleanProxyToken(request.headers.get(PROXY_TOKEN_HEADER));
  if (!proxyTokensMatch(provided, expected)) return json({ error: "unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(await request.text()) as unknown;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const row = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  const platform = typeof row?.platform === "string" ? row.platform : "";
  const query = normalizeQuery(typeof row?.query === "string" ? row.query : "");
  if (!isProxyPlatform(platform) || !query) return json({ error: "bad_request" }, 400);

  const coloPromise = deps.readColo();
  try {
    const result = await deps.fetchShop(platform, query, env);
    const fetchColo = await coloPromise;
    return json(
      {
        fetchColo,
        platform,
        status: result.status,
        products: result.status === "ok" ? result.products : [],
        ...(result.reason ? { reason: result.reason } : {}),
      },
      200,
    );
  } catch {
    await coloPromise;
    return json({ error: "proxy_failed" }, 502);
  }
}

export default {
  async fetch(request: Request, env: ProxyEnv): Promise<Response> {
    return handleFetch(request, env);
  },
};
