import { describe, expect, it } from "vitest";
import {
  addKeywords,
  filterByKeywords,
  filterByPlatforms,
  filterByPrice,
  markLowest,
  parseKeywordDraft,
  parsePriceBound,
  prepareResults,
  removeKeywords,
  sortProducts,
} from "../shared/filter";
import { formatUpdated } from "../shared/i18n";
import { parsePlatformParam } from "../shared/platforms";
import { normalizeQuery } from "../shared/query";
import { createRateLimiter } from "../shared/rate-limit";
import type { Product } from "../shared/types";

function item(partial: Partial<Product> & Pick<Product, "title" | "price" | "platform">): Product {
  return {
    image: "",
    url: `https://example.com/${partial.platform}/${partial.rank ?? 0}`,
    rank: 0,
    ...partial,
  };
}

const catalog: Product[] = [
  item({ platform: "momo", title: "二手藍牙耳機", price: 300, rank: 0, url: "https://www.momoshop.com.tw/a" }),
  item({ platform: "pchome", title: "輕巧入耳式耳機", price: 1290, rank: 1, url: "https://24h.pchome.com.tw/prod/a" }),
  item({ platform: "coupang", title: "保護殼", price: 199, rank: 0, url: "https://www.tw.coupang.com/products/case" }),
  item({ platform: "yahoo", title: "iPhone 耳機", price: 1290, rank: 2, url: "https://tw.buy.yahoo.com/gdsale/b.html" }),
  item({ platform: "shopee", title: "高階耳機", price: 2490, rank: 4, url: "https://shopee.tw/-i.1.2" }),
];

describe("negative keywords", () => {
  it("hides a title that contains any excluded word", () => {
    const titles = filterByKeywords(catalog, ["二手", "殼"]).map((product) => product.title);
    expect(titles).toEqual(["輕巧入耳式耳機", "iPhone 耳機", "高階耳機"]);
  });

  it("matches without regard to english case", () => {
    const titles = filterByKeywords(catalog, ["iphone"]).map((product) => product.title);
    expect(titles).not.toContain("iPhone 耳機");
  });

  it("keeps everything when there is no keyword", () => {
    expect(filterByKeywords(catalog, ["", "  "])).toHaveLength(catalog.length);
  });
});

describe("platform toggles", () => {
  it("drops platforms that are turned off", () => {
    const titles = filterByPlatforms(catalog, ["momo", "pchome"]).map((product) => product.platform);
    expect(titles).toEqual(["momo", "pchome"]);
  });

  it("returns nothing when every platform is off", () => {
    expect(filterByPlatforms(catalog, [])).toEqual([]);
  });
});

describe("sort and lowest price", () => {
  it("sorts price low to high and breaks ties by source rank", () => {
    const prices = sortProducts(catalog, "price-asc", "耳機").map((product) => product.price);
    expect(prices).toEqual([199, 300, 1290, 1290, 2490]);
    const tied = sortProducts(catalog, "price-asc", "耳機").filter((product) => product.price === 1290);
    expect(tied.map((product) => product.platform)).toEqual(["pchome", "yahoo"]);
  });

  it("sorts price high to low", () => {
    expect(sortProducts(catalog, "price-desc", "耳機").map((product) => product.price)).toEqual([
      2490, 1290, 1290, 300, 199,
    ]);
  });

  it("ranks a full phrase above a partial token", () => {
    const products = [
      item({ platform: "momo", title: "Pods case", price: 100, rank: 0, url: "https://www.momoshop.com.tw/1" }),
      item({ platform: "pchome", title: "Air Pods Pro", price: 100, rank: 5, url: "https://24h.pchome.com.tw/prod/2" }),
      item({ platform: "yahoo", title: "其他", price: 100, rank: 1, url: "https://tw.buy.yahoo.com/gdsale/3.html" }),
    ];
    expect(sortProducts(products, "relevance", "air pods").map((product) => product.title)).toEqual([
      "Air Pods Pro",
      "Pods case",
      "其他",
    ]);
  });

  it("marks every item tied for the lowest price", () => {
    const marked = markLowest([
      item({ platform: "momo", title: "a", price: 10, url: "https://www.momoshop.com.tw/1" }),
      item({ platform: "pchome", title: "b", price: 10, url: "https://24h.pchome.com.tw/prod/2" }),
      item({ platform: "yahoo", title: "c", price: 12, url: "https://tw.buy.yahoo.com/gdsale/3.html" }),
    ]);
    expect(marked.map((product) => product.lowest)).toEqual([true, true, false]);
  });

  it("recomputes the lowest price after filters, and does not mutate the input", () => {
    const original = catalog.map((product) => product.title);
    const visible = prepareResults(catalog, {
      keywords: ["二手", "殼"],
      platforms: ["momo", "pchome", "coupang", "yahoo", "shopee"],
      sort: "price-asc",
      query: "耳機",
    });
    expect(visible.map((product) => product.price)).toEqual([1290, 1290, 2490]);
    expect(visible.filter((product) => product.lowest).map((product) => product.platform)).toEqual([
      "pchome",
      "yahoo",
    ]);
    expect(catalog.map((product) => product.title)).toEqual(original);
  });

  it("filters by price and swaps the ends when the minimum is higher", () => {
    const prices = catalog.map((product) => product.price);
    expect(filterByPrice(catalog, null, null).map((product) => product.price)).toEqual(prices);
    expect(parsePriceBound("")).toBeNull();
    expect(parsePriceBound("1,200")).toBe(1200);
    expect(filterByPrice(catalog, 1000, null).every((product) => product.price >= 1000)).toBe(true);
    expect(filterByPrice(catalog, null, 500).every((product) => product.price <= 500)).toBe(true);
    const swapped = filterByPrice(catalog, 2000, 1000).map((product) => product.price);
    expect(swapped.every((price) => price >= 1000 && price <= 2000)).toBe(true);
    expect(swapped.length).toBeGreaterThan(0);

    const visible = prepareResults(catalog, {
      keywords: [],
      platforms: ["momo", "pchome", "coupang", "yahoo", "shopee"],
      sort: "price-asc",
      query: "耳機",
      priceMin: 2000,
      priceMax: null,
    });
    expect(Math.min(...visible.map((product) => product.price))).toBeGreaterThanOrEqual(2000);
    expect(visible[0]?.lowest).toBe(true);
  });
});

describe("keyword chips and query", () => {
  it("splits on comma and ignores duplicates", () => {
    expect(parseKeywordDraft("二手, 保護殼，二手")).toEqual(["二手", "保護殼", "二手"]);
    expect(addKeywords([], parseKeywordDraft("二手, 保護殼，二手"))).toEqual(["二手", "保護殼"]);
    expect(addKeywords(["二手"], ["二手", "福利品"])).toEqual(["二手", "福利品"]);
  });

  it("stops at 12 keywords and can remove a preset", () => {
    const many = Array.from({ length: 12 }, (_unused, index) => `字${index}`);
    expect(addKeywords(many, ["新"])).toHaveLength(12);
    expect(removeKeywords(["殼", "自訂", "二手"], ["殼", "二手"])).toEqual(["自訂"]);
  });

  it("normalizes the search query", () => {
    expect(normalizeQuery("  藍芽   耳機 \n")).toBe("藍芽 耳機");
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("a".repeat(41))).toBeNull();
  });

  it("parses the platform parameter", () => {
    expect(parsePlatformParam(null)).toEqual([
      "momo",
      "pchome",
      "yahoo",
      "coupang",
      "shopee",
      "pxgo",
      "etmall",
      "kingstone",
      "sanmin",
      "eslite",
    ]);
    expect(parsePlatformParam("shopee,yahoo,pchome")).toEqual(["pchome", "yahoo", "shopee"]);
    expect(parsePlatformParam("shopee,pchome,nope")).toEqual(["pchome", "shopee"]);
    expect(parsePlatformParam("")).toEqual([]);
  });
});

describe("rate limit and freshness copy", () => {
  it("allows a short burst and then waits for the window", () => {
    const allow = createRateLimiter(2, 1_000);
    expect(allow("1.1.1.1", 0)).toBe(true);
    expect(allow("1.1.1.1", 10)).toBe(true);
    expect(allow("1.1.1.1", 20)).toBe(false);
    expect(allow("8.8.8.8", 20)).toBe(true);
    expect(allow("1.1.1.1", 1_000)).toBe(true);
  });

  it("formats the cache age", () => {
    const now = Date.parse("2026-10-12T03:00:00Z");
    expect(formatUpdated("2026-10-12T02:59:30Z", now)).toBe("剛剛更新");
    expect(formatUpdated("2026-10-12T02:57:00Z", now)).toBe("約 3 分鐘前更新");
  });
});
