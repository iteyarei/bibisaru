/**
 * v1 stays free of affiliate parameters on every shop except Shopee.
 * Shopee outbound links use the official redirect. Keep `AFFILIATE_ENABLED`
 * false so `applyAffiliate` does not rewrite any other host.
 */
export const AFFILIATE_ENABLED = false;

/** Default Shopee affiliate id. Override with the SHOPEE_AFFILIATE_ID environment variable. */
export const SHOPEE_AFFILIATE_ID = "16330620037";

export const SHOPEE_SUB_ID = "bibisaru";

const SHOPEE_HOST = /(^|\.)shopee\.tw$/i;

function envAffiliateId(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.SHOPEE_AFFILIATE_ID?.trim() || undefined;
}

export function shopeeAffiliateId(): string {
  return envAffiliateId() || SHOPEE_AFFILIATE_ID;
}

/** Official Shopee affiliate redirect. Other hosts, and links that are already redirects, pass through. */
export function shopeeAffiliateUrl(url: string, affiliateId = shopeeAffiliateId()): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" || !SHOPEE_HOST.test(parsed.hostname)) return url;
  if (parsed.hostname === "s.shopee.tw" && parsed.pathname === "/an_redir") return url;
  const id = affiliateId.trim() || SHOPEE_AFFILIATE_ID;
  return `https://s.shopee.tw/an_redir?origin_link=${encodeURIComponent(url)}&affiliate_id=${encodeURIComponent(id)}&sub_id=${encodeURIComponent(SHOPEE_SUB_ID)}`;
}

export function applyAffiliate(url: string): string {
  const shopee = shopeeAffiliateUrl(url);
  if (shopee !== url) return shopee;
  if (!AFFILIATE_ENABLED) return url;
  return url;
}
