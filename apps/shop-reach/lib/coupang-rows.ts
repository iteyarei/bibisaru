import { COUPANG_SEARCH_LIMIT } from "../vendor/shared/coupang-api";
import { canonicalImageUrl, cleanTitle, parsePrice } from "../vendor/shared/text";
import type { Product } from "../vendor/shared/types";

const COUPANG_LINK = /(^|\.)coupang\.com$/i;
/** Taiwan Partners currently returns AppsFlyer links on this host, not coupang.com. */
const ONELINK_HOST = "coupang.onelink.me";

export interface RowSkips {
  title: number;
  price: number;
  url: number;
  duplicate: number;
  /** Safe summary of why productUrl failed. No path, query, or userinfo. */
  urlNote: string | null;
}

export interface CoupangRows {
  emptyCause: "no_rows" | "rows_unusable" | null;
  rawRows: number;
  skipped: RowSkips;
}

const NONE: RowSkips = { title: 0, price: 0, url: 0, duplicate: 0, urlNote: null };

/** Why a successful Coupang payload kept zero products. `kept` is `listedCoupangProducts`. */
export function coupangRows(payload: unknown, kept: number): CoupangRows {
  const list = productData(payload);
  const rawRows = list.length;
  if (kept > 0) return { emptyCause: null, rawRows, skipped: { ...NONE } };
  if (rawRows === 0) return { emptyCause: "no_rows", rawRows: 0, skipped: { ...NONE } };
  return { emptyCause: "rows_unusable", rawRows, skipped: countSkips(list) };
}

/**
 * Same title and price rules as 比比猴. Also keeps an https link on
 * `coupang.onelink.me`, which the site parser still rejects.
 */
export function listedCoupangProducts(payload: unknown): Product[] | null {
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { rCode?: unknown })
    : null;
  if (!root || String(root.rCode) !== "0") return null;
  const list = productList(payload);
  if (!list) return null;
  const products: Product[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length && products.length < COUPANG_SEARCH_LIMIT; index += 1) {
    const row = asRow(list[index]);
    const title = cleanTitle(typeof row?.productName === "string" ? row.productName : "");
    const price = parsePrice(row?.productPrice);
    const url = usableUrl(row?.productUrl);
    if (!title || price === null || !url || seen.has(url)) continue;
    seen.add(url);
    products.push({
      platform: "coupang",
      title,
      price,
      image: canonicalImageUrl(typeof row?.productImage === "string" ? row.productImage : ""),
      url,
      rank: index,
    });
  }
  return products;
}

function productData(payload: unknown): unknown[] {
  return productList(payload) ?? [];
}

function productList(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const list = (data as { productData?: unknown }).productData;
  return Array.isArray(list) ? list : null;
}

function asRow(item: unknown): Record<string, unknown> | null {
  return item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
}

function usableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== ONELINK_HOST && !COUPANG_LINK.test(host))) return null;
    return raw;
  } catch {
    return null;
  }
}

const LINK_KEY = /url|link|href|landing/i;
const SAFE_HOST = /^[a-z0-9.-]{1,80}$/i;

interface UrlStats {
  missing: number;
  blank: number;
  relative: number;
  notUrl: number;
  protocol: number;
  host: number;
  protocols: string[];
  hosts: string[];
  usableFields: string[];
}

function countSkips(list: readonly unknown[]): RowSkips {
  const skipped: RowSkips = { ...NONE };
  const seen = new Set<string>();
  const urls: UrlStats = {
    missing: 0,
    blank: 0,
    relative: 0,
    notUrl: 0,
    protocol: 0,
    host: 0,
    protocols: [],
    hosts: [],
    usableFields: [],
  };
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
      noteUrl(row, urls);
      continue;
    }
    if (seen.has(url)) {
      skipped.duplicate += 1;
      continue;
    }
    seen.add(url);
    kept += 1;
  }
  skipped.urlNote = skipped.url > 0 ? urlPhrase(urls) : null;
  return skipped;
}

function noteUrl(row: Record<string, unknown> | null, stats: UrlStats): void {
  const kind = classifyUrl(row?.productUrl);
  if (kind.kind === "missing") stats.missing += 1;
  else if (kind.kind === "blank") stats.blank += 1;
  else if (kind.kind === "relative") stats.relative += 1;
  else if (kind.kind === "not_url") stats.notUrl += 1;
  else if (kind.kind === "protocol") {
    stats.protocol += 1;
    pushUnique(stats.protocols, kind.protocol);
  } else if (kind.kind === "host") {
    stats.host += 1;
    pushUnique(stats.hosts, kind.host);
  }
  if (!row) return;
  for (const [key, value] of Object.entries(row)) {
    if (key === "productUrl" || !LINK_KEY.test(key)) continue;
    if (classifyUrl(value).kind !== "ok") continue;
    pushUnique(stats.usableFields, key);
  }
}

function classifyUrl(value: unknown):
  | { kind: "missing" | "blank" | "relative" | "not_url" | "ok" }
  | { kind: "protocol"; protocol: string }
  | { kind: "host"; host: string } {
  if (typeof value !== "string") return { kind: "missing" };
  const raw = value.trim();
  if (!raw) return { kind: "blank" };
  if (raw.startsWith("/")) return { kind: "relative" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "not_url" };
  }
  const protocol = parsed.protocol.replace(":", "");
  if (protocol !== "https") return { kind: "protocol", protocol: protocol === "http" ? "http" : "other" };
  const host = safeHost(parsed.hostname);
  if (!host || !COUPANG_LINK.test(host)) return { kind: "host", host: host ?? "unknown" };
  return { kind: "ok" };
}

function safeHost(hostname: string): string | null {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  return SAFE_HOST.test(host) ? host : null;
}

function pushUnique(list: string[], value: string | null): void {
  if (!value || list.includes(value) || list.length >= 3) return;
  list.push(value);
}

function urlPhrase(stats: UrlStats): string {
  const parts: string[] = [];
  if (stats.missing) parts.push(`沒有 productUrl ${stats.missing}`);
  if (stats.blank) parts.push(`productUrl 是空的 ${stats.blank}`);
  if (stats.relative) parts.push(`productUrl 是相對路徑 ${stats.relative}`);
  if (stats.notUrl) parts.push(`productUrl 不是網址 ${stats.notUrl}`);
  if (stats.protocol) parts.push(`productUrl 不是 https ${stats.protocol}（${stats.protocols.join("、") || "other"}）`);
  if (stats.host) parts.push(`productUrl 網域不符 ${stats.host}（${stats.hosts.join("、") || "unknown"}）`);
  let text = `${parts.join("，")}。`;
  if (stats.usableFields.length) text += `同列還有可用連結欄位：${stats.usableFields.join("、")}。`;
  return text;
}
