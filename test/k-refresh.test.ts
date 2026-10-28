import { describe, expect, it } from "vitest";
import { renderKPage, type KPageData } from "../shared/k-page";
import type { PlatformReport } from "../shared/types";

/**
 * The inline refresh is the part of the page that decides whether a reader sees
 * a two-year-old price or today's, so it is worth running rather than just
 * grepping. No DOM library: a stub just big enough for the script is injected.
 */

interface Stub {
  tag: string;
  className: string;
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  children: Stub[];
  classList: { add: (name: string) => void; remove: (name: string) => void; contains: (name: string) => boolean };
  appendChild: (child: Stub) => Stub;
  replaceChildren: (...children: Stub[]) => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener?: (type: string, handler: () => void) => void;
}

function element(id = "", tag = "div"): Stub {
  const classes = new Set<string>();
  const node: Stub = {
    tag,
    className: id === "groups" ? "groups loading" : "",
    textContent: id === "stamp" ? "價格為 2024/01/15 查詢，實際依各賣場為準" : "",
    hidden: id === "fresh",
    dataset: { snapshot: "2024/01/15" },
    attributes: {},
    children: [],
    classList: {
      add: (name) => {
        classes.add(name);
        node.className = [...classes].join(" ");
      },
      remove: (name) => {
        classes.delete(name);
        node.className = [...classes].join(" ");
      },
      contains: (name) => classes.has(name),
    },
    appendChild: (child) => {
      node.children.push(child);
      return child;
    },
    replaceChildren: (...children) => {
      // A real fragment is spliced in, not nested: imitate that.
      node.children = children.flatMap((child) => (child.className.includes("frag") ? child.children : [child]));
    },
    setAttribute: (name, value) => {
      node.attributes[name] = value;
    },
  };
  if (id === "groups") classes.add("groups"), classes.add("loading");
  return node;
}

/** Every listing on the page, across every section. */
function itemsOf(groups: Stub): Stub[] {
  return groups.children
    .flatMap((section) => section.children)
    .filter((child) => child.tag === "ul")
    .flatMap((list) => list.children);
}

/** The section headings the refresh drew, top to bottom. */
function headingsOf(groups: Stub): string[] {
  return groups.children
    .flatMap((section) => section.children)
    .filter((child) => child.tag === "h2")
    .map((child) => child.textContent);
}

/** One section, by the data-kind it was drawn with. */
function sectionOf(groups: Stub, kind: string): Stub | undefined {
  return groups.children.find((section) => section.attributes["data-kind"] === kind);
}

const report = (id: PlatformReport["id"], status: PlatformReport["status"]): PlatformReport => ({
  id,
  status,
  count: 0,
  searchUrl: "https://example.test",
});

function page(): KPageData {
  return {
    keyword: "Switch 2",
    slug: "switch-2",
    category: "3C",
    reason: "",
    products: [
      {
        platform: "momo",
        title: "存檔商品",
        price: 9_980,
        image: "",
        url: "https://www.momoshop.com.tw/goods/s",
        rank: 0,
      },
    ],
    platforms: [report("momo", "ok")],
    // A retired page: the prices are old on purpose.
    fetchedAt: new Date("2024-01-15T04:00:00Z"),
    archived: true,
  };
}

function scriptOf(html: string): string {
  const open = html.lastIndexOf("<script>");
  return html.slice(open + "<script>".length, html.lastIndexOf("</script>"));
}

interface Harness {
  list: Stub;
  stamp: Stub;
  fresh: Stub;
  fire: () => void;
  requested: string[];
}

function mount(script: string, reply: () => Promise<unknown>): Harness {
  const list = element("groups");
  const stamp = element("stamp");
  const fresh = element("fresh");
  const empty = element("empty");
  const byId: Record<string, Stub> = { groups: list, stamp, fresh, empty };
  const requested: string[] = [];
  let ready: (() => void) | null = null;

  const document = {
    readyState: "loading",
    addEventListener: (type: string, handler: () => void) => {
      if (type === "DOMContentLoaded") ready = handler;
    },
    getElementById: (id: string) => byId[id] ?? null,
    createElement: (tag: string) => element("", tag),
    createDocumentFragment: () => {
      const frag = element();
      frag.className = "frag";
      return frag;
    },
  };
  const fetch = (url: string) => {
    requested.push(url);
    return reply().then((body) => ({ ok: true, json: async () => body }));
  };

  new Function("document", "fetch", script)(document, fetch);
  return { list, stamp, fresh, fire: () => ready?.(), requested };
}

describe("the inline refresh draws the same shelves as the server", () => {
  /** A live answer, drawn by the script, read back section by section. */
  async function afterRefresh(keyword: string, category: string, results: unknown[]) {
    const source: KPageData = { ...page(), keyword, slug: "x", category, products: [] };
    const harness = mount(scriptOf(renderKPage(source)), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results,
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return harness.list;
  }

  it("puts a console in 主機 and its games and cases in 配件與周邊", async () => {
    const list = await afterRefresh("Switch 2", "3C", [
      { platform: "ruten", title: "Switch 2 保護殼 透明", price: 290, image: "", url: "https://www.ruten.com.tw/item/1" },
      { platform: "momo", title: "Switch 2 主機 台灣公司貨", price: 15_880, image: "", url: "https://www.momoshop.com.tw/goods/1" },
      { platform: "pchome", title: "Switch 2 薩爾達傳說 中文版", price: 1_620, image: "", url: "https://24h.pchome.com.tw/prod/1" },
    ]);

    expect(headingsOf(list)).toEqual(["主機", "配件與周邊"]);
    const goods = sectionOf(list, "main");
    const addOns = sectionOf(list, "accessories");
    expect(goods).toBeDefined();
    expect(addOns).toBeDefined();
    expect(JSON.stringify(goods)).toContain("Switch 2 主機 台灣公司貨");
    expect(JSON.stringify(goods)).not.toContain("保護殼");
    expect(JSON.stringify(addOns)).toContain("保護殼");
    expect(JSON.stringify(addOns)).toContain("薩爾達傳說");
  });

  it("never lets a cheap case push the console off its own shelf", async () => {
    const cases = Array.from({ length: 12 }, (_, i) => ({
      platform: "ruten",
      title: `Switch 2 保護殼 第${i + 1}款`,
      price: 100 + i,
      image: "",
      url: `https://www.ruten.com.tw/item/${i}`,
    }));
    const list = await afterRefresh("Switch 2", "3C", [
      ...cases,
      { platform: "momo", title: "Switch 2 主機 台灣公司貨", price: 15_880, image: "", url: "https://www.momoshop.com.tw/goods/1" },
    ]);
    const goods = JSON.stringify(sectionOf(list, "main"));
    expect(goods).toContain("主機 台灣公司貨");
    // 12 cases, and the shelf holds 8: the rest are dropped, not promoted.
    expect(sectionOf(list, "accessories")?.children).toBeDefined();
    expect(itemsOf(list)).toHaveLength(1 + 8);
  });

  it("drops a shower head from a 熱水器 refresh", async () => {
    const list = await afterRefresh("熱水器", "家電", [
      { platform: "ruten", title: "增壓花灑 蓮蓬頭 熱水器洗澡", price: 399, image: "", url: "https://www.ruten.com.tw/item/1" },
      { platform: "momo", title: "電熱水器 12加侖 直掛式", price: 8_400, image: "", url: "https://www.momoshop.com.tw/goods/1" },
    ]);
    const all = JSON.stringify(itemsOf(list));
    expect(all).toContain("電熱水器");
    expect(all).not.toContain("花灑");
    expect(headingsOf(list)).toEqual([]);
  });

  it("gives a 電熱毯 熱敷墊 its own shelf and drops the cat bed", async () => {
    const list = await afterRefresh("電熱毯", "家電", [
      { platform: "momo", title: "電熱毯 雙人 法蘭絨", price: 1_200, image: "", url: "https://www.momoshop.com.tw/goods/1" },
      { platform: "pchome", title: "電熱毯 熱敷墊 暖宮 恆溫", price: 690, image: "", url: "https://24h.pchome.com.tw/prod/1" },
      { platform: "ruten", title: "寵物電熱毯 貓窩 加熱墊", price: 399, image: "", url: "https://www.ruten.com.tw/item/1" },
    ]);
    expect(headingsOf(list)).toEqual(["本體", "熱敷用品"]);
    const all = JSON.stringify(itemsOf(list));
    expect(all).not.toContain("貓窩");
    expect(JSON.stringify(sectionOf(list, "heat"))).toContain("熱敷墊");
    expect(JSON.stringify(sectionOf(list, "main"))).toContain("法蘭絨");
  });

  it("draws the same shelves the server does for the misses it just fixed", async () => {
    // The browser rule is a second copy of the server rule, so the two can drift
    // apart without a single server test noticing. These are the titles that
    // were misread: a machine behind its own filter bracket, a freebie powder,
    // and a console bundle.
    const list = await afterRefresh("除濕機", "家電", [
      {
        platform: "momo",
        title: "【SAMPO 聲寶】6L一級能效除濕機｜大水箱・甲殼素濾網・乾衣模式(AD-WB512T)",
        price: 4_890,
        image: "",
        url: "https://www.momoshop.com.tw/goods/1",
      },
      { platform: "pchome", title: "SAMPO 除濕機 專用 替換濾網", price: 590, image: "", url: "https://24h.pchome.com.tw/prod/1" },
    ]);
    expect(headingsOf(list)).toEqual(["本體", "配件與周邊"]);
    expect(JSON.stringify(sectionOf(list, "main"))).toContain("一級能效除濕機");
    expect(JSON.stringify(sectionOf(list, "accessories"))).toContain("替換濾網");

    const console = await afterRefresh("Switch 2", "3C", [
      {
        platform: "momo",
        title: "【Nintendo 任天堂】Switch 2 薩爾達40周年特仕版機+《NS2寶可夢傳說 Z-A》+《Joy-con 2》",
        price: 20_788,
        image: "",
        url: "https://www.momoshop.com.tw/goods/2",
      },
      {
        platform: "pchome",
        title: "【Nintendo 任天堂】NS2 Nintendo Switch 運動 度假勝地(台灣公司貨)",
        price: 1_580,
        image: "",
        url: "https://24h.pchome.com.tw/prod/2",
      },
    ]);
    expect(JSON.stringify(sectionOf(console, "main"))).toContain("特仕版機");
    expect(JSON.stringify(sectionOf(console, "accessories"))).toContain("度假勝地");
  });

  it("prints one headingless list when a 生活 page has nothing to split", async () => {
    const list = await afterRefresh("棉被", "生活", [
      { platform: "momo", title: "棉被 雙人 冬被", price: 1_290, image: "", url: "https://www.momoshop.com.tw/goods/1" },
      { platform: "pchome", title: "棉被 保護套 單人", price: 390, image: "", url: "https://24h.pchome.com.tw/prod/1" },
    ]);
    expect(headingsOf(list)).toEqual([]);
    // No shelf rules at all here: the case stays, because a 棉被 套 is still
    // something a 棉被 page can show in one list.
    expect(itemsOf(list)).toHaveLength(2);
  });

  it("marks only the head of the first shelf 最低價", async () => {
    const list = await afterRefresh("Switch 2", "3C", [
      { platform: "ruten", title: "Switch 2 保護殼 透明", price: 290, image: "", url: "https://www.ruten.com.tw/item/1" },
      { platform: "momo", title: "Switch 2 主機 台灣公司貨", price: 15_880, image: "", url: "https://www.momoshop.com.tw/goods/1" },
    ]);
    const marked = itemsOf(list).filter((item) => JSON.stringify(item).includes("最低價"));
    expect(marked).toHaveLength(1);
    expect(JSON.stringify(marked[0])).toContain("15,880");
  });

  it("keeps the storefront order: goods, then add-ons", async () => {
    const list = await afterRefresh("Switch 2", "3C", [
      { platform: "ruten", title: "Switch 2 保護殼 透明", price: 290, image: "", url: "https://www.ruten.com.tw/item/1" },
      { platform: "momo", title: "Switch 2 主機 台灣公司貨", price: 15_880, image: "", url: "https://www.momoshop.com.tw/goods/1" },
    ]);
    expect(list.children.map((section) => section.attributes["data-kind"])).toEqual(["main", "accessories"]);
  });
});

describe("the inline refresh, actually run", () => {
  it("waits for DOMContentLoaded, then asks /api/search once", async () => {
    const harness = mount(scriptOf(renderKPage(page())), async () => ({ results: [] }));
    expect(harness.requested).toHaveLength(0);
    harness.fire();
    expect(harness.requested).toHaveLength(1);
    expect(harness.requested[0]).toContain("/api/search?q=Switch%202");
    // It shows the loading state right away, before any answer arrives.
    expect(harness.fresh.hidden).toBe(false);
    expect(harness.list.classList.contains("loading")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("replaces the snapshot prices and the query time with the live ones", async () => {
    const harness = mount(scriptOf(renderKPage(page())), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results: [
        { platform: "pchome", title: "Switch 2 主機 即時商品", price: 4_490, image: "https://img.test/a.jpg", url: "https://24h.pchome.com.tw/prod/1" },
        { platform: "momo", title: "Switch 2 次便宜 主機", price: 9_980, image: "", url: "https://www.momoshop.com.tw/goods/2" },
      ],
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The visible list is now the live one, cheapest first.
    const items = itemsOf(harness.list);
    expect(items).toHaveLength(2);
    const first = JSON.stringify(items[0]);
    expect(first).toContain("NT$4,490");
    expect(first).toContain("Switch 2 主機 即時商品");
    // The date line is the real fetch time, not the 2024 snapshot.
    expect(harness.stamp.textContent).toBe("價格為 2026/10/28 查詢，實際依各賣場為準");
    expect(harness.stamp.textContent).not.toContain("2024");
    expect(harness.stamp.classList.contains("idle")).toBe(false);
    // Loading is over.
    expect(harness.fresh.hidden).toBe(true);
    expect(harness.list.classList.contains("loading")).toBe(false);
  });

  it("keeps the snapshot and says how old it is when the fetch fails", async () => {
    const harness = mount(scriptOf(renderKPage(page())), async () => {
      throw new Error("offline");
    });
    const before = itemsOf(harness.list).length;
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // An older-than-this-year snapshot keeps its year, so nobody misreads it as recent.
    expect(harness.stamp.textContent).toBe("目前無法取得最新價格，以下為 2024 年 1 月 15 日資料");
    expect(harness.stamp.hidden).toBe(false);
    expect(harness.stamp.classList.contains("idle")).toBe(true);
    // The server-rendered list is untouched: stale beats blank.
    expect(itemsOf(harness.list)).toHaveLength(before);
    expect(harness.fresh.hidden).toBe(true);
    expect(harness.list.classList.contains("loading")).toBe(false);
  });

  it("treats an empty or malformed answer as a failure, not as 'no products'", async () => {
    const harness = mount(scriptOf(renderKPage(page())), async () => ({ results: [] }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.stamp.textContent).toContain("目前無法取得最新價格");
    expect(harness.stamp.classList.contains("idle")).toBe(true);
  });

  it("drops live rows whose title does not carry the keyword", async () => {
    const harness = mount(scriptOf(renderKPage(page())), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results: [
        { platform: "momo", title: "Switch 保護貼 滿版", price: 190, image: "", url: "https://www.momoshop.com.tw/goods/1" },
        { platform: "pchome", title: "Switch 2 主機", price: 15_880, image: "", url: "https://24h.pchome.com.tw/prod/1" },
      ],
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = itemsOf(harness.list);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items[0])).toContain("NT$15,880");
    expect(harness.stamp.classList.contains("idle")).toBe(false);
  });

  it("keeps the live list spread across shops instead of one shop's cheap rows", async () => {
    const ruten = Array.from({ length: 10 }, (_, i) => ({
      platform: "ruten",
      title: `Switch 2 主機 福利品 ${i + 1}`,
      price: 100 + i,
      image: "",
      url: `https://www.ruten.com.tw/item/${i}`,
    }));
    const harness = mount(scriptOf(renderKPage(page())), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results: [...ruten, { platform: "momo", title: "Switch 2 主機", price: 15_880, image: "", url: "https://www.momoshop.com.tw/goods/9" }],
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = itemsOf(harness.list);
    expect(items).toHaveLength(11);
    const shops = items.map((child) => JSON.stringify(child));
    expect(shops.some((html) => html.includes('"textContent":"momo"'))).toBe(true);
    expect(shops.some((html) => html.includes('"textContent":"露天"'))).toBe(true);
  });

  it("keeps an off-keyword row out of a live refresh", async () => {
    const appliance: KPageData = { ...page(), keyword: "除濕機", slug: "chushiji", category: "家電" };
    const harness = mount(scriptOf(renderKPage(appliance)), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results: [
        { platform: "pchome", title: "除濕 專用 濾網 副廠", price: 350, image: "", url: "https://24h.pchome.com.tw/prod/A1" },
        { platform: "momo", title: "除濕機 12L", price: 3_990, image: "", url: "https://www.momoshop.com.tw/goods/1" },
      ],
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = itemsOf(harness.list);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items[0])).toContain('"textContent":"momo"');
  });

  it("never blocks the reader: the snapshot is visible before the fetch resolves", () => {
    const html = renderKPage(page());
    expect(html).toContain("存檔商品");
    expect(html).toContain("NT$9,980");
    expect(html).toContain("價格為 2024/01/15 查詢");
  });
});
