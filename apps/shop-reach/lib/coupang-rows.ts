import { COUPANG_SEARCH_LIMIT, productsFromCoupangSearch } from "../vendor/shared/coupang-api";
import { cleanTitle, parsePrice } from "../vendor/shared/text";

const COUPANG_LINK = /(^|\.)coupang\.com$/i;

export interface RowSkips {
  title: number;
  price: number;
  url: number;
  duplicate: number;
}

export interface CoupangRows {
  emptyCause: "no_rows" | "rows_unusable" | null;
  rawRows: number;
  skipped: RowSkips;
}

const NONE: RowSkips = { title: 0, price: 0, url: 0, duplicate: 0 };

/** Why a successful Coupang payload kept zero products. The kept list still comes from `productsFromCoupangSearch`. */
export function coupangRows(payload: unknown, kept: number): CoupangRows {
  const list = productData(payload);
  const rawRows = list.length;
  if (kept > 0) return { emptyCause: null, rawRows, skipped: { ...NONE } };
  if (rawRows === 0) return { emptyCause: "no_rows", rawRows: 0, skipped: { ...NONE } };
  return { emptyCause: "rows_unusable", rawRows, skipped: countSkips(list) };
}

export function coupangKeptCount(payload: unknown): number {
  return productsFromCoupangSearch(payload)?.length ?? 0;
}

function productData(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const list = (data as { productData?: unknown }).productData;
  return Array.isArray(list) ? list : [];
}

function usableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !COUPANG_LINK.test(parsed.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

function countSkips(list: readonly unknown[]): RowSkips {
  const skipped: RowSkips = { ...NONE };
  const seen = new Set<string>();
  let kept = 0;
  for (const item of list) {
    if (kept >= COUPANG_SEARCH_LIMIT) break;
    const row = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const title = cleanTitle(typeof row?.productName === "string" ? row.productName : "");
    const price = parsePrice(row?.productPrice);
    const url = usableUrl(row?.productUrl);
    if (!title) {
      skipped.title += 1;
      continue;
    }
    if (price === null) {
      skipped.price += 1;
      continue;
    }
    if (!url) {
      skipped.url += 1;
      continue;
    }
    if (seen.has(url)) {
      skipped.duplicate += 1;
      continue;
    }
    seen.add(url);
    kept += 1;
  }
  return skipped;
}
