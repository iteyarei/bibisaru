import { describe, expect, it, vi } from "vitest";
import { fetchYahooWithFallback, looksLikeChallenge } from "../functions/lib/providers";
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
