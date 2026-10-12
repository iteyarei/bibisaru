import { afterEach, describe, expect, it } from "vitest";
import { AFFILIATE_ENABLED, applyAffiliate, SHOPEE_AFFILIATE_ID, shopeeAffiliateId, shopeeAffiliateUrl } from "../shared/affiliate";
import { platformSearchUrl } from "../shared/platforms";

function envBag(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) throw new Error("missing process.env");
  return proc.env;
}

const original = envBag().SHOPEE_AFFILIATE_ID;

afterEach(() => {
  if (original === undefined) delete envBag().SHOPEE_AFFILIATE_ID;
  else envBag().SHOPEE_AFFILIATE_ID = original;
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
