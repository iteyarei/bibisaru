import { describe, expect, it } from "vitest";
import { fetchers } from "../functions/lib/providers";
import { PLATFORM_IDS } from "../shared/platforms";
import { searchPlatforms } from "../shared/search";

describe("live platform adapters", () => {
  it("requests each storefront once and records what came back", async () => {
    const response = await searchPlatforms("耳機", PLATFORM_IDS, fetchers);
    const summary = response.platforms.map((platform) => ({
      id: platform.id,
      status: platform.status,
      count: platform.count,
    }));
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      "samples",
      response.results.slice(0, 8).map((product) => ({
        platform: product.platform,
        price: product.price,
        title: product.title,
        url: product.url,
      })),
    );

    expect(summary.map((platform) => platform.id)).toEqual([...PLATFORM_IDS]);
    for (const product of response.results) {
      expect(product.title.length).toBeGreaterThan(0);
      expect(product.price).toBeGreaterThan(0);
      expect(product.url).toMatch(/^https:\/\//);
      expect(product.platform).toBeTruthy();
    }

    for (const id of ["momo", "pchome", "yahoo", "pxgo", "etmall", "kingstone", "sanmin"] as const) {
      const platform = response.platforms.find((item) => item.id === id);
      expect(platform?.status, id).toBe("ok");
      expect(platform?.count, id).toBeGreaterThan(0);
    }

    // Coupang uses the Partners API when the Pages secrets are set.
    // Without keys, or when the API fails, the section is a link-out and no invented items.
    const coupang = response.platforms.find((item) => item.id === "coupang");
    expect(["ok", "unavailable"]).toContain(coupang?.status);
    if (coupang?.status === "ok") expect(coupang.count).toBeGreaterThan(0);
    if (coupang?.status === "unavailable") {
      expect(coupang.count).toBe(0);
      expect(response.results.some((product) => product.platform === "coupang")).toBe(false);
    }
    expect(coupang?.searchUrl).toBe(
      `https://link.tw.coupang.com/re2/AFFKOLSRP?lptag=AF6766993&pageKey=${encodeURIComponent("耳機")}`,
    );
    if (coupang?.status === "ok") {
      for (const product of response.results.filter((item) => item.platform === "coupang")) {
        expect(product.url.startsWith("https://")).toBe(true);
      }
    }

    const shopee = response.platforms.find((item) => item.id === "shopee");
    expect(shopee?.status).toBe("unavailable");
    expect(shopee?.count).toBe(0);
    expect(response.results.some((product) => product.platform === "shopee")).toBe(false);
  });
});
