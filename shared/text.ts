import type { PlatformId } from "./types";

const PRODUCT_HOSTS: Record<PlatformId, RegExp> = {
  momo: /(^|\.)momoshop\.com\.tw$/i,
  pchome: /(^|\.)pchome\.com\.tw$/i,
  yahoo: /(^|\.)buy\.yahoo\.com$/i,
  coupang: /(^|\.)coupang\.com$/i,
  shopee: /(^|\.)shopee\.tw$/i,
  pxgo: /(^|\.)pxmart\.com\.tw$/i,
  etmall: /(^|\.)etmall\.com\.tw$/i,
  kingstone: /(^|\.)kingstone\.com\.tw$/i,
  sanmin: /(^|\.)sanmin\.com\.tw$/i,
  rakuten: /(^|\.)rakuten\.com\.tw$/i,
  ruten: /(^|\.)ruten\.com\.tw$/i,
};

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function cleanTitle(value: string): string {
  return decodeHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * Inventory count when the storefront provides one.
 * `null` means the field was missing or not a number, so stock is unknown.
 * `0` means sold out.
 */
export function stockCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const amount = Math.trunc(value);
    return amount >= 0 && amount < 100_000_000 ? amount : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const amount = Number(value.trim());
  return amount < 100_000_000 ? amount : null;
}

export function knownSoldOut(value: unknown): boolean {
  const count = stockCount(value);
  return count !== null && count <= 0;
}

/** TWD integer. Returns null for missing, zero, or non-numeric prices. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const amount = Math.round(value);
    return amount > 0 && amount < 100_000_000 ? amount : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const amount = Math.round(Number(cleaned));
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100_000_000) return null;
  return amount;
}

export function canonicalProductUrl(platform: PlatformId, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(decodeHtml(raw).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!PRODUCT_HOSTS[platform].test(url.hostname)) return null;
  return url.toString();
}

export function canonicalImageUrl(raw: string): string {
  let value = decodeHtml(raw).trim();
  if (!value) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeMatchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW");
}

/** Undo a JavaScript string escape so the embedded JSON can be parsed. */
export function jsUnescape(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(.)/g, (_match, unicode: string, hex: string, char: string) => {
    if (unicode) return String.fromCharCode(parseInt(unicode, 16));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    const map: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "\\": "\\",
      '"': '"',
      "'": "'",
      "/": "/",
    };
    return map[char] ?? char;
  });
}

export function parseJsonArrayPrefix(text: string): unknown[] | null {
  if (!text.startsWith("[")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        const value = JSON.parse(text.slice(0, index + 1)) as unknown;
        return Array.isArray(value) ? value : null;
      }
    }
  }
  return null;
}
