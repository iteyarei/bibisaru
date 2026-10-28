import { describe, expect, it } from "vitest";
import {
  BOOKSTORE_PLATFORMS,
  bookstoresExcluded,
  compactText,
  excludedForCategory,
  isRelevantTitle,
  K_PICK_LIMIT,
  matchPlan,
  pickKProducts,
  relevanceRank,
} from "../shared/k-pick";
import type { PlatformId, Product } from "../shared/types";

function product(over: Partial<Product> = {}): Product {
  const platform = over.platform ?? "momo";
  return {
    platform,
    title: "除濕機 12L 節能款",
    price: 4_990,
    image: "",
    url: `https://example.test/${platform}`,
    rank: 0,
    ...over,
  };
}

const titles = (items: readonly Product[]) => items.map((item) => item.title);

describe("compactText", () => {
  it("folds width, case and punctuation away", () => {
    expect(compactText("Switch 2")).toBe("switch2");
    expect(compactText("ＳＷＩＴＣＨ－２")).toBe("switch2");
    expect(compactText("【Apple】iPhone 18 Pro(256G/6.3吋)")).toBe("appleiphone18pro256g63吋");
    expect(compactText("   ")).toBe("");
  });
});

describe("matchPlan", () => {
  it("keeps a listed synonym row as one term with every spelling", () => {
    const plan = matchPlan("Switch 2");
    expect(plan.tokens).toHaveLength(1);
    expect(plan.tokens[0].forms).toEqual(expect.arrayContaining(["switch2", "ns2", "任天堂switch2"]));
    expect(plan.phrase).toBe("switch2");
  });

  it("splits a plain multi-word query into one term per word", () => {
    const plan = matchPlan("iPhone 18 Pro");
    expect(plan.tokens.map((token) => token.token)).toEqual(["iphone", "18", "pro"]);
    expect(plan.phrase).toBe("iphone18pro");
  });
});

describe("isRelevantTitle", () => {
  it("wants every term in the title", () => {
    const plan = matchPlan("iPhone 18 Pro");
    expect(isRelevantTitle("【Apple】iPhone 18 Pro(256G/6.3吋)", plan)).toBe(true);
    expect(isRelevantTitle("iPhone 14 Pro 保護貼", plan)).toBe(false);
  });

  it("accepts a synonym instead of the word itself", () => {
    const plan = matchPlan("Switch 2");
    expect(isRelevantTitle("任天堂 NS2 主機", plan)).toBe(true);
    expect(isRelevantTitle("Switch 主機", plan)).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(isRelevantTitle("", matchPlan("除濕機"))).toBe(false);
  });
});

describe("relevanceRank", () => {
  it("puts the whole query before a pile of terms", () => {
    expect(relevanceRank("除濕機 12L", "除濕機")).toBe(0);
    // Every term is there, but nothing joins them: a weaker match, still relevant.
    expect(relevanceRank("iPhone 18 吋 Pro 手機", "iPhone 18 Pro")).toBe(1);
    expect(relevanceRank("除濕 專用濾網", "除濕機")).toBe(2);
  });

  it("reports 2 for a title that is not a match at all", () => {
    expect(relevanceRank("iPhone 14 Pro 保護貼", "iPhone 18 Pro")).toBe(2);
  });
});

describe("pickKProducts relevance", () => {
  it("drops a bookstore title that only contains 除濕, and keeps the real machines", () => {
    const picked = pickKProducts(
      [
        product({ platform: "kingstone", title: "果蔬采後處理機械設備及生產線設計（除濕篇）", price: 159, rank: 0 }),
        product({ platform: "sanmin", title: "除濕 與 乾燥 技術手冊", price: 320, rank: 1 }),
        product({ platform: "momo", title: "【KINYO】迷你智能除濕機(DHM-3250)", price: 1_121, rank: 0 }),
        product({ platform: "momo", title: "【SHARP 夏普】6公升 高效除濕機(DW-WL6NT-W)", price: 3_990, rank: 1 }),
        product({ platform: "pchome", title: "SAMPO聲寶 6L簡約輕巧除濕機 AD-S512T", price: 4_490, rank: 0 }),
        product({ platform: "yahoo", title: "SAMPO聲寶 迷你除濕機 DN-Z24151L", price: 699, rank: 0 }),
      ],
      { keyword: "除濕機" },
    );

    expect(titles(picked).every((title) => title.includes("除濕機"))).toBe(true);
    expect(titles(picked).some((title) => title.includes("果蔬采後處理"))).toBe(false);
    expect(titles(picked).some((title) => title.includes("乾燥 技術"))).toBe(false);
    expect(picked).toHaveLength(4);
    expect(picked[0].price).toBe(699);
  });

  it("drops the last generation's case for a current phone", () => {
    const picked = pickKProducts(
      [
        product({ platform: "pchome", title: "iPhone 14 Pro 保護貼 滿版玻璃", price: 190, rank: 0 }),
        product({ platform: "pchome", title: "iPhone 18 Pro 保護貼 滿版玻璃", price: 209, rank: 1 }),
        product({ platform: "momo", title: "【Apple】iPhone 18 Pro(256G/6.3吋)", price: 44_900, rank: 0 }),
      ],
      { keyword: "iPhone 18 Pro" },
    );
    expect(titles(picked)).not.toContain("iPhone 14 Pro 保護貼 滿版玻璃");
    expect(picked).toHaveLength(2);
  });
});

describe("pickKProducts relevance tiers", () => {
  it("fills the page with full-keyword hits before weaker matches", () => {
    const picked = pickKProducts(
      [
        // Cheaper, but the words are split up: rank 1.
        product({ platform: "pchome", title: "iPhone 18 吋 Pro 滿版玻璃", price: 100, rank: 0 }),
        // Strong match, dearer.
        product({ platform: "momo", title: "【Apple】iPhone 18 Pro(256G)", price: 44_900, rank: 0 }),
      ],
      { keyword: "iPhone 18 Pro", limit: 1 },
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].price).toBe(44_900);
  });

  it("falls back to the weaker matches only when the strong ones run out", () => {
    const picked = pickKProducts(
      [
        product({ platform: "momo", title: "iPhone 18 Pro 主機", price: 44_900, rank: 0 }),
        product({ platform: "pchome", title: "iPhone 18 吋 Pro 玻璃貼", price: 100, rank: 0 }),
        product({ platform: "yahoo", title: "iPhone 18 Pro Max 主機", price: 52_900, rank: 0 }),
      ],
      { keyword: "iPhone 18 Pro", limit: 3 },
    );
    expect(picked).toHaveLength(3);
    // The weak one is last by price, but it is still a real match, not padding.
    expect(picked.map((item) => item.price)).toEqual([100, 44_900, 52_900]);
  });
});

describe("pickKProducts platform spread", () => {
  it("does not let one shop fill the page with its own cheap rows", () => {
    const cheapRuten = Array.from({ length: 20 }, (_, i) =>
      product({ platform: "ruten", title: `除濕機 福利品 ${i + 1}`, price: 500 + i, rank: i }),
    );
    const picked = pickKProducts(
      [
        ...cheapRuten,
        product({ platform: "momo", title: "除濕機 momo 款", price: 3_990 }),
        product({ platform: "pchome", title: "除濕機 PChome 款", price: 4_490 }),
        product({ platform: "yahoo", title: "除濕機 Yahoo 款", price: 4_990 }),
      ],
      { keyword: "除濕機" },
    );

    expect(picked).toHaveLength(20);
    const shops = new Set(picked.map((item) => item.platform));
    expect(shops.size).toBeGreaterThan(1);
    // Each of the three other shops got in before ruten's second row.
    for (const shop of ["momo", "pchome", "yahoo"] as PlatformId[]) {
      expect(picked.some((item) => item.platform === shop)).toBe(true);
    }
  });

  it("takes turns in the given platform order", () => {
    const picked = pickKProducts(
      [
        product({ platform: "momo", title: "除濕機 A", price: 900, rank: 0 }),
        product({ platform: "pchome", title: "除濕機 B", price: 800, rank: 0 }),
      ],
      { keyword: "除濕機", limit: 1, platformOrder: ["pchome", "momo"] },
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].platform).toBe("pchome");
  });

  it("returns only what is actually relevant instead of padding the page", () => {
    const picked = pickKProducts(
      [
        ...Array.from({ length: 5 }, (_, i) => product({ platform: "momo", title: `除濕機 第${i + 1}款`, price: 2_000 + i })),
        ...Array.from({ length: 30 }, (_, i) => product({ platform: "kingstone", title: `除濕 理論 第${i}冊`, price: 100 + i })),
      ],
      { keyword: "除濕機" },
    );
    expect(picked).toHaveLength(5);
  });

  it("prints a repeated row only once", () => {
    const picked = pickKProducts(
      [
        product({ platform: "pchome", title: "除濕機 同款", price: 3_000, rank: 0 }),
        product({ platform: "pchome", title: "除濕機 同款", price: 3_000, rank: 1 }),
      ],
      { keyword: "除濕機" },
    );
    expect(picked).toHaveLength(1);
  });
});

describe("pickKProducts filtering and order", () => {
  it("drops unusable rows before anything else", () => {
    const picked = pickKProducts(
      [
        product({ price: 0 }),
        product({ price: Number.NaN }),
        product({ title: "   " }),
        product({ price: -5 }),
        product({ price: 2_000, title: "除濕機 正常" }),
      ],
      { keyword: "除濕機" },
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].title).toBe("除濕機 正常");
  });

  it("honours excludePlatforms", () => {
    const picked = pickKProducts(
      [
        product({ platform: "kingstone", title: "除濕機 使用手冊", price: 199 }),
        product({ platform: "momo", title: "除濕機 12L", price: 3_990 }),
      ],
      { keyword: "除濕機", excludePlatforms: ["kingstone"] },
    );
    expect(picked.map((item) => item.platform)).toEqual(["momo"]);
  });

  it("returns the page in ascending price order", () => {
    const picked = pickKProducts(
      [
        product({ platform: "momo", title: "除濕機 貴", price: 9_990 }),
        product({ platform: "momo", title: "除濕機 便宜", price: 990 }),
        product({ platform: "pchome", title: "除濕機 中間", price: 4_990 }),
      ],
      { keyword: "除濕機" },
    );
    const prices = picked.map((item) => item.price);
    expect(prices).toEqual([990, 4_990, 9_990]);
  });

  it("stops at the limit and at a limit of zero returns nothing", () => {
    const many = Array.from({ length: 40 }, (_, i) => product({ platform: "momo", title: `除濕機 ${i}`, price: 1_000 + i }));
    expect(pickKProducts(many, { keyword: "除濕機" })).toHaveLength(K_PICK_LIMIT);
    expect(K_PICK_LIMIT).toBe(20);
    expect(pickKProducts(many, { keyword: "除濕機", limit: 3 })).toHaveLength(3);
    expect(pickKProducts(many, { keyword: "除濕機", limit: 0 })).toHaveLength(0);
  });

  it("returns nothing for an empty keyword or an empty list", () => {
    expect(pickKProducts([product()], { keyword: "" })).toEqual([]);
    expect(pickKProducts([], { keyword: "除濕機" })).toEqual([]);
  });
});

describe("bookstores", () => {
  it("are kingstone and sanmin", () => {
    expect([...BOOKSTORE_PLATFORMS].sort()).toEqual(["kingstone", "sanmin"]);
  });

  it("stay out of appliance and gadget pages", () => {
    expect(bookstoresExcluded("家電")).toBe(true);
    expect(bookstoresExcluded("3C")).toBe(true);
    expect(excludedForCategory("家電")).toEqual(["kingstone", "sanmin"]);
  });

  it("may answer a living or a food page", () => {
    expect(bookstoresExcluded("生活")).toBe(false);
    expect(bookstoresExcluded("食品")).toBe(false);
    expect(excludedForCategory("生活")).toEqual([]);
    expect(bookstoresExcluded("")).toBe(false);
  });

  it("keeps a bookstore out of a real appliance page end to end", () => {
    const products = [
      product({ platform: "kingstone", title: "除濕機 維修 全圖解", price: 350, rank: 0 }),
      product({ platform: "momo", title: "除濕機 12L", price: 3_990, rank: 0 }),
    ];
    expect(pickKProducts(products, { keyword: "除濕機", excludePlatforms: excludedForCategory("家電") })).toHaveLength(1);
    expect(pickKProducts(products, { keyword: "除濕機", excludePlatforms: excludedForCategory("生活") })).toHaveLength(2);
  });
});
