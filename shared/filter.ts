import { searchTokens, titleHasEveryTerm, tokenMatchKind } from "./synonyms";
import { normalizeMatchText } from "./text";
import type { PlatformId, Product, SortMode } from "./types";

export function filterByKeywords(products: readonly Product[], keywords: readonly string[]): Product[] {
  const needles = keywords.map((keyword) => normalizeMatchText(keyword.trim())).filter(Boolean);
  if (!needles.length) return [...products];
  return products.filter((product) => {
    const title = normalizeMatchText(product.title);
    return !needles.some((needle) => title.includes(needle));
  });
}

/** Every search term must appear in the title. Synonym rows count as the same term. A long CJK term may match as separate pieces. */
export function filterBySearchTerms(products: readonly Product[], query: string): Product[] {
  const tokens = query.trim();
  if (!tokens) return [...products];
  return products.filter((product) => titleHasEveryTerm(product.title, query));
}

export function filterByPlatforms(products: readonly Product[], enabled: readonly PlatformId[]): Product[] {
  const allowed = new Set(enabled);
  return products.filter((product) => allowed.has(product.platform));
}

/** Blank input is unlimited. A non-digit string is ignored. */
export function parsePriceBound(raw: string): number | null {
  const trimmed = raw.trim().replace(/[,，]/g, "");
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount >= 100_000_000) return null;
  return amount;
}

/**
 * Inclusive TWD range. An empty bound is unlimited.
 * If the lower number is greater than the higher one, the two ends are swapped
 * so the range is still the span between them.
 */
export function filterByPrice(
  products: readonly Product[],
  min: number | null,
  max: number | null,
): Product[] {
  let low = min;
  let high = max;
  if (low !== null && high !== null && low > high) {
    const swapped = low;
    low = high;
    high = swapped;
  }
  if (low === null && high === null) return [...products];
  return products.filter(
    (product) => (low === null || product.price >= low) && (high === null || product.price <= high),
  );
}

function relevanceScore(title: string, query: string): number {
  const normalizedTitle = normalizeMatchText(title);
  const normalizedQuery = normalizeMatchText(query);
  if (!normalizedQuery) return 0;
  let score = normalizedTitle.includes(normalizedQuery) ? 5 : 0;
  for (const token of searchTokens(query)) {
    const kind = tokenMatchKind(title, token);
    if (kind === "exact") score += 2;
    else if (kind === "segment") score += 1;
  }
  return score;
}

export function sortProducts(products: readonly Product[], mode: SortMode, query: string): Product[] {
  const copy = [...products];
  if (mode === "price-asc") {
    copy.sort((a, b) => a.price - b.price || a.rank - b.rank || a.platform.localeCompare(b.platform));
  } else if (mode === "price-desc") {
    copy.sort((a, b) => b.price - a.price || a.rank - b.rank || a.platform.localeCompare(b.platform));
  } else {
    copy.sort(
      (a, b) => relevanceScore(b.title, query) - relevanceScore(a.title, query) || a.rank - b.rank,
    );
  }
  return copy;
}

export function markLowest<T extends { price: number }>(items: readonly T[]): Array<T & { lowest: boolean }> {
  if (!items.length) return [];
  let minimum = items[0].price;
  for (const item of items) if (item.price < minimum) minimum = item.price;
  return items.map((item) => ({ ...item, lowest: item.price === minimum }));
}

export function prepareResults(
  products: readonly Product[],
  options: {
    keywords: readonly string[];
    platforms: readonly PlatformId[];
    sort: SortMode;
    query: string;
    priceMin?: number | null;
    priceMax?: number | null;
  },
): Array<Product & { lowest: boolean }> {
  const byPlatform = filterByPlatforms(products, options.platforms);
  const byKeyword = filterByKeywords(byPlatform, options.keywords);
  const byTerms = filterBySearchTerms(byKeyword, options.query);
  const byPrice = filterByPrice(byTerms, options.priceMin ?? null, options.priceMax ?? null);
  return markLowest(sortProducts(byPrice, options.sort, options.query));
}

/** Space, comma, or enumeration comma. Mobile keyboards insert these without a reliable keydown. */
const KEYWORD_DELIMITER = /[\s,，、]/;

export function keywordDraftHasDelimiter(raw: string): boolean {
  return KEYWORD_DELIMITER.test(raw);
}

export function parseKeywordDraft(raw: string): string[] {
  return raw
    .split(/[\s,，、]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 20);
}

/**
 * Turn the exclude box into chips.
 * An empty field stays as-is. A delimiter-only field is cleared.
 * Plain text with no delimiter is still committed, so blur, Enter, and search can keep it.
 */
export function commitKeywordDraft(
  existing: readonly string[],
  raw: string,
): { keywords: string[]; clear: boolean } {
  const incoming = parseKeywordDraft(raw);
  if (!incoming.length && !raw.trim()) {
    return { keywords: [...existing], clear: keywordDraftHasDelimiter(raw) };
  }
  return { keywords: addKeywords(existing, incoming), clear: true };
}

export function addKeywords(existing: readonly string[], incoming: readonly string[], max = 12): string[] {
  const next = [...existing];
  const seen = new Set(next.map((keyword) => normalizeMatchText(keyword)));
  for (const word of incoming) {
    const trimmed = word.trim();
    if (!trimmed || trimmed.length > 20) continue;
    const key = normalizeMatchText(trimmed);
    if (!key || seen.has(key)) continue;
    if (next.length >= max) break;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

export function removeKeywords(existing: readonly string[], drop: readonly string[]): string[] {
  const dropSet = new Set(drop.map((keyword) => normalizeMatchText(keyword)));
  return existing.filter((keyword) => !dropSet.has(normalizeMatchText(keyword)));
}
