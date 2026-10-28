import data from "./hot-keywords.json";
import { kPathForKeyword } from "./k-slugs";
import { normalizeQuery } from "./query";

export interface HotKeyword {
  keyword: string;
  category: string;
  reason: string;
}

export function validateHotKeywords(input: unknown): HotKeyword[] {
  if (!Array.isArray(input)) throw new Error("hot-keywords must be an array");
  const seen = new Set<string>();
  return input.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`item ${i} is not an object`);
    const { keyword, category, reason } = item as Record<string, unknown>;
    for (const [k, v] of Object.entries({ keyword, category, reason })) {
      if (typeof v !== "string" || !v.trim()) throw new Error(`item ${i} field ${k} must be a non-empty string`);
    }
    const normalized = normalizeQuery(keyword as string);
    if (!normalized) throw new Error(`item ${i} keyword invalid`);
    if (seen.has(normalized)) throw new Error(`duplicate keyword ${normalized}`);
    seen.add(normalized);
    return { keyword: keyword as string, category: category as string, reason: reason as string };
  });
}

export const HOT_KEYWORDS: HotKeyword[] = validateHotKeywords(data);

/**
 * Where a hot keyword chip points: its own static landing page.
 * A keyword that has no slug yet falls back to the live search so the chip
 * never goes nowhere; a test fails the build before that can ship.
 */
export function hotKeywordPath(keyword: string): string {
  return kPathForKeyword(keyword) ?? `/?q=${encodeURIComponent(normalizeQuery(keyword) ?? keyword.trim())}`;
}

export function groupHotKeywords(list: HotKeyword[]): { category: string; items: HotKeyword[] }[] {
  const groups = new Map<string, HotKeyword[]>();
  for (const item of list) {
    const bucket = groups.get(item.category) ?? [];
    bucket.push(item);
    groups.set(item.category, bucket);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}
