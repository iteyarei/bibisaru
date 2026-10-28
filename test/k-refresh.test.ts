import { describe, expect, it } from "vitest";
import { renderKPage, type KPageData } from "../shared/k-page";
import type { PlatformReport } from "../shared/types";

/**
 * The inline refresh is the part of the page that decides whether a reader sees
 * a two-year-old price or today's, so it is worth running rather than just
 * grepping. No DOM library: a stub just big enough for the script is injected.
 */

interface Stub {
  className: string;
  textContent: string;
  hidden: boolean;
  dataset: Record<string, string>;
  children: Stub[];
  classList: { add: (name: string) => void; remove: (name: string) => void; contains: (name: string) => boolean };
  appendChild: (child: Stub) => Stub;
  replaceChildren: (...children: Stub[]) => void;
  addEventListener?: (type: string, handler: () => void) => void;
}

function element(id = ""): Stub {
  const classes = new Set<string>();
  const node: Stub = {
    className: id === "list" ? "list loading" : "",
    textContent: id === "stamp" ? "價格為 2024/01/15 查詢，實際依各賣場為準" : "",
    hidden: id === "fresh",
    dataset: { snapshot: "2024/01/15" },
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
  };
  if (id === "list") classes.add("list"), classes.add("loading");
  return node;
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
  const list = element("list");
  const stamp = element("stamp");
  const fresh = element("fresh");
  const empty = element("empty");
  const byId: Record<string, Stub> = { list, stamp, fresh, empty };
  const requested: string[] = [];
  let ready: (() => void) | null = null;

  const document = {
    readyState: "loading",
    addEventListener: (type: string, handler: () => void) => {
      if (type === "DOMContentLoaded") ready = handler;
    },
    getElementById: (id: string) => byId[id] ?? null,
    createElement: () => element(),
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
    expect(harness.list.children).toHaveLength(2);
    const first = JSON.stringify(harness.list.children[0]);
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
    const before = harness.list.children.length;
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // An older-than-this-year snapshot keeps its year, so nobody misreads it as recent.
    expect(harness.stamp.textContent).toBe("目前無法取得最新價格，以下為 2024 年 1 月 15 日資料");
    expect(harness.stamp.hidden).toBe(false);
    expect(harness.stamp.classList.contains("idle")).toBe(true);
    // The server-rendered list is untouched: stale beats blank.
    expect(harness.list.children).toHaveLength(before);
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

    expect(harness.list.children).toHaveLength(1);
    expect(JSON.stringify(harness.list.children[0])).toContain("NT$15,880");
    expect(harness.stamp.classList.contains("idle")).toBe(false);
  });

  it("keeps the live list spread across shops instead of one shop's cheap rows", async () => {
    const ruten = Array.from({ length: 10 }, (_, i) => ({
      platform: "ruten",
      title: `Switch 2 福利品 ${i + 1}`,
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

    expect(harness.list.children).toHaveLength(11);
    const shops = harness.list.children.map((child) => JSON.stringify(child));
    expect(shops.some((html) => html.includes('"textContent":"momo"'))).toBe(true);
    expect(shops.some((html) => html.includes('"textContent":"露天"'))).toBe(true);
  });

  it("keeps the bookstore out of an appliance page", async () => {
    const appliance: KPageData = { ...page(), keyword: "除濕機", slug: "chushiji", category: "家電" };
    const harness = mount(scriptOf(renderKPage(appliance)), async () => ({
      fetchedAt: "2026-10-28T04:00:00.000Z",
      results: [
        { platform: "kingstone", title: "除濕機 維修 全圖解", price: 350, image: "", url: "https://www.kingstone.com.tw/book/1" },
        { platform: "momo", title: "除濕機 12L", price: 3_990, image: "", url: "https://www.momoshop.com.tw/goods/1" },
      ],
    }));
    harness.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.list.children).toHaveLength(1);
    expect(JSON.stringify(harness.list.children[0])).toContain('"textContent":"momo"');
  });

  it("never blocks the reader: the snapshot is visible before the fetch resolves", () => {
    const html = renderKPage(page());
    expect(html).toContain("存檔商品");
    expect(html).toContain("NT$9,980");
    expect(html).toContain("價格為 2024/01/15 查詢");
  });
});
