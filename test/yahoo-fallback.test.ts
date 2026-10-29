import { describe, expect, it, vi } from "vitest";
import {
  fetchYahooWithFallback,
  looksLikeChallenge,
  resetYahooCooldown,
  YAHOO_PROXY_COOLDOWN_MS,
  yahooProxyCoolingDown,
} from "../functions/lib/providers";
import type { PlatformResult } from "../shared/types";

const product = { platform: "yahoo" as const, title: "牙刷", price: 99, image: "", url: "https://tw.buy.yahoo.com/gdsale/x", rank: 0 };
const fail: PlatformResult = { id: "yahoo", status: "unavailable", products: [], searchUrl: "", reason: "http_403" };
const good: PlatformResult = { id: "yahoo", status: "ok", products: [product], searchUrl: "" };
const config = { url: "https://proxy.example.com", token: "secret-token-123" };

function proxyReply(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

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
