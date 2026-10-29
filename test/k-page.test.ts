import { describe, expect, it } from "vitest";
import {
  kPageDescription,
  kPageTitle,
  K_PAGE_ITEMS,
  renderKNotFound,
  renderKOverview,
  renderKPage,
  hotOverviewItems,
  taipeiDate,
  type KPageData,
} from "../shared/k-page";
import type { KPageGroup } from "../shared/k-group";
import { groupHotKeywords, HOT_KEYWORDS } from "../shared/hot-keywords";
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
    expect(html.indexOf('class="cta"')).toBeLessThan(html.indexOf('id="groups"'));
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

describe("landing page sections", () => {
  const groups: KPageGroup[] = [
    {
      kind: "main",
      title: "主機",
      products: [
        product({ platform: "momo", title: "Switch 2 主機 台灣公司貨", price: 15_880, url: "https://www.momoshop.com.tw/goods/1" }),
        product({ platform: "pchome", title: "Switch 2 主機 同捆組", price: 16_980, url: "https://24h.pchome.com.tw/prod/1" }),
      ],
    },
    {
      kind: "accessories",
      title: "配件與周邊",
      products: [product({ platform: "yahoo", title: "Switch 2 保護殼 透明", price: 290, url: "https://tw.buy.yahoo.com/gdsale/1" })],
    },
  ];
  const grouped = data({
    keyword: "Switch 2",
    slug: "switch-2",
    category: "3C",
    products: groups.flatMap((group) => group.products),
    groups,
  });
  const html = renderKPage(grouped, TODAY);

  const sections = (source: string) =>
    [...source.matchAll(/<section class="group" data-kind="([a-z]+)">([\s\S]*?)<\/section>/g)].map((match) => ({
      kind: match[1],
      body: match[2],
    }));

  it("draws one list per shelf, each under its own heading", () => {
    const found = sections(html);
    expect(found.map((section) => section.kind)).toEqual(["main", "accessories"]);
    expect(found[0].body).toContain("<h2>主機</h2>");
    expect(found[1].body).toContain("<h2>配件與周邊</h2>");
    // A section holds exactly one ul, so the numbering restarts on each shelf.
    expect(found.every((section) => (section.body.match(/<ul class="list">/g) ?? []).length === 1)).toBe(true);
    expect((html.match(/<ul class="list">/g) ?? []).length).toBe(2);
  });

  it("puts the goods first and the add-ons after them", () => {
    expect(html.indexOf("Switch 2 主機 台灣公司貨")).toBeLessThan(html.indexOf("Switch 2 保護殼"));
    expect(html.indexOf("<h2>主機</h2>")).toBeLessThan(html.indexOf("<h2>配件與周邊</h2>"));
  });

  it("marks exactly one listing 最低價, the head of the first shelf", () => {
    expect((html.match(/class="best"/g) ?? []).length).toBe(1);
    // One badge for the page, on the cheapest of the goods — not repeated on
    // the add-ons, where a 290 元 case would otherwise out-shout the console.
    const [goods] = sections(html);
    expect(goods.body.slice(0, goods.body.indexOf("</li>"))).toContain("最低價");
    expect(html.slice(html.indexOf('data-kind="accessories"'))).not.toContain('class="best"');
  });

  it("prints no heading when there is only one shelf", () => {
    const single = renderKPage(
      data({
        groups: [{ kind: "main", title: "本體", products: [...data().products] }],
      }),
      TODAY,
    );
    expect(sections(single)).toHaveLength(1);
    expect(single).not.toContain("<h2>");
    expect(single).toContain('<ul class="list">');
  });

  it("counts every shelf in the copy but spans only the goods", () => {
    // 「共 3 筆」 is the search result count, so it keeps counting the case.
    // The range does not: a NT$290 case must not be what 「價格從」 opens with.
    expect(html).toContain("共 3 筆");
    expect(html).toContain("價格從 NT$15,880 到 NT$16,980");
    expect(html).not.toContain("價格從 NT$290");
    expect(kPageDescription(grouped)).toContain("共 3 筆");
    expect(kPageDescription(grouped)).toContain("NT$15,880 到 NT$16,980");
  });

  it("still spans every listing on a page that has only one shelf", () => {
    // 生活／食品 pages do not group, so there is no goods shelf to narrow to.
    const oneShelf = data({
      keyword: "棉被",
      slug: "mianbei",
      category: "生活",
      products: [product({ price: 890 }), product({ platform: "pchome", price: 2_480, url: "https://24h.pchome.com.tw/prod/2" })],
    });
    expect(kPageDescription(oneShelf)).toContain("NT$890 到 NT$2,480");
  });

  it("keeps the range on the goods when the copy is rendered from a snapshot", () => {
    // renderKPage rebuilds sections itself; the range must follow them, not
    // whatever order the flat list happens to be in.
    const flat = renderKPage(
      data({
        keyword: "iPhone 18 Pro",
        slug: "iphone-18-pro",
        category: "3C",
        products: [
          product({ title: "iPhone 18 Pro 保護貼 鏡頭膜", price: 280, url: "https://www.momoshop.com.tw/goods/2" }),
          product({ title: "iPhone 18 Pro 256GB 手機", price: 40_888 }),
          product({ title: "iPhone 18 Pro 512GB 手機", price: 48_900, url: "https://www.momoshop.com.tw/goods/3" }),
        ],
      }),
      TODAY,
    );
    expect(flat).toContain("價格從 NT$40,888 到 NT$48,900");
  });

  it("tells search engines about every shelf, not just the first", () => {
    const json = JSON.parse(html.slice(html.indexOf('<script type="application/ld+json">') + 35, html.indexOf("</script>"))) as {
      "@graph": Array<Record<string, unknown>>;
    };
    const list = json["@graph"].find((node) => node["@type"] === "ItemList") as { numberOfItems: number };
    const offer = json["@graph"].find((node) => node["@type"] === "Product") as { offers: Record<string, unknown> };
    expect(list.numberOfItems).toBe(3);
    expect(offer.offers).toMatchObject({ lowPrice: 290, highPrice: 16_980, offerCount: 3 });
  });

  it("builds the shelves itself when a caller only hands it a flat list", () => {
    // Archived snapshots predate groups; the page still gets its sections.
    const flat = renderKPage(
      data({
        keyword: "Switch 2",
        category: "3C",
        products: [
          product({ title: "Switch 2 主機 台灣公司貨", price: 15_880 }),
          product({ platform: "pchome", title: "Switch 2 保護殼", price: 290 }),
        ],
      }),
      TODAY,
    );
    expect(sections(flat).map((section) => section.kind)).toEqual(["main", "accessories"]);
    expect(flat).toContain("<h2>主機</h2>");
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
  const script = html.slice(html.indexOf('id="groups"'), html.lastIndexOf("</body>"));

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

  it("does not dim a page that arrived with products", () => {
    // 20 rows are already in the HTML. Dimming them to 45% and captioning them
    // 「正在取得最新價格…」 made a finished page look like it was still loading.
    expect(html).not.toContain('class="groups loading"');
    expect(script).not.toContain('class="groups loading"');
    expect(html).toContain('<div class="groups" id="groups"');
    // The line is not merely hidden here; it is not in the page at all.
    expect(html).not.toContain("正在取得最新價格…");
    expect(html).not.toContain('id="fresh"');
    // The script still knows how to dim — it just refuses to when items exist.
    expect(script).toContain('list.classList.add("loading")');
    expect(script).toContain("busy(true)");
    expect(script).toContain('"items":true');
  });

  it("still dims a page that arrived with nothing", () => {
    // The honest case: there is no list to protect, so the loading state is true.
    const empty = renderKPage(data({ products: [], platforms: [report("momo", "unavailable")] }), TODAY);
    expect(empty).toContain("正在取得最新價格…");
    expect(empty).toContain('class="groups loading"');
    expect(empty).toContain('<div class="groups loading" id="groups"');
    // Hidden in the markup and revealed by the script, so a reader with
    // scripting off never sees a loading message that never ends.
    expect(empty).toContain('id="fresh" role="status" aria-live="polite" hidden');
    expect(empty).toContain('"items":false');
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
    // A page with products no longer ships the loading class at all, so there is
    // nothing to fade; the rule is kept for the empty page, which still does.
    expect(html).toContain("<noscript><style>.groups.loading{opacity:1}</style></noscript>");
    // It must not un-hide [hidden] boxes: that would show "no products" over a real list.
    expect(html).not.toContain(".empty[hidden],ul.list[hidden]");
    // No loading line on this page, so nothing can stick when JS never runs.
    expect(html).not.toContain('id="fresh"');
  });
});

describe("overview page", () => {
  const html = renderKOverview(TODAY);

  it("lists every hot keyword, grouped, linking to its page", () => {
    // 標題的筆數跟著資料走：每週換關鍵字不必回來改測試。
    // 算的是「有自己比價頁」的關鍵字（overview 只列這些），不是資料檔全部。
    const total = hotOverviewItems().reduce((sum, group) => sum + group.items.length, 0);
    expect(html).toContain(`<title>熱門比價 — ${total} 個人氣商品關鍵字 — 比比猴</title>`);
    expect(html).toContain(`<link rel="canonical" href="${kOverviewUrl()}">`);
    for (const path of ["/k/chushiji/", "/k/iphone-18-pro/", "/k/switch-2/", "/k/luguakafei/"]) {
      expect(html).toContain(`href="${path}"`);
    }
    // 分類也跟著資料走：新增分類（例如之後的「節慶熱門」）不用改測試。
    const categories = groupHotKeywords(HOT_KEYWORDS).map((group) => group.category);
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) expect(html).toContain(`<h2>${category}</h2>`);
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
