export type PlatformId =
  | "momo"
  | "pchome"
  | "yahoo"
  | "coupang"
  | "shopee"
  | "pxgo"
  | "etmall"
  | "kingstone"
  | "sanmin";

export type SortMode = "price-asc" | "price-desc" | "relevance";

export type PlatformStatus = "ok" | "empty" | "unavailable";

/** One normalized listing. Price is an integer number of TWD. */
export interface Product {
  platform: PlatformId;
  title: string;
  price: number;
  image: string;
  url: string;
  /** Position in that platform's own result list. Lower is more relevant there. */
  rank: number;
}

export interface PlatformReport {
  id: PlatformId;
  status: PlatformStatus;
  count: number;
  searchUrl: string;
  /** Why this shop is unavailable. Never contains secrets. */
  reason?: string;
}

export interface SearchMeta {
  /** Colo that accepted the visitor, such as HKG. Empty outside the edge. */
  colo: string;
  /** Colo where the outbound fetch ran. From cdn-cgi/trace. Empty if that probe failed. */
  fetchColo: string;
}

export interface SearchResponse {
  query: string;
  fetchedAt: string;
  results: Product[];
  platforms: PlatformReport[];
  meta: SearchMeta;
}

export interface PlatformResult {
  id: PlatformId;
  status: "ok" | "unavailable";
  products: Product[];
  searchUrl: string;
  /** Why this shop is unavailable. Never contains secrets. */
  reason?: string;
}

export type PlatformFetcher = (query: string) => Promise<PlatformResult>;
