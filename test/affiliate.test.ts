import { afterEach, describe, expect, it } from "vitest";
import {
  applyAffiliate,
  COUPANG_AFFILIATE_ID,
  coupangAffiliateId,
  coupangAffiliateUrl,
  coupangSearchAffiliateUrl,
  ICHANNELS_K,
  ichannelsAffiliateUrl,
  ichannelsK,
  SHOPEE_AFFILIATE_ID,
  shopeeAffiliateId,
  shopeeAffiliateUrl,
} from "../shared/affiliate";
import { PLATFORM_IDS, platformSearchUrl, rawSearchUrl } from "../shared/platforms";
import { normalizeCoupang } from "../shared/normalize";

function envBag(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) throw new Error("missing process.env");
  return proc.env;
}

const originalShopee = envBag().SHOPEE_AFFILIATE_ID;
const originalCoupang = envBag().COUPANG_AFFILIATE_ID;
const originalIchannels = envBag().ICHANNELS_K;

afterEach(() => {
  if (originalIchannels === undefined) delete envBag().ICHANNELS_K;
  else envBag().ICHANNELS_K = originalIchannels;
  if (originalShopee === undefined) delete envBag().SHOPEE_AFFILIATE_ID;
  else envBag().SHOPEE_AFFILIATE_ID = originalShopee;
  if (originalCoupang === undefined) delete envBag().COUPANG_AFFILIATE_ID;
  else envBag().COUPANG_AFFILIATE_ID = originalCoupang;
});

describe("shopee affiliate redirect", () => {
  it("wraps a product url and leaves other shops alone", () => {
    const product = "https://shopee.tw/-i.7.42";
    const wrapped = applyAffiliate(product);
    const url = new URL(wrapped);
    expect(url.origin + url.pathname).toBe("https://s.shopee.tw/an_redir");
    expect(url.searchParams.get("origin_link")).toBe(product);
    expect(url.searchParams.get("affiliate_id")).toBe(SHOPEE_AFFILIATE_ID);
    expect(url.searchParams.get("sub_id")).toBe("bibisaru");
    expect(applyAffiliate("https://24h.pchome.com.tw/prod/ABC")).toBe("https://24h.pchome.com.tw/prod/ABC");
  });

  it("encodes a Chinese search keyword inside origin_link", () => {
    const raw = platformSearchUrl("shopee", "耳機");
    const url = new URL(raw);
    const origin = url.searchParams.get("origin_link");
    expect(origin).toBe(`https://shopee.tw/search?keyword=${encodeURIComponent("耳機")}`);
    expect(raw).toContain(encodeURIComponent(encodeURIComponent("耳機")));
    expect(url.searchParams.get("affiliate_id")).toBe("16330620037");
    expect(platformSearchUrl("pchome", "耳機")).toBe(rawSearchUrl("pchome", "耳機"));
  });

  it("reads SHOPEE_AFFILIATE_ID from the environment", () => {
    envBag().SHOPEE_AFFILIATE_ID = "999";
    expect(shopeeAffiliateId()).toBe("999");
    const wrapped = shopeeAffiliateUrl("https://shopee.tw/-i.1.2");
    expect(new URL(wrapped).searchParams.get("affiliate_id")).toBe("999");
    envBag().SHOPEE_AFFILIATE_ID = "  ";
    expect(shopeeAffiliateId()).toBe(SHOPEE_AFFILIATE_ID);
  });

  it("does not wrap a link that is already an affiliate redirect", () => {
    const once = shopeeAffiliateUrl("https://shopee.tw/-i.1.2");
    expect(shopeeAffiliateUrl(once)).toBe(once);
  });
});

describe("coupang affiliate redirect", () => {
  it("builds the partners search link without traceid", () => {
    const link = coupangSearchAffiliateUrl("電鍋");
    expect(link).toBe(
      `https://link.tw.coupang.com/re2/AFFKOLSRP?lptag=${COUPANG_AFFILIATE_ID}&pageKey=${encodeURIComponent("電鍋")}`,
    );
    const url = new URL(link);
    expect(url.searchParams.get("lptag")).toBe("AF6766993");
    expect(url.searchParams.get("pageKey")).toBe("電鍋");
    expect(url.searchParams.has("traceid")).toBe(false);
  });

  it("wraps the 前往搜尋 link and leaves the fetch url as the original query", () => {
    const raw = rawSearchUrl("coupang", "電鍋");
    expect(raw).toBe(`https://www.tw.coupang.com/np/search?q=${encodeURIComponent("電鍋")}`);
    expect(platformSearchUrl("coupang", "電鍋")).toBe(coupangSearchAffiliateUrl("電鍋"));
    expect(applyAffiliate(raw)).toBe(coupangSearchAffiliateUrl("電鍋"));
    expect(platformSearchUrl("pchome", "電鍋")).toBe(rawSearchUrl("pchome", "電鍋"));
  });

  it("wraps a scraped product link and keeps item ids", () => {
    const product = "https://www.tw.coupang.com/products/apple-airpods-1234567890?itemId=55&vendorItemId=77&q=%E9%9B%BB%E9%8D%8B";
    const wrapped = applyAffiliate(product);
    const url = new URL(wrapped);
    expect(url.origin + url.pathname).toBe("https://link.tw.coupang.com/re2/AFFSDP");
    expect(url.searchParams.get("lptag")).toBe(COUPANG_AFFILIATE_ID);
    expect(url.searchParams.get("pageKey")).toBe("1234567890");
    expect(url.searchParams.get("itemId")).toBe("55");
    expect(url.searchParams.get("vendorItemId")).toBe("77");
    expect(url.searchParams.has("traceid")).toBe(false);
    expect(url.searchParams.has("q")).toBe(false);

    const html = `
      <ul id="product-list">
        <li class="ProductUnit_productUnit__abc">
          <a href="/products/earbuds-1?itemId=2&amp;q=%E9%9B%BB%E9%8D%8B">
            <div class="ProductUnit_productNameV2__x">電鍋</div>
            <span translate="no">$539</span>
          </a>
        </li>
      </ul>`;
    const parsed = new URL(normalizeCoupang(html)[0]?.url ?? "");
    expect(parsed.origin + parsed.pathname).toBe("https://link.tw.coupang.com/re2/AFFSDP");
    expect(parsed.searchParams.get("pageKey")).toBe("earbuds-1");
    expect(parsed.searchParams.get("itemId")).toBe("2");
    expect(parsed.searchParams.get("lptag")).toBe(COUPANG_AFFILIATE_ID);
  });

  it("reads COUPANG_AFFILIATE_ID from the environment", () => {
    envBag().COUPANG_AFFILIATE_ID = "AF0001";
    expect(coupangAffiliateId()).toBe("AF0001");
    const wrapped = coupangAffiliateUrl("https://www.tw.coupang.com/np/search?q=%E9%9B%BB%E9%8D%8B");
    expect(new URL(wrapped).searchParams.get("lptag")).toBe("AF0001");
    expect(wrapped).toContain(`pageKey=${encodeURIComponent("電鍋")}`);
    envBag().COUPANG_AFFILIATE_ID = "  ";
    expect(coupangAffiliateId()).toBe(COUPANG_AFFILIATE_ID);
  });

  it("does not wrap a link that is already a partners redirect", () => {
    const once = coupangSearchAffiliateUrl("電鍋");
    expect(coupangAffiliateUrl(once)).toBe(once);
    expect(applyAffiliate(once)).toBe(once);
  });
});

function ichannels(url: string): string {
  return `https://product.mchannles.com/redirect_wa.php?k=2IsZi&uid1=bibisaru&tourl=${encodeURIComponent(url)}`;
}

describe("通路王 Deep Link", () => {
  const cases: Array<[string, string]> = [
    ["momo", "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=14040053&Area=search"],
    ["Yahoo 奇摩購物中心", "https://tw.buy.yahoo.com/gdsale/airpods-11986319.html"],
    ["金石堂", "https://www.kingstone.com.tw/basic/3030000102785/"],
    ["樂天", "https://www.rakuten.com.tw/shop/polywell/product/f88b3l6sa/"],
  ];

  it.each(cases)("wraps %s and encodes tourl", (_name, url) => {
    const wrapped = applyAffiliate(url);
    expect(wrapped).toBe(ichannels(url));
    const parsed = new URL(wrapped);
    expect(parsed.origin + parsed.pathname).toBe("https://product.mchannles.com/redirect_wa.php");
    expect(parsed.searchParams.get("k")).toBe(ICHANNELS_K);
    expect(parsed.searchParams.get("uid1")).toBe("bibisaru");
    expect(parsed.searchParams.get("tourl")).toBe(url);
  });

  it("also covers subdomains and Chinese search keywords", () => {
    const mobile = "https://m.momoshop.com.tw/search.momo?searchKeyword=%E8%80%B3%E6%A9%9F";
    expect(applyAffiliate(mobile)).toBe(ichannels(mobile));
    const search = `https://www.kingstone.com.tw/search/key/${encodeURIComponent("東野圭吾")}`;
    expect(new URL(applyAffiliate(search)).searchParams.get("tourl")).toBe(search);
    expect(applyAffiliate(search)).toContain(encodeURIComponent(encodeURIComponent("東野圭吾")));
  });

  it("does not wrap twice", () => {
    const once = ichannels("https://www.rakuten.com.tw/search/%E8%80%B3%E6%A9%9F/");
    expect(applyAffiliate(once)).toBe(once);
    expect(ichannelsAffiliateUrl(once)).toBe(once);
  });

  it("leaves other shops, http links, look-alike hosts, and bad urls alone", () => {
    for (const url of [
      "https://24h.pchome.com.tw/prod/ABC",
      "https://pxbox.es.pxmart.com.tw/product/1",
      "https://www.sanmin.com.tw/product/index/004113511",
      "https://www.etmall.com.tw/i/7926508",
      "https://www.ruten.com.tw/item/22324948234766/",
      "http://www.momoshop.com.tw/goods/1",
      "https://evilmomoshop.com.tw/goods/1",
      "https://www.momoshop.com.tw.evil.example/goods/1",
      "not a url",
    ]) {
      expect(applyAffiliate(url)).toBe(url);
    }
  });

  it("keeps Shopee and Coupang on their own programs", () => {
    expect(applyAffiliate("https://shopee.tw/-i.7.42")).toBe(shopeeAffiliateUrl("https://shopee.tw/-i.7.42"));
    expect(applyAffiliate("https://shopee.tw/-i.7.42")).not.toContain("mchannles");
    expect(applyAffiliate(rawSearchUrl("coupang", "電鍋"))).toBe(coupangSearchAffiliateUrl("電鍋"));
  });

  it("wraps visitor search links only for the four shops", () => {
    for (const id of ["momo", "yahoo", "kingstone", "rakuten"] as const) {
      expect(platformSearchUrl(id, "耳機"), id).toBe(ichannels(rawSearchUrl(id, "耳機")));
    }
    for (const id of ["pchome", "pxgo", "etmall", "sanmin", "ruten"] as const) {
      expect(platformSearchUrl(id, "耳機"), id).toBe(rawSearchUrl(id, "耳機"));
    }
  });

  it("never puts the affiliate redirect into the url the server fetches", () => {
    for (const id of PLATFORM_IDS) expect(rawSearchUrl(id, "耳機"), id).not.toContain("mchannles");
  });

  it("reads ICHANNELS_K from the environment", () => {
    envBag().ICHANNELS_K = "TESTK";
    expect(ichannelsK()).toBe("TESTK");
    expect(new URL(applyAffiliate("https://www.momoshop.com.tw/goods/1")).searchParams.get("k")).toBe("TESTK");
    envBag().ICHANNELS_K = "  ";
    expect(ichannelsK()).toBe(ICHANNELS_K);
  });
});
