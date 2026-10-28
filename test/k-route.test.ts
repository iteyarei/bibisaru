import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleKPath, K_PAGE_CACHE_CONTROL, resetKReuse, topProducts } from "../shared/k-route";
import { HOT_KEYWORDS } from "../shared/hot-keywords";
import { KEYWORD_SLUGS, resolveKPath } from "../shared/k-slugs";
import { K_SNAPSHOTS } from "../shared/k-snapshots";
import type { PlatformReport, Product, SearchResponse } from "../shared/types";

/** The route is tested without Cloudflare globals: the search step is injected. */
function body(query: string, prices: number[], platforms?: PlatformReport[]): SearchResponse {
  return {
    query,
    fetchedAt: "2026-10-28T04:00:00.000Z",
    results: prices.map((price, index) => ({
      platform: index % 2 === 0 ? "momo" : "pchome",
      title: `${query} 商品 ${index + 1}`,
      price,
      image: `https://img.example.test/${index}.jpg`,
      url: index % 2 === 0 ? `https://www.momoshop.com.tw/goods/${index}` : `https://24h.pchome.com.tw/prod/${index}`,
      rank: index,
    })),
    platforms: platforms ?? [
      { id: "momo", status: "ok", count: prices.length, searchUrl: "https://www.momoshop.com.tw/search/x" },
      { id: "pchome", status: "ok", count: prices.length, searchUrl: "https://24h.pchome.com.tw/search/?q=x" },
    ],
    meta: { colo: "CMH", fetchColo: "" },
  };
}

const NOW = new Date("2026-10-28T12:00:00Z");

beforeEach(() => resetKReuse());

describe("GET /k/<slug>/", () => {
  it("answers 200 with this keyword's own head and live prices", async () => {
    const result = await handleKPath({
      pathname: "/k/switch-2/",
      now: NOW,
      search: async (query) => body(query, [8_990, 4_490, 6_200]),
    });
    expect(result.status).toBe(200);
    expect(result.cacheControl).toBe(K_PAGE_CACHE_CONTROL);
    expect(result.cacheControl).toBe("public, max-age=0, s-maxage=180");
    expect(result.body).toContain("<title>Switch 2 比價｜PChome、momo 價格一次看 — 比比猴</title>");
    expect(result.body).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/switch-2/">');
    expect(result.body).toContain("Switch 2 商品 2");
    // Sorted cheapest first.
    expect(result.body.indexOf("NT$4,490")).toBeLessThan(result.body.indexOf("NT$8,990"));
    expect(result.body).toContain("價格為 2026/10/28 查詢，實際依各賣場為準");
    expect(result.body).toContain("Switch 2 比價");
  });

  it("works without the trailing slash too", async () => {
    const result = await handleKPath({ pathname: "/k/switch-2", now: NOW, search: async (query) => body(query, [1_000]) });
    expect(result.status).toBe(200);
    expect(result.body).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/switch-2/">');
  });

  it("still renders when every shop fails", async () => {
    const result = await handleKPath({
      pathname: "/k/chushiji/",
      now: NOW,
      search: async () => {
        throw new Error("everything is down");
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain("<title>除濕機 比價｜各家價格一次看 — 比比猴</title>");
    expect(result.body).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/chushiji/">');
    expect(result.body).toContain("目前各平台暫時沒有回傳");
    expect(result.body).toContain('href="/?q=%E9%99%A4%E6%BF%95%E6%A9%9F"');
  });

  it("does not search at all when the caller passes no budget", async () => {
    const search = vi.fn(async (query: string) => body(query, [1_000]));
    const result = await handleKPath({ pathname: "/k/xiwanji/", now: NOW });
    expect(search).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toContain("洗碗機 比價");
    expect(result.body).toContain("各賣場這次沒回傳商品");
  });

  it("honours a body with no products", async () => {
    const result = await handleKPath({
      pathname: "/k/xiwanji/",
      now: NOW,
      search: async (query) =>
        body(query, [], [
          { id: "momo", status: "unavailable", count: 0, searchUrl: "https://x.test", reason: "http_403" },
        ]),
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain("各賣場這次沒回傳商品");
    expect(result.body).not.toContain("AggregateOffer");
  });

  it("reuses one live result inside the isolate for a burst of requests", async () => {
    let calls = 0;
    const search = async (query: string) => {
      calls += 1;
      return body(query, [100 + calls]);
    };
    await handleKPath({ pathname: "/k/mianbei/", now: NOW, search });
    const second = await handleKPath({ pathname: "/k/mianbei/", now: NOW, search });
    expect(calls).toBe(1);
    expect(second.body).toContain("NT$101");

    // A different deploy id must not read the old build's prices.
    await handleKPath({ pathname: "/k/mianbei/", now: NOW, version: "abc1234", search });
    expect(calls).toBe(2);
  });

  it("asks again once the reuse window has passed", async () => {
    let calls = 0;
    const search = async (query: string) => {
      calls += 1;
      return body(query, [100 + calls]);
    };
    await handleKPath({ pathname: "/k/reshuiqi/", now: NOW, search });
    await handleKPath({ pathname: "/k/reshuiqi/", now: new Date(NOW.getTime() + 121_000), search });
    expect(calls).toBe(2);
  });
});

describe("GET /k/", () => {
  it("answers 200 with the overview and its own canonical", async () => {
    const result = await handleKPath({ pathname: "/k/", now: NOW });
    expect(result.status).toBe(200);
    expect(result.body).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/">');
    expect(result.body).toContain('href="/k/chushiji/"');
    expect(result.body).not.toContain("?q=");
  });

  it("answers the same for /k with no slash", async () => {
    expect((await handleKPath({ pathname: "/k", now: NOW })).status).toBe(200);
  });
});

describe("unknown slugs", () => {
  it("answer a real 404, never the homepage", async () => {
    const result = await handleKPath({ pathname: "/k/nope-xyz", now: NOW });
    expect(result.status).toBe(404);
    expect(result.cacheControl).toBe("no-store");
    expect(result.body).toContain("找不到這個比價頁");
    expect(result.body).toContain('href="/k/"');
    expect(result.body).toContain('href="/"');
    expect(result.body).not.toContain('id="hot-groups"');
    expect(result.body).not.toContain("輸入關鍵字，一次比較各家價格");
    expect(result.body).toContain('content="noindex"');
  });

  it("are 404 for a known slug with an extra segment", async () => {
    expect((await handleKPath({ pathname: "/k/switch-2/extra", now: NOW })).status).toBe(404);
  });

  it("never ask the shops for an unknown slug", async () => {
    const search = vi.fn(async (query: string) => body(query, [1]));
    await handleKPath({ pathname: "/k/nope-xyz", now: NOW, search });
    expect(search).not.toHaveBeenCalled();
  });
});

describe("topProducts", () => {
  const product = (over: Partial<Product>): Product => ({
    platform: "momo",
    title: "x",
    price: 100,
    image: "",
    url: "https://example.test/1",
    rank: 0,
    ...over,
  });

  it("drops listings without a usable price or title", () => {
    const kept = topProducts([
      product({ price: 0 }),
      product({ price: Number.NaN }),
      product({ title: "   " }),
      product({ price: 500, title: "ok" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe("ok");
  });

  it("sorts by price and then by the shop's own rank, and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => product({ price: 500 - i, rank: i, title: `p${i}` }));
    const kept = topProducts(many);
    expect(kept).toHaveLength(18);
    // Cheapest first: the 30-item list runs 500 down to 471, so the page keeps 471–488.
    expect(kept[0].price).toBe(471);
    expect(kept[17].price).toBe(488);
  });
});

/**
 * Old pages are kept forever: a keyword that drops off hot-keywords.json still
 * has its slug in k-slugs.json, so the page keeps answering at the same URL.
 * It is simply no longer regenerated, and shows its stored snapshot date.
 */
describe("a keyword that left the hot list but kept its slug", () => {
  // Stand-in for a keyword that was retired years ago: the slug is still
  // mapped, the hot list no longer mentions it.
  const RETIRED_KEYWORD = "暖暖包";
  const RETIRED_SLUG = "nuannuanbao";
  const retiredSlugs = new Map([...Object.entries(KEYWORD_SLUGS), [RETIRED_SLUG, RETIRED_KEYWORD]]);
  const retiredSnapshots = {
    [RETIRED_SLUG]: {
      date: "2024/01/15",
      category: "生活",
      products: [
        {
          platform: "momo" as const,
          title: "暖暖包 10 片入",
          price: 89,
          image: "https://img.example.test/nuan.jpg",
          url: "https://www.momoshop.com.tw/goods/nuan",
          rank: 0,
        },
        {
          platform: "pchome" as const,
          title: "暖暖包 24 片入",
          price: 199,
          image: "https://img.example.test/nuan2.jpg",
          url: "https://24h.pchome.com.tw/prod/nuan2",
          rank: 1,
        },
      ],
    },
  };

  it("is genuinely absent from the hot list, so the test means something", () => {
    expect(HOT_KEYWORDS.some((item) => item.keyword === RETIRED_KEYWORD)).toBe(false);
  });

  it("still resolves its old URL instead of 404", () => {
    expect(resolveKPath(`/k/${RETIRED_SLUG}/`, retiredSlugs)).toEqual({
      kind: "keyword",
      keyword: RETIRED_KEYWORD,
      slug: RETIRED_SLUG,
    });
    expect(resolveKPath(`/k/${RETIRED_SLUG}`, retiredSlugs).kind).toBe("keyword");
  });

  it("answers 200 at the old URL with the snapshot and its real date", async () => {
    const search = vi.fn(async (query: string) => body(query, [1_000]));
    const result = await handleKPath({
      pathname: `/k/${RETIRED_SLUG}/`,
      now: NOW,
      search,
      slugs: retiredSlugs,
      snapshots: retiredSnapshots,
    });

    expect(result.status).toBe(200);
    // The old URL still canonicalises to itself: no redirect, no lost ranking.
    expect(result.body).toContain(`<link rel="canonical" href="https://bibisaru.pages.dev/k/${RETIRED_SLUG}/">`);
    // Snapshot prices, not today's imaginary ones.
    expect(result.body).toContain("暖暖包 10 片入");
    expect(result.body).toContain("NT$89");
    // The date line is the capture date, not today.
    expect(result.body).toContain("價格為 2024/01/15 查詢，實際依各賣場為準");
    expect(result.body).not.toContain("價格為 2026/10/28 查詢");
    // It says plainly that the page is an archive.
    expect(result.body).toContain("已經從熱門清單退下來");
    // It is not regenerated on request: no shop traffic for a frozen page.
    expect(search).not.toHaveBeenCalled();
  });

  it("still carries the live refresh and the live-search button", async () => {
    const result = await handleKPath({
      pathname: `/k/${RETIRED_SLUG}/`,
      now: NOW,
      slugs: retiredSlugs,
      snapshots: retiredSnapshots,
    });
    expect(result.body).toContain('href="/?q=%E6%9A%96%E6%9A%96%E5%8C%85"');
    expect(result.body).toContain("看即時比價");
    expect(result.body).toContain("/api/search?q=");
    expect(result.body).toContain('"snapshot":"2024/01/15"');
    expect(result.body).toContain("目前無法取得最新價格，以下為");
  });

  it("still renders when the keyword has no snapshot at all", async () => {
    const result = await handleKPath({
      pathname: `/k/${RETIRED_SLUG}/`,
      now: NOW,
      slugs: retiredSlugs,
      snapshots: {},
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain("已經從熱門清單退下來");
    expect(result.body).toContain("看即時比價");
    expect(result.body).toContain('href="/?q=%E6%9A%96%E6%9A%96%E5%8C%85"');
  });

  it("leaves a slug nobody ever mapped as a 404", async () => {
    const result = await handleKPath({ pathname: "/k/never-existed/", now: NOW, slugs: retiredSlugs });
    expect(result.status).toBe(404);
  });
});

describe("the shipped slug map", () => {
  it("maps every entry both ways, so no old URL can be stolen", () => {
    for (const [keyword, slug] of Object.entries(KEYWORD_SLUGS)) {
      expect(resolveKPath(`/k/${slug}/`)).toEqual({ kind: "keyword", keyword, slug });
      expect(K_SNAPSHOTS[slug]).toBeUndefined();
    }
  });
});
