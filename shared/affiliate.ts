/**
 * Outbound affiliate wrapping lives here.
 * Shopee and Coupang links are rewritten with their own programs.
 * momo, Yahoo 奇摩購物中心, 金石堂 and 樂天 go through the 通路王 Deep Link.
 * Every other shop stays unchanged.
 * Only links the visitor clicks are wrapped. Server fetches use `rawSearchUrl`.
 */

/** Default Shopee affiliate id. Override with the SHOPEE_AFFILIATE_ID environment variable. */
export const SHOPEE_AFFILIATE_ID = "16330620037";

export const SHOPEE_SUB_ID = "bibisaru";

/** Default Coupang Partners id. Override with the COUPANG_AFFILIATE_ID environment variable. */
export const COUPANG_AFFILIATE_ID = "AF6766993";

/**
 * 通路王 Deep Link. The k value is a public campaign number, not a secret.
 * Override it with the ICHANNELS_K environment variable.
 */
export const ICHANNELS_K = "2IsZi";

/** Performance tag shown in the 通路王 dashboard. */
export const ICHANNELS_UID1 = "bibisaru";

const ICHANNELS_REDIRECT_HOST = "product.mchannles.com";
const ICHANNELS_REDIRECT_PATH = "/redirect_wa.php";

const SHOPEE_HOST = /(^|\.)shopee\.tw$/i;
const COUPANG_HOST = /(^|\.)coupang\.com$/i;

/** Shops that 通路王 pays for: momo, Yahoo 奇摩購物中心, 金石堂, 樂天. */
const ICHANNELS_HOSTS: readonly RegExp[] = [
  /(^|\.)momoshop\.com\.tw$/i,
  /(^|\.)tw\.buy\.yahoo\.com$/i,
  /(^|\.)kingstone\.com\.tw$/i,
  /(^|\.)rakuten\.com\.tw$/i,
];

function envValue(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name]?.trim() || undefined;
}

export function ichannelsK(): string {
  return envValue("ICHANNELS_K") || ICHANNELS_K;
}

export function shopeeAffiliateId(): string {
  return envValue("SHOPEE_AFFILIATE_ID") || SHOPEE_AFFILIATE_ID;
}

export function coupangAffiliateId(): string {
  return envValue("COUPANG_AFFILIATE_ID") || COUPANG_AFFILIATE_ID;
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

/**
 * Coupang Partners search link. `pageKey` is the original keyword.
 * `traceid` is omitted; Coupang adds one when the redirect runs.
 */
export function coupangSearchAffiliateUrl(query: string, affiliateId = coupangAffiliateId()): string {
  const id = affiliateId.trim() || COUPANG_AFFILIATE_ID;
  return `https://link.tw.coupang.com/re2/AFFKOLSRP?lptag=${encodeURIComponent(id)}&pageKey=${encodeURIComponent(query)}`;
}

function coupangProductKey(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const at = parts.lastIndexOf("products");
  const slug = at >= 0 ? parts[at + 1] : undefined;
  if (!slug) return null;
  const decoded = decodeURIComponent(slug);
  const numeric = /(?:^|-)(\d{5,})$/.exec(decoded);
  return numeric?.[1] ?? decoded;
}

/** Product deep link. A numeric id at the end of the slug becomes `pageKey`. */
function coupangProductAffiliateUrl(parsed: URL, affiliateId: string): string | null {
  const pageKey = coupangProductKey(parsed.pathname);
  if (!pageKey) return null;
  const pairs = [
    ["lptag", affiliateId],
    ["pageKey", pageKey],
  ];
  for (const name of ["itemId", "vendorItemId"] as const) {
    const value = parsed.searchParams.get(name)?.trim();
    if (value) pairs.push([name, value]);
  }
  const query = pairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  return `https://link.tw.coupang.com/re2/AFFSDP?${query}`;
}

/**
 * Coupang search pages become the Partners search link.
 * Product pages become a product deep link when the path has a product id.
 * Links that are already on link.tw.coupang.com pass through.
 */
export function coupangAffiliateUrl(url: string, affiliateId = coupangAffiliateId()): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:") return url;
  if (parsed.hostname === "link.tw.coupang.com" && parsed.pathname.startsWith("/re2/")) return url;
  if (!COUPANG_HOST.test(parsed.hostname)) return url;
  const id = affiliateId.trim() || COUPANG_AFFILIATE_ID;
  if (parsed.pathname === "/np/search" || parsed.pathname === "/np/search/") {
    const query = parsed.searchParams.get("q") ?? "";
    if (!query) return url;
    return coupangSearchAffiliateUrl(query, id);
  }
  return coupangProductAffiliateUrl(parsed, id) ?? url;
}

/**
 * 通路王 Deep Link for momo, Yahoo 奇摩購物中心, 金石堂 and 樂天.
 * Other hosts, http links, and links that already go through product.mchannles.com pass through.
 */
export function ichannelsAffiliateUrl(url: string, k = ichannelsK()): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:") return url;
  if (parsed.hostname === ICHANNELS_REDIRECT_HOST && parsed.pathname === ICHANNELS_REDIRECT_PATH) return url;
  if (!ICHANNELS_HOSTS.some((host) => host.test(parsed.hostname))) return url;
  const key = k.trim() || ICHANNELS_K;
  return `https://${ICHANNELS_REDIRECT_HOST}${ICHANNELS_REDIRECT_PATH}?k=${encodeURIComponent(key)}&uid1=${encodeURIComponent(ICHANNELS_UID1)}&tourl=${encodeURIComponent(url)}`;
}

export function applyAffiliate(url: string): string {
  const shopee = shopeeAffiliateUrl(url);
  if (shopee !== url) return shopee;
  const coupang = coupangAffiliateUrl(url);
  if (coupang !== url) return coupang;
  return ichannelsAffiliateUrl(url);
}
