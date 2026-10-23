import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchers } from "../functions/lib/providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string) => Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seen.push(url);
      return handler(url);
    }),
  );
  return seen;
}

const rakutenHtml = `<script type="application/json" data-component-name="SearchPage">${JSON.stringify({
  initialData: {
    searchPage: {
      result: {
        items: [
          {
            itemName: "有線耳機",
            itemUrl: "https://www.rakuten.com.tw/shop/a/product/b/?s-id=RADSearch_ProductAd_01",
            itemPrice: { min: 160, max: 160 },
            itemImageUrl: "https://tshop.r10s.com/a.png",
            itemStatus: "Available",
          },
        ],
      },
    },
  },
})}</script>`;

describe("樂天 fetcher", () => {
  it("fetches the raw search page and returns affiliate-wrapped visitor links", async () => {
    const seen = stubFetch(() => new Response(rakutenHtml, { status: 200 }));
    const result = await fetchers.rakuten("耳機");
    expect(seen).toEqual([`https://www.rakuten.com.tw/search/${encodeURIComponent("耳機")}/`]);
    expect(result.status).toBe("ok");
    expect(result.products[0]?.url).toContain("https://product.mchannles.com/redirect_wa.php?");
    expect(result.searchUrl).toContain("https://product.mchannles.com/redirect_wa.php?");
  });

  it("shows the link-out card when the page is blocked", async () => {
    const seen = stubFetch(() => new Response("blocked", { status: 403 }));
    const result = await fetchers.rakuten("耳機");
    expect(seen.length).toBe(2);
    expect(result).toMatchObject({ id: "rakuten", status: "unavailable", reason: "http_403", products: [] });
    expect(result.searchUrl).toContain("tourl=");
  });

  it("reports a parse error when the embedded JSON is gone", async () => {
    stubFetch(() => new Response("<html>nothing</html>", { status: 200 }));
    const result = await fetchers.rakuten("耳機");
    expect(result).toMatchObject({ status: "unavailable", reason: "parse_error" });
  });
});

describe("露天 fetcher", () => {
  const detail = [
    { ProdId: "2", ProdName: "耳機乙", PriceRange: [200, 200], Image: "/g5/b.jpg", StockQty: 5, SaleType: "buy" },
    { ProdId: "1", ProdName: "耳機甲", PriceRange: [100, 300], Image: "/g5/a.jpg", StockQty: 5, SaleType: "buy" },
  ];

  it("searches for ids, then reads the details, and does not wrap links", async () => {
    const seen = stubFetch((url) =>
      url.includes("/search/v3/")
        ? new Response(JSON.stringify({ TotalRows: 2, Rows: [{ Id: "1" }, { Id: "2" }] }), { status: 200 })
        : new Response(JSON.stringify(detail), { status: 200 }),
    );
    const result = await fetchers.ruten("耳機");
    expect(seen[0]).toBe(
      `https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q=${encodeURIComponent("耳機")}&type=direct&sort=rnk%2Fdc&offset=1&limit=24`,
    );
    expect(seen[1]).toBe("https://rtapi.ruten.com.tw/api/prod/v2/index.php/prod?id=1,2");
    expect(result.status).toBe("ok");
    expect(result.products.map((product) => product.title)).toEqual(["耳機甲", "耳機乙"]);
    expect(result.products[0]).toMatchObject({
      price: 100,
      url: "https://www.ruten.com.tw/item/1/",
      image: "https://gcs.rimg.com.tw/g5/a.jpg",
    });
    expect(result.searchUrl).toBe(`https://www.ruten.com.tw/search/${encodeURIComponent("耳機")}/`);
  });

  it("returns an empty ok result without a detail call when nothing matches", async () => {
    const seen = stubFetch(() => new Response(JSON.stringify({ TotalRows: 0, Rows: [] }), { status: 200 }));
    const result = await fetchers.ruten("耳機");
    expect(seen.length).toBe(1);
    expect(result).toMatchObject({ status: "ok", products: [] });
  });

  it("shows the link-out card when the API is blocked", async () => {
    stubFetch(() => new Response("blocked", { status: 403 }));
    const result = await fetchers.ruten("耳機");
    expect(result).toMatchObject({ id: "ruten", status: "unavailable", reason: "http_403", products: [] });
    expect(result.searchUrl).toBe(`https://www.ruten.com.tw/search/${encodeURIComponent("耳機")}/`);
  });
});
