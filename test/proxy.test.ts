import { describe, expect, it } from "vitest";
import workerToml from "../workers/fetch-proxy/wrangler.toml?raw";
import { handleFetch } from "../workers/fetch-proxy/src/index";
import {
  PROXY_FETCH_PATH,
  PROXY_TOKEN_HEADER,
  callFetchProxy,
  fetchProxiedShop,
  parseProxyShopResponse,
  proxyBaseUrl,
  proxyTokensMatch,
  readProxyConfig,
  redactProxyToken,
} from "../shared/proxy";
import type { PlatformResult } from "../shared/types";

const TOKEN = "proxy-token-value-0123456789abcdef";

function shop(partial: Partial<PlatformResult> = {}): PlatformResult {
  return {
    id: "pxgo",
    status: "ok",
    products: [
      {
        platform: "pxgo",
        title: "全聯牛奶",
        price: 42,
        image: "https://img.example/milk.jpg",
        url: "https://pxbox.es.pxmart.com.tw/product/1",
        rank: 0,
      },
    ],
    searchUrl: "https://pxbox.es.pxmart.com.tw/search",
    ...partial,
  };
}

describe("fetch proxy contract", () => {
  it("pins bibisaru-fetch to aws us-east-1", () => {
    expect(workerToml).toMatch(/^name = "bibisaru-fetch"$/m);
    expect(workerToml).toMatch(/^region = "aws:us-east-1"$/m);
    expect(workerToml).not.toContain(TOKEN);
  });

  it("matches the shared secret without treating an empty token as valid", () => {
    expect(proxyTokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(proxyTokensMatch("nope", TOKEN)).toBe(false);
    expect(proxyTokensMatch("", "")).toBe(false);
    expect(proxyTokensMatch(TOKEN, "")).toBe(false);
    expect(proxyBaseUrl("https://bibisaru-fetch.example.workers.dev/")).toBe(
      "https://bibisaru-fetch.example.workers.dev",
    );
    expect(proxyBaseUrl("http://shop.example")).toBeNull();
    expect(readProxyConfig({ FETCH_PROXY_URL: "https://proxy.example", PROXY_TOKEN: `\n${TOKEN}\n` })).toEqual({
      url: "https://proxy.example",
      token: TOKEN,
    });
    expect(readProxyConfig({})).toBeNull();
    expect(redactProxyToken(`leaked ${TOKEN} here`, TOKEN)).toBe("leaked [redacted] here");
  });

  it("calls the worker with the token header and keeps the token out of the url", async () => {
    const seen: { url?: string; token?: string | null } = {};
    const remote = await callFetchProxy(
      "pxgo",
      "牛奶",
      { url: "https://proxy.example", token: TOKEN },
      async (input, init) => {
        const url = String(input);
        seen.url = url;
        seen.token = new Headers(init?.headers).get(PROXY_TOKEN_HEADER);
        expect(url).not.toContain(TOKEN);
        return new Response(
          JSON.stringify({
            fetchColo: "IAD",
            platform: "pxgo",
            status: "unavailable",
            products: [],
            reason: `http_403 ${TOKEN}`,
          }),
          { status: 200 },
        );
      },
    );
    expect(seen.url).toBe(`https://proxy.example${PROXY_FETCH_PATH}`);
    expect(seen.token).toBe(TOKEN);
    expect(remote.result?.reason).toBe("http_403 [redacted]");
    expect(remote.result?.fetchColo).toBe("IAD");
    expect(remote.result?.reason).not.toContain(TOKEN);
  });

  it("uses a proxy hit, falls back when the worker errors, and stops on 401", async () => {
    let directCalls = 0;
    const direct = async (): Promise<PlatformResult> => {
      directCalls += 1;
      return shop({ status: "unavailable", products: [], reason: "http_403" });
    };
    const hit = await fetchProxiedShop(
      "pxgo",
      "牛奶",
      direct,
      { url: "https://proxy.example", token: TOKEN },
      async () =>
        new Response(
          JSON.stringify({
            fetchColo: "IAD",
            platform: "pxgo",
            status: "ok",
            products: shop().products,
          }),
          { status: 200 },
        ),
    );
    expect(hit.status).toBe("ok");
    expect(hit.fetchColo).toBe("IAD");
    expect(hit.products[0]?.title).toBe("全聯牛奶");
    expect(directCalls).toBe(0);

    directCalls = 0;
    const fallback = await fetchProxiedShop(
      "coupang",
      "牛奶",
      direct,
      { url: "https://proxy.example", token: TOKEN },
      async () => new Response("nope", { status: 502 }),
    );
    expect(fallback.reason).toBe("http_403");
    expect(directCalls).toBe(1);

    directCalls = 0;
    const denied = await fetchProxiedShop(
      "shopee",
      "牛奶",
      direct,
      { url: "https://proxy.example", token: TOKEN },
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    expect(denied.reason).toBe("exception: proxy unauthorized");
    expect(directCalls).toBe(0);
    expect(parseProxyShopResponse({ platform: "momo", status: "ok", products: [] }, "pxgo")).toBeNull();
  });

  it("rejects a missing token before fetching a shop and reports the worker colo", async () => {
    let shops = 0;
    const denied = await handleFetch(
      new Request("https://bibisaru-fetch.example.workers.dev/v1/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "pxgo", query: "牛奶" }),
      }),
      { PROXY_TOKEN: TOKEN },
      {
        fetchShop: async () => {
          shops += 1;
          return shop();
        },
        readColo: async () => "IAD",
      },
    );
    expect(denied.status).toBe(401);
    expect(shops).toBe(0);
    expect(await denied.text()).not.toContain(TOKEN);

    const accepted = await handleFetch(
      new Request("https://bibisaru-fetch.example.workers.dev/v1/fetch", {
        method: "POST",
        headers: { "content-type": "application/json", [PROXY_TOKEN_HEADER]: TOKEN },
        body: JSON.stringify({ platform: "pxgo", query: "牛奶" }),
      }),
      { PROXY_TOKEN: TOKEN, COUPANG_ACCESS_KEY: "should-not-leak" },
      {
        fetchShop: async (platform) => shop({ id: platform }),
        readColo: async () => "IAD",
      },
    );
    const body = (await accepted.json()) as { fetchColo: string; status: string; platform: string };
    expect(accepted.status).toBe(200);
    expect(body).toMatchObject({ fetchColo: "IAD", status: "ok", platform: "pxgo" });
    expect(JSON.stringify(body)).not.toContain("should-not-leak");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
