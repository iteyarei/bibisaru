import { describe, expect, it } from "vitest";
import { filterBySearchTerms, prepareResults } from "../shared/filter";
import { PLATFORM_IDS, rawSearchUrl } from "../shared/platforms";
import { segmentCjkKeyword } from "../shared/segment";
import { searchPlatforms, unavailableResult } from "../shared/search";
import { searchTokens, titleHasEveryTerm, tokenMatchKind } from "../shared/synonyms";
import type { Product } from "../shared/types";

function item(title: string, price = 1000): Product {
  return { platform: "momo", title, price, image: "", url: "https://www.momoshop.com.tw/goods/1", rank: 0 };
}

describe("search tokens", () => {
  it("splits half-width and full-width spaces", () => {
    expect(searchTokens("鬼武者 ns2")).toEqual(["鬼武者", "ns2"]);
    expect(searchTokens("鬼武者　ｎｓ２")).toEqual(["鬼武者", "ns2"]);
  });

  it("keeps a multi-word synonym as one term", () => {
    expect(searchTokens("PlayStation 5 主機")).toEqual(["playstation 5", "主機"]);
    expect(searchTokens("任天堂 Switch 2")).toEqual(["任天堂 switch 2"]);
    expect(searchTokens("Switch 2")).toEqual(["switch 2"]);
  });
});

describe("and match with synonyms", () => {
  const catalog = [
    item("鬼武者 Switch 2"),
    item("鬼武者 NS2 中文版"),
    item("鬼武者 Switch2"),
    item("任天堂 Switch 2 鬼武者"),
    item("鬼武者"),
    item("NS2 主機"),
    item("PlayStation 5 主機"),
    item("PS5 光碟版"),
  ];

  it("requires every word, and treats NS2 forms as the same word", () => {
    expect(filterBySearchTerms(catalog, "鬼武者 ns2").map((product) => product.title)).toEqual([
      "鬼武者 Switch 2",
      "鬼武者 NS2 中文版",
      "鬼武者 Switch2",
      "任天堂 Switch 2 鬼武者",
    ]);
  });

  it("ignores case and full-width letters", () => {
    expect(titleHasEveryTerm("鬼武者 ＳＷＩＴＣＨ２", "鬼武者 ns2")).toBe(true);
    expect(titleHasEveryTerm("鬼武者 switch", "鬼武者 ns2")).toBe(false);
  });

  it("treats PS5 and PlayStation 5 as the same term", () => {
    expect(filterBySearchTerms(catalog, "ps5").map((product) => product.title)).toEqual([
      "PlayStation 5 主機",
      "PS5 光碟版",
    ]);
    expect(titleHasEveryTerm("PS5 主機", "PlayStation 5")).toBe(true);
  });

  it("treats NS and Switch as the same term, separately from NS2", () => {
    expect(titleHasEveryTerm("Nintendo Switch 主機", "ns")).toBe(true);
    expect(titleHasEveryTerm("Switch 主機", "ns2")).toBe(false);
  });

  it("ignores spaces and symbols inside a mixed letter-and-number word", () => {
    expect(titleHasEveryTerm("Samsung Galaxy Z Fold 8 512GB", "samsung fold8 512")).toBe(true);
    expect(titleHasEveryTerm("SAMSUNG Galaxy Z Fold-8 512 GB", "fold8 512gb")).toBe(true);
    expect(titleHasEveryTerm("iPhone 15", "iphone15")).toBe(true);
    expect(titleHasEveryTerm("iPhone15", "iphone 15")).toBe(true);
    expect(titleHasEveryTerm("Galaxy Z Fold 8 256GB", "samsung fold8 512")).toBe(false);
    expect(titleHasEveryTerm("Galaxy Z Fold8 (12G/512G)", "samsung fold8 512")).toBe(false);
  });

  it("splits a long CJK keyword when the pieces are not contiguous", () => {
    expect(segmentCjkKeyword("大同電鍋")).toEqual(["大同", "電鍋"]);
    expect(segmentCjkKeyword("象印熱水瓶")).toEqual(["象印", "熱水瓶"]);
    expect(segmentCjkKeyword("國際牌冰箱")).toEqual(["國際牌", "冰箱"]);
    expect(segmentCjkKeyword("鬼武者")).toEqual(["鬼武", "武者"]);

    expect(titleHasEveryTerm("大同 不鏽鋼電鍋", "大同電鍋")).toBe(true);
    expect(titleHasEveryTerm("大同10人份電鍋", "大同電鍋")).toBe(true);
    expect(titleHasEveryTerm("大同電鍋", "大同電鍋")).toBe(true);
    expect(titleHasEveryTerm("大同　不鏽鋼電鍋", "大同電鍋")).toBe(true);
    expect(titleHasEveryTerm("電鍋 大同", "大同電鍋")).toBe(true);

    expect(titleHasEveryTerm("象印電鍋", "大同電鍋")).toBe(false);
    expect(titleHasEveryTerm("大同冰箱", "大同電鍋")).toBe(false);
    expect(titleHasEveryTerm("不鏽鋼鍋", "大同電鍋")).toBe(false);
    expect(titleHasEveryTerm("大同 不鏽鋼電鍋", "大同電鍋 10人份")).toBe(false);
    expect(titleHasEveryTerm("大不鏽鋼同", "大同")).toBe(false);

    expect(tokenMatchKind("大同電鍋 10人份", "大同電鍋")).toBe("exact");
    expect(tokenMatchKind("大同 不鏽鋼電鍋", "大同電鍋")).toBe("segment");
    expect(tokenMatchKind("象印電鍋", "大同電鍋")).toBe("none");
  });

  it("recomputes the lowest price after dropping titles that miss a word", () => {
    const visible = prepareResults(
      [item("鬼武者", 500), item("鬼武者 Switch 2", 1800), item("鬼武者 NS2", 2400)],
      {
        keywords: [],
        platforms: ["momo"],
        sort: "price-asc",
        query: "鬼武者 ns2",
      },
    );
    expect(visible.map((product) => product.price)).toEqual([1800, 2400]);
    expect(visible[0]?.lowest).toBe(true);
    expect(visible[1]?.lowest).toBe(false);
  });
});

describe("shop queries stay whole", () => {
  it("sends the original keyword upstream", async () => {
    const seen: string[] = [];
    const response = await searchPlatforms(
      "大同電鍋",
      ["momo", "shopee"],
      {
        momo: async (query) => {
          seen.push(query);
          return unavailableResult("momo", query);
        },
        shopee: async (query) => {
          seen.push(query);
          return unavailableResult("shopee", query);
        },
      },
    );
    expect(seen).toEqual(["大同電鍋", "大同電鍋"]);
    expect(response.query).toBe("大同電鍋");
    const encoded = encodeURIComponent("大同電鍋");
    for (const id of PLATFORM_IDS) {
      expect(rawSearchUrl(id, "大同電鍋")).toContain(encoded);
    }
    expect(rawSearchUrl("shopee", "大同電鍋")).toBe(`https://shopee.tw/search?keyword=${encoded}`);
    expect(rawSearchUrl("momo", "大同電鍋")).toBe(`https://www.momoshop.com.tw/search/${encoded}`);
  });
});
