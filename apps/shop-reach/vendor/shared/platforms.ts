import { applyAffiliate } from "./affiliate";
import type { PlatformId } from "./types";

export const PLATFORM_IDS = [
  "momo",
  "pchome",
  "yahoo",
  "coupang",
  "shopee",
  "pxgo",
  "etmall",
  "rakuten",
  "ruten",
] as const;

export const MAX_PER_PLATFORM = 24;

export interface PlatformMeta {
  id: PlatformId;
  name: string;
  color: string;
}

export const PLATFORMS: readonly PlatformMeta[] = [
  { id: "momo", name: "momo", color: "#D6177A" },
  { id: "pchome", name: "PChome", color: "#E0312B" },
  { id: "yahoo", name: "Yahoo奇摩", color: "#6D28D9" },
  { id: "coupang", name: "酷澎", color: "#F0562B" },
  { id: "shopee", name: "蝦皮", color: "#EE4D2D" },
  { id: "pxgo", name: "全聯", color: "#1B4F8A" },
  { id: "etmall", name: "東森", color: "#C2410C" },
  { id: "rakuten", name: "樂天", color: "#BF0000" },
  { id: "ruten", name: "露天", color: "#0F766E" },
];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

export function platformById(id: PlatformId): PlatformMeta {
  const found = PLATFORMS.find((platform) => platform.id === id);
  if (!found) throw new Error(`unknown platform ${id}`);
  return found;
}

/** Public search page, without affiliate parameters. Server fetches use this. */
export function rawSearchUrl(id: PlatformId, query: string): string {
  const q = encodeURIComponent(query);
  switch (id) {
    case "momo":
      return `https://www.momoshop.com.tw/search/${q}`;
    case "pchome":
      return `https://24h.pchome.com.tw/search/?q=${q}`;
    case "yahoo":
      return `https://tw.buy.yahoo.com/search/product?p=${q}`;
    case "coupang":
      return `https://www.tw.coupang.com/np/search?q=${q}`;
    case "shopee":
      return `https://shopee.tw/search?keyword=${q}`;
    case "pxgo":
      return `https://pxbox.es.pxmart.com.tw/search/result?keyword=${q}`;
    case "etmall":
      return `https://www.etmall.com.tw/Search?keyword=${q}`;
    case "rakuten":
      return `https://www.rakuten.com.tw/search/${q}/`;
    case "ruten":
      return `https://www.ruten.com.tw/search/${q}/`;
  }
}

/** Search page opened by the visitor. Affiliate wrapping, when enabled, happens here. */
export function platformSearchUrl(id: PlatformId, query: string): string {
  return applyAffiliate(rawSearchUrl(id, query));
}

/**
 * `null` means the parameter was omitted, so every platform is included.
 * An explicit list keeps only known ids, in the canonical order.
 */
export function parsePlatformParam(raw: string | null): PlatformId[] {
  if (raw === null) return [...PLATFORM_IDS];
  const wanted = new Set(raw.split(",").map((part) => part.trim()).filter(Boolean));
  return PLATFORM_IDS.filter((id) => wanted.has(id));
}
