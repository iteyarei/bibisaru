import { afterEach, describe, expect, it } from "vitest";
import {
  AFFILIATE_ENABLED,
  applyAffiliate,
  COUPANG_AFFILIATE_ID,
  coupangAffiliateId,
  coupangAffiliateUrl,
  coupangSearchAffiliateUrl,
  SHOPEE_AFFILIATE_ID,
  shopeeAffiliateId,
  shopeeAffiliateUrl,
} from "../shared/affiliate";
import { platformSearchUrl, rawSearchUrl } from "../shared/platforms";
import { normalizeCoupang } from "../shared/normalize";

function envBag(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) throw new Error("missing process.env");
  return proc.env;
}

const originalShopee = envBag().SHOPEE_AFFILIATE_ID;
const originalCoupang = envBag().COUPANG_AFFILIATE_ID;

afterEach(() => {
  if (originalShopee === undefined) delete envBag().SHOPEE_AFFILIATE_ID;
  else envBag().SHOPEE_AFFILIATE_ID = originalShopee;
  if (originalCoupang === undefined) delete envBag().COUPANG_AFFILIATE_ID;
  else envBag().COUPANG_AFFILIATE_ID = originalCoupang;
});

describe("shopee affiliate redirect", () => {
  it("wraps a product url and leaves other shops alone", () => {
    expect(AFFILIATE_ENABLED).toBe(false);
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
    expect(platformSearchUrl("momo", "耳機")).toBe(`https://www.momoshop.com.tw/search/${encodeURIComponent("耳機")}`);
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
    expect(AFFILIATE_ENABLED).toBe(false);
    const raw = rawSearchUrl("coupang", "電鍋");
    expect(raw).toBe(`https://www.tw.coupang.com/np/search?q=${encodeURIComponent("電鍋")}`);
    expect(platformSearchUrl("coupang", "電鍋")).toBe(coupangSearchAffiliateUrl("電鍋"));
    expect(applyAffiliate(raw)).toBe(coupangSearchAffiliateUrl("電鍋"));
    expect(platformSearchUrl("momo", "電鍋")).toBe(`https://www.momoshop.com.tw/search/${encodeURIComponent("電鍋")}`);
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
