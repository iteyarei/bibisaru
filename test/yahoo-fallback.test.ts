import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchYahooDirect,
  fetchYahooWithFallback,
  looksLikeChallenge,
  resetYahooCooldown,
  YAHOO_PROXY_COOLDOWN_MS,
  yahooProxyCoolingDown,
} from "../functions/lib/providers";
import { searchPlatforms } from "../shared/search";
import type { PlatformResult } from "../shared/types";

const product = { platform: "yahoo" as const, title: "牙刷", price: 99, image: "", url: "https://tw.buy.yahoo.com/gdsale/x", rank: 0 };
const fail: PlatformResult = { id: "yahoo", status: "unavailable", products: [], searchUrl: "", reason: "http_403" };
const good: PlatformResult = { id: "yahoo", status: "ok", products: [product], searchUrl: "" };
const config = { url: "https://proxy.example.com", token: "secret-token-123" };

function proxyReply(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

/** A 奇摩 search page exactly as the shop sends it: the JSON lives in one script block. */
function yahooPage(hits: unknown[]): string {
  const payload = { search: { ecsearch: { hits } } };
  return `<html><body><script id="isoredux-data" type="mime/invalid">${JSON.stringify(payload)}</script></body></html>`;
}

const hit = {
  ec_title: "舒潔抽取式衛生紙",
  ec_price: 299,
  ec_image: "https://img.yec.tw/zp/a.jpg",
  ec_item_url: "https://tw.buy.yahoo.com/gdsale/a-1.html",
};

/** Serve every request from one canned page and count the round trips. */
function stubYahooPage(html: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("yahoo proxy fallback", () => {
  it("keeps a good direct result and never calls the proxy", async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    const result = await fetchYahooWithFallback("牙刷", async () => good, config, doFetch);
    expect(result.products).toHaveLength(1);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("uses the proxy when direct gets 403", async () => {
    const doFetch = proxyReply({ platform: "yahoo", status: "ok", fetchColo: "IAD", products: [product] });
    const result = await fetchYahooWithFallback("牙刷", async () => fail, config, doFetch);
    expect(result.status).toBe("ok");
    expect(result.fetchColo).toBe("IAD");
  });

  it("reports both reasons when the proxy also fails", async () => {
    const doFetch = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "http_403" });
    const result = await fetchYahooWithFallback("牙刷", async () => fail, config, doFetch);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("direct: http_403; proxy: http_403");
  });

  it("returns the direct failure when no proxy is configured", async () => {
    const result = await fetchYahooWithFallback("牙刷", async () => fail, null);
    expect(result.reason).toBe("http_403");
  });

  it("spots challenge pages", () => {
    expect(looksLikeChallenge("<title>Please verify you are a human captcha</title>")).toBe(true);
    expect(looksLikeChallenge("<html>商品列表</html>")).toBe(false);
  });
});

describe("the proxy cooldown after a failed hop", () => {
  it("skips the proxy for the next few minutes once it has just failed", async () => {
    resetYahooCooldown();
    let clock = 1_000_000;
    const now = () => clock;

    const dead = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "parse_error http_200" });
    const firstFetch = vi.fn(dead);
    const first = await fetchYahooWithFallback("牙刷", async () => fail, config, firstFetch as unknown as typeof fetch, now);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(first.reason).toBe("direct: http_403; proxy: parse_error http_200");

    // Second reader, seconds later: the direct attempt still runs (奇摩 may
    // recover), but the 10s second opinion is skipped.
    clock += 30_000;
    const secondFetch = vi.fn(dead);
    const second = await fetchYahooWithFallback("毛巾", async () => fail, config, secondFetch as unknown as typeof fetch, now);
    expect(secondFetch).not.toHaveBeenCalled();
    expect(second.reason).toBe("direct: http_403; proxy: cooling_down");

    // Still nothing after the window: the proxy is tried again.
    clock += YAHOO_PROXY_COOLDOWN_MS;
    const thirdFetch = vi.fn(dead);
    await fetchYahooWithFallback("毛巾", async () => fail, config, thirdFetch as unknown as typeof fetch, now);
    expect(thirdFetch).toHaveBeenCalledTimes(1);
  });

  it("clears the cooldown once the proxy answers with products again", async () => {
    resetYahooCooldown();
    let clock = 5_000_000;
    const now = () => clock;
    const dead = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "http_403" });
    await fetchYahooWithFallback("牙刷", async () => fail, config, dead as unknown as typeof fetch, now);
    expect(yahooProxyCoolingDown(now())).toBe(true);

    // Past the window the hop runs again; a good answer must erase the memory,
    // not leave the next few minutes quietly skipping a working proxy.
    clock += YAHOO_PROXY_COOLDOWN_MS;
    const alive = proxyReply({ platform: "yahoo", status: "ok", fetchColo: "IAD", products: [product] });
    const recovered = await fetchYahooWithFallback("牙刷", async () => fail, config, alive as unknown as typeof fetch, now);
    expect(recovered.status).toBe("ok");
    expect(yahooProxyCoolingDown(now())).toBe(false);
  });

  it("never blocks the direct attempt, only the proxy hop", async () => {
    resetYahooCooldown();
    const clock = () => 9_000_000;
    const dead = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "http_403" });
    await fetchYahooWithFallback("牙刷", async () => fail, config, dead as unknown as typeof fetch, clock);
    // 奇摩 comes back: a good direct result is returned without the cooldown mattering.
    const result = await fetchYahooWithFallback("牙刷", async () => good, config, vi.fn() as unknown as typeof fetch, clock);
    expect(result.status).toBe("ok");
    expect(yahooProxyCoolingDown(clock())).toBe(true);
  });
});

describe("zero hits is an answer, not a failure", () => {
  it("returns ok with no products and never spends the proxy on a keyword nothing matches", async () => {
    resetYahooCooldown();
    // 奇摩 answers 查無此商品 with HTTP 200 and an empty hits array, not an error page.
    const pageFetch = stubYahooPage(yahooPage([]));
    const doFetch = vi.fn() as unknown as typeof fetch;

    const result = await fetchYahooWithFallback("zzzqqqxxx998", fetchYahooDirect, config, doFetch);

    expect(result.status).toBe("ok");
    expect(result.products).toEqual([]);
    expect(result.reason).toBeUndefined();
    // One page, no retry: `scrape` only runs its second attempt after a failure.
    expect(pageFetch).toHaveBeenCalledTimes(1);
    // The 9-12s second opinion is the whole bug; it must not happen.
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("reports the shop as empty, not unavailable, once the search fan-out grades it", async () => {
    resetYahooCooldown();
    stubYahooPage(yahooPage([]));
    const doFetch = vi.fn() as unknown as typeof fetch;

    const response = await searchPlatforms(
      "zzzqqqxxx998",
      ["yahoo"],
      { yahoo: (query) => fetchYahooWithFallback(query, fetchYahooDirect, config, doFetch) },
    );

    expect(response.platforms[0]).toMatchObject({ id: "yahoo", status: "empty", count: 0 });
    expect(response.platforms[0]?.reason).toBeUndefined();
    expect(response.results).toEqual([]);
  });

  it("still returns real hits untouched", async () => {
    resetYahooCooldown();
    stubYahooPage(yahooPage([hit, { ...hit, ec_title: "舒潔衛生紙 72 抽", ec_item_url: "https://tw.buy.yahoo.com/gdsale/b-2.html", ec_price: 199 }]));
    const doFetch = vi.fn() as unknown as typeof fetch;

    const result = await fetchYahooWithFallback("舒潔抽取式衛生紙", fetchYahooDirect, config, doFetch);

    expect(result.status).toBe("ok");
    expect(result.products.map((item) => item.title)).toEqual(["舒潔抽取式衛生紙", "舒潔衛生紙 72 抽"]);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("keeps a zero-hit answer when the proxy is cooling down, without a cooling_down reason", async () => {
    resetYahooCooldown();
    // A genuine failure puts the isolate in cooldown…
    const dead = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "http_403" });
    await fetchYahooWithFallback("牙刷", async () => fail, config, dead as unknown as typeof fetch, () => 1_000);
    expect(yahooProxyCoolingDown(1_000)).toBe(true);

    // …and a later 查無此商品 is still a clean answer, not a cooling_down excuse.
    stubYahooPage(yahooPage([]));
    const doFetch = vi.fn() as unknown as typeof fetch;
    const result = await fetchYahooWithFallback("zzzqqqxxx998", fetchYahooDirect, config, doFetch, () => 1_000);

    expect(result).toMatchObject({ status: "ok", products: [] });
    expect(result.reason).toBeUndefined();
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe("an unreadable page is still a failure", () => {
  it("reports parse_error and does ask the proxy once when the JSON block is gone", async () => {
    resetYahooCooldown();
    stubYahooPage("<html><body><h1>搜尋結果</h1></body></html>");
    const doFetch = vi.fn() as unknown as typeof fetch;

    const direct = await fetchYahooDirect("除濕機");
    expect(direct.status).toBe("unavailable");
    expect(direct.reason).toBe("parse_error http_200");

    const result = await fetchYahooWithFallback("除濕機", fetchYahooDirect, config, doFetch);
    expect(result.status).toBe("unavailable");
    // The direct leg still names the parse failure, and the proxy was really tried.
    expect(result.reason).toMatch(/^direct: parse_error http_200; proxy: /);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a hits field that is not an array as unreadable, not as zero results", async () => {
    resetYahooCooldown();
    stubYahooPage(`<script id="isoredux-data" type="mime/invalid">${JSON.stringify({ search: { ecsearch: { hits: { total: 0 } } } })}</script>`);

    const result = await fetchYahooDirect("除濕機");

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("parse_error http_200");
  });

  it("marks a challenge page in the reason and still falls back", async () => {
    resetYahooCooldown();
    stubYahooPage('<html><head><title>Please verify you are a human captcha</title></head><body></body></html>');
    const doFetch = proxyReply({ platform: "yahoo", status: "unavailable", fetchColo: "IAD", products: [], reason: "parse_error http_200" });

    const result = await fetchYahooWithFallback("除濕機", fetchYahooDirect, config, doFetch as unknown as typeof fetch);

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("direct: parse_error http_200 challenge; proxy: parse_error http_200");
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
