import { describe, expect, it } from "vitest";
import {
  kPageDescription,
  kPageTitle,
  K_PAGE_ITEMS,
  renderKNotFound,
  renderKOverview,
  renderKPage,
  taipeiDate,
  type KPageData,
} from "../shared/k-page";
import { kOverviewUrl, kPageUrl } from "../shared/k-slugs";
import type { PlatformReport, Product } from "../shared/types";

const report = (id: PlatformReport["id"], status: PlatformReport["status"], count = 0): PlatformReport => ({
  id,
  status,
  count,
  searchUrl: `https://example.test/${id}`,
});

function product(over: Partial<Product> = {}): Product {
  return {
    platform: "momo",
    title: "除濕機 12L 節能款",
    price: 4_990,
    image: "https://img.example.test/a.jpg",
    url: "https://www.momoshop.com.tw/goods/1",
    rank: 0,
    ...over,
  };
}

function data(over: Partial<KPageData> = {}): KPageData {
  return {
    keyword: "除濕機",
    slug: "chushiji",
    category: "家電",
    reason: "入秋濕冷，除濕清淨兩用機銷量成長近6倍",
    products: [
      product({ price: 3_990, rank: 2 }),
      product({ price: 4_990, platform: "pchome", url: "https://24h.pchome.com.tw/prod/1", rank: 1 }),
      product({ price: 6_490, platform: "yahoo", url: "https://tw.buy.yahoo.com/gdsale/1" }),
    ],
    platforms: [report("momo", "ok", 8), report("pchome", "ok", 5), report("yahoo", "ok", 4)],
    fetchedAt: new Date("2026-10-28T04:00:00Z"),
    ...over,
  };
}

const TODAY = new Date("2026-10-28T12:34:00Z");

describe("landing page head", () => {
  const html = renderKPage(data(), TODAY);

  it("has its own title naming a shop and the site", () => {
    expect(html).toContain("<title>除濕機 比價｜momo、PChome、Yahoo奇摩 價格一次看 — 比比猴</title>");
    expect(kPageTitle("除濕機", [], [])).toBe("除濕機 比價｜各家價格一次看 — 比比猴");
  });

  it("canonical points at itself, never the homepage", () => {
    expect(html).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/chushiji/">');
    expect(html).not.toContain('<link rel="canonical" href="https://bibisaru.pages.dev/">');
  });

  it("carries og tags, lang and viewport", () => {
    expect(html).toContain('<html lang="zh-Hant">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta property="og:url" content="https://bibisaru.pages.dev/k/chushiji/">');
    expect(html).toMatch(/<meta property="og:title" content="除濕機 比價｜/);
    expect(html).toMatch(/<meta property="og:description" content="除濕機 在 /);
    expect(html).toMatch(/<meta name="description" content="除濕機 在 /);
  });

  it("says the price range and the platform names in the description", () => {
    const description = kPageDescription(data());
    expect(description).toContain("momo、PChome、Yahoo奇摩");
    expect(description).toContain("NT$3,990 到 NT$6,490");
  });
});

describe("landing page body", () => {
  const html = renderKPage(data(), TODAY);

  it("server renders every listing with platform, price and a lazy image", () => {
    expect(html).toContain("除濕機 12L 節能款");
    expect(html).toContain("NT$3,990");
    expect(html).toContain("NT$4,990");
    expect(html).toContain("最低價");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('src="https://img.example.test/a.jpg"');
    expect(html).toContain(">PChome<");
  });

  it("links each item out through the affiliate wrapper", () => {
    // momo goes through 通路王, PChome stays bare.
    expect(html).toContain("product.mchannles.com/redirect_wa.php");
    expect(html).toContain('href="https://24h.pchome.com.tw/prod/1"');
    expect(html).toContain('rel="noopener nofollow sponsored"');
  });

  it("has the intro, the timestamp line and the live-search link", () => {
    expect(html).toContain("目前在 momo、PChome、Yahoo奇摩 等平台共 3 筆");
    expect(html).toContain("價格為 2026/10/28 查詢，實際依各賣場為準");
    expect(html).toContain('data-snapshot="2026/10/28"');
    expect(html).toContain('href="/?q=%E9%99%A4%E6%BF%95%E6%A9%9F"');
    expect(html).toContain('href="/k/"');
    expect(html).toContain('href="/"');
  });

  it("puts a prominent live-search button right under the intro", () => {
    expect(html).toContain('<a class="cta" href="/?q=%E9%99%A4%E6%BF%95%E6%A9%9F">看即時比價</a>');
    // Above the list, so it is reachable without scrolling past 20 listings.
    expect(html.indexOf('class="cta"')).toBeLessThan(html.indexOf('id="list"'));
  });

  it("renders no more than the item cap", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      product({ price: 1_000 + i, url: `https://www.momoshop.com.tw/goods/${i}`, rank: i }),
    );
    const out = renderKPage(data({ products: many.slice(0, K_PAGE_ITEMS) }), TODAY);
    expect(out.match(/class="thumb"/g)?.length ?? 0).toBeGreaterThanOrEqual(K_PAGE_ITEMS - 1);
    const li = (html2: string) => (html2.match(/<li>/g) ?? []).length;
    expect(li(out)).toBe(K_PAGE_ITEMS);
  });
});

describe("landing page structured data", () => {
  const html = renderKPage(data(), TODAY);
  const json = JSON.parse(html.slice(html.indexOf('<script type="application/ld+json">') + 35, html.indexOf("</script>"))) as {
    "@graph": Array<Record<string, unknown>>;
  };

  it("has an ItemList of Products with TWD offers", () => {
    const list = json["@graph"].find((node) => node["@type"] === "ItemList") as {
      numberOfItems: number;
      itemListElement: Array<{ position: number; item: { name: string; offers: Record<string, unknown> } }>;
    };
    expect(list.numberOfItems).toBe(3);
    expect(list.itemListElement[0].position).toBe(1);
    expect(list.itemListElement[0].item.offers).toMatchObject({ price: 3_990, priceCurrency: "TWD" });
    expect(list.itemListElement[0].item.offers.availability).toContain("InStock");
  });

  it("has an AggregateOffer and a breadcrumb", () => {
    const offer = json["@graph"].find((node) => node["@type"] === "Product") as {
      offers: Record<string, unknown>;
    };
    expect(offer.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 3_990, highPrice: 6_490, priceCurrency: "TWD", offerCount: 3 });
    const crumbs = json["@graph"].find((node) => node["@type"] === "BreadcrumbList") as {
      itemListElement: Array<{ name: string; item: string }>;
    };
    expect(crumbs.itemListElement.map((crumb) => crumb.name)).toEqual(["首頁", "熱門比價", "除濕機"]);
    expect(crumbs.itemListElement[2].item).toBe(kPageUrl("chushiji"));
  });
});

describe("landing page escaping", () => {
  it("escapes store titles and rejects javascript: product links", () => {
    const html = renderKPage(
      data({
        products: [
          product({
            title: `除濕機 <img src=x onerror="alert(1)"> & 特價`,
            url: "javascript:alert(1)",
            image: "javascript:alert(2)",
          }),
        ],
      }),
      TODAY,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 特價");
    expect(html).not.toContain("javascript:");
    // The item stays visible as plain text instead of becoming a link.
    expect(html).toContain("除濕機 <".replace("<", "&lt;"));
  });

  it("escapes the keyword in the title and body", () => {
    const html = renderKPage(data({ keyword: `壞"字<svg>` }), TODAY);
    expect(html).toContain("<title>壞&quot;字&lt;svg&gt; 比價｜");
    expect(html).not.toContain("<svg>");
  });
});

describe("landing page when every shop fails", () => {
  const html = renderKPage(
    data({ products: [], platforms: [report("momo", "unavailable"), report("yahoo", "unavailable")] }),
    TODAY,
  );

  it("still renders, with head, intro and the live-search link", () => {
    expect(html).toContain("<title>除濕機 比價｜各家價格一次看 — 比比猴</title>");
    expect(html).toContain('<link rel="canonical" href="https://bibisaru.pages.dev/k/chushiji/">');
    expect(html).toContain("目前各平台暫時沒有回傳");
    expect(html).toContain('href="/?q=%E9%99%A4%E6%BF%95%E6%A9%9F"');
    expect(html).toContain("價格為 2026/10/28 查詢");
  });

  it("claims no AggregateOffer for products that do not exist", () => {
    expect(html).not.toContain("AggregateOffer");
    expect(html).not.toContain('class="best"');
  });
});

describe("progressive enhancement script", () => {
  const html = renderKPage(data(), TODAY);
  const script = html.slice(html.indexOf('id="list"'), html.lastIndexOf("</body>"));

  it("refreshes from /api/search with the same platform list", () => {
    expect(script).toContain("/api/search?q=");
    expect(script).toContain("momo,pchome,yahoo,coupang,shopee,pxgo,etmall,rakuten,ruten");
    expect(script).toContain('"limit":20');
  });

  it("starts as soon as the document is ready, never waiting on a click", () => {
    expect(script).toContain('document.addEventListener("DOMContentLoaded", start)');
    expect(script).toContain('if (document.readyState === "loading")');
    expect(script).toContain("else start();");
  });

  it("shows a loading state so a snapshot price never looks final", () => {
    expect(html).toContain("正在取得最新價格…");
    expect(html).toContain('class="list loading"');
    // Hidden in the markup and revealed by the script, so a reader with
    // scripting off never sees a loading message that never ends.
    expect(html).toContain('id="fresh" role="status" aria-live="polite" hidden');
    expect(script).toContain('list.classList.add("loading")');
    expect(script).toContain("busy(true)");
  });

  it("rewrites the query-time line to the live fetch time, not the snapshot's", () => {
    expect(script).toContain('note("價格為 " + when + " 查詢，實際依各賣場為準", false)');
    expect(script).toContain("body.fetchedAt");
    expect(script).toContain("toLocaleDateString");
  });

  it("keeps the snapshot and says how old it is when the fetch fails", () => {
    expect(script).toContain("目前無法取得最新價格，以下為");
    expect(script).toContain("資料");
    expect(script).toContain('"snapshot":');
    expect(script).toContain(".catch(giveUp)");
    // Giving up only relabels the date line: the server-rendered list stays put.
    const giveUp = script.slice(script.indexOf("function giveUp()"), script.indexOf("function item("));
    expect(giveUp).toContain("busy(false)");
    expect(giveUp).not.toContain("replaceChildren");
    expect(giveUp).not.toContain("list.hidden = true");
  });

  it("degrades to the server-rendered list when the fetch fails", () => {
    expect(script).not.toMatch(/localStorage|sessionStorage|document\.write/);
  });

  it("stays readable with scripting off: no permanent dimming, no stuck spinner", () => {
    // The list ships with the loading class so it fades the instant it paints,
    // but with JS off nothing would ever remove it.
    expect(html).toContain("<noscript><style>.list.loading{opacity:1}</style></noscript>");
    // It must not un-hide [hidden] boxes: that would show "no products" over a real list.
    expect(html).not.toContain(".empty[hidden],ul.list[hidden]");
    expect(html).toContain('id="fresh" role="status" aria-live="polite" hidden');
  });
});

describe("overview page", () => {
  const html = renderKOverview(TODAY);

  it("lists every hot keyword, grouped, linking to its page", () => {
    expect(html).toContain("<title>熱門比價 — 17 個人氣商品關鍵字 — 比比猴</title>");
    expect(html).toContain(`<link rel="canonical" href="${kOverviewUrl()}">`);
    for (const path of ["/k/chushiji/", "/k/iphone-18-pro/", "/k/switch-2/", "/k/luguakafei/"]) {
      expect(html).toContain(`href="${path}"`);
    }
    for (const category of ["家電", "3C", "生活", "食品"]) expect(html).toContain(`<h2>${category}</h2>`);
    expect(html).toContain('href="/"');
  });

  it("does not fall back to ?q= links", () => {
    expect(html).not.toContain("?q=");
  });
});

describe("not found page", () => {
  const html = renderKNotFound("/k/nope-xyz");

  it("says so plainly and points at the overview and home", () => {
    expect(html).toContain("找不到這個比價頁");
    expect(html).toContain("/k/nope-xyz");
    expect(html).toContain('href="/k/"');
    expect(html).toContain('href="/"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("escapes the path it echoes", () => {
    expect(renderKNotFound(`/k/<script>`)).toContain("&lt;script&gt;");
  });
});

describe("dates", () => {
  it("uses Taipei time for the query date", () => {
    expect(taipeiDate(new Date("2026-10-28T15:00:00Z"))).toBe("2026/10/28");
    expect(taipeiDate(new Date("2026-10-28T16:30:00Z"))).toBe("2026/10/29");
  });
});
