import { describe, expect, it } from "vitest";
import { filterBySearchTerms, prepareResults } from "../shared/filter";
import { searchTokens, titleHasEveryTerm } from "../shared/synonyms";
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
