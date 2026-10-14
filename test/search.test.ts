import { describe, expect, it } from "vitest";
import { searchPlatforms, unavailableResult } from "../shared/search";
import type { PlatformFetcher, PlatformResult, Product } from "../shared/types";

function product(platform: Product["platform"], price: number): Product {
  return {
    platform,
    title: `${platform} 耳機`,
    price,
    image: "",
    url: `https://www.momoshop.com.tw/goods/${platform}`,
    rank: 0,
  };
}

describe("searchPlatforms", () => {
  it("keeps successful platforms when another fetch throws", async () => {
    const fetchers: Partial<Record<Product["platform"], PlatformFetcher>> = {
      momo: async () => ({
        id: "momo",
        status: "ok",
        products: [product("momo", 500)],
        searchUrl: "https://www.momoshop.com.tw/search/x",
      }),
      pchome: async () => {
        throw new Error("timeout");
      },
      shopee: async (query) => unavailableResult("shopee", query),
      coupang: async (): Promise<PlatformResult> => ({
        id: "coupang",
        status: "ok",
        products: [],
        searchUrl: "https://www.tw.coupang.com/np/search?q=x",
      }),
    };

    const response = await searchPlatforms("耳機", ["momo", "pchome", "coupang", "shopee"], fetchers, () => new Date("2026-10-12T03:00:00Z"));
    expect(response.results.map((item) => item.platform)).toEqual(["momo"]);
    expect(response.platforms.map((platform) => [platform.id, platform.status, platform.count])).toEqual([
      ["momo", "ok", 1],
      ["pchome", "unavailable", 0],
      ["coupang", "empty", 0],
      ["shopee", "unavailable", 0],
    ]);
    expect(response.fetchedAt).toBe("2026-10-12T03:00:00.000Z");
    expect(response.meta).toEqual({ colo: "" });
    expect(response.platforms.find((platform) => platform.id === "pchome")?.reason).toBe("timeout");
  });
});
