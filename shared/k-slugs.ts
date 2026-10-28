/**
 * Fixed keyword → slug map for the /k/ landing pages.
 *
 * A keyword must always keep the same slug: a page that changes URL loses the
 * ranking it earned. Add new keywords here (and a test proves every hot
 * keyword has one) instead of deriving slugs from the keyword at request time.
 *
 * Slugs are hand-written, roughly pinyin. English words stay as they are,
 * lower-cased and joined with hyphens.
 */

import slugData from "./k-slugs.json";

export const SITE_ORIGIN = "https://bibisaru.pages.dev";

export const KEYWORD_SLUGS: Readonly<Record<string, string>> = slugData;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_TO_KEYWORD: ReadonlyMap<string, string> = new Map(
  Object.entries(KEYWORD_SLUGS).map(([keyword, slug]) => [slug, keyword]),
);

/** The slug for a keyword, or null when the map has no entry yet. */
export function slugForKeyword(keyword: string): string | null {
  return KEYWORD_SLUGS[keyword.trim()] ?? null;
}

/** The keyword a slug belongs to, or null. Slugs are matched lower-case. */
export function keywordForSlug(slug: string, map: ReadonlyMap<string, string> = SLUG_TO_KEYWORD): string | null {
  return map.get(slug.trim().toLowerCase()) ?? null;
}

/** `/k/<slug>/` for a keyword, or null when the map has no entry yet. */
export function kPathForKeyword(keyword: string): string | null {
  const slug = slugForKeyword(keyword);
  return slug ? kPagePath(slug) : null;
}

/** Landing page path. Always trailing-slash so there is no second redirect. */
export function kPagePath(slug: string): string {
  return `/k/${slug}/`;
}

export function kPageUrl(slug: string): string {
  return `${SITE_ORIGIN}${kPagePath(slug)}`;
}

export function kOverviewPath(): string {
  return "/k/";
}

export function kOverviewUrl(): string {
  return `${SITE_ORIGIN}/k/`;
}

/**
 * Every keyword needs its own slug, and no two keywords may share one.
 * Called from the tests, so a missing entry fails the build instead of
 * silently dropping a page.
 */
export function assertSlugMap(keywords: readonly { keyword: string }[]): void {
  const seen = new Set<string>();
  for (const { keyword } of keywords) {
    const slug = slugForKeyword(keyword);
    if (!slug) throw new Error(`hot keyword without a slug: ${keyword}`);
    if (!SLUG_PATTERN.test(slug)) throw new Error(`slug is not url-safe: ${keyword} → ${slug}`);
    if (seen.has(slug)) throw new Error(`duplicate slug ${slug}`);
    seen.add(slug);
  }
  for (const [keyword, slug] of Object.entries(KEYWORD_SLUGS)) {
    if (keywordForSlug(slug) !== keyword) throw new Error(`slug is not unique: ${keyword} → ${slug}`);
    if (!SLUG_PATTERN.test(slug)) throw new Error(`slug is not url-safe: ${keyword} → ${slug}`);
  }
}

export type KRoute =
  | { kind: "overview" }
  | { kind: "keyword"; keyword: string; slug: string }
  | { kind: "not-found" };

/**
 * Turn a request path such as /k/switch-2/ into the page it means.
 *
 * The slug map is the source of truth, not the hot keyword list: a keyword
 * that dropped off this week's list still has its entry here, so its page
 * keeps answering at the same URL forever instead of turning into a 404.
 */
export function resolveKPath(pathname: string, map: ReadonlyMap<string, string> = SLUG_TO_KEYWORD): KRoute {
  if (pathname !== "/k" && !pathname.startsWith("/k/")) return { kind: "not-found" };
  let rest = pathname.slice(2);
  while (rest.startsWith("/")) rest = rest.slice(1);
  while (rest.endsWith("/")) rest = rest.slice(0, -1);
  if (!rest) return { kind: "overview" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return { kind: "not-found" };
  }
  const slug = decoded.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { kind: "not-found" };
  const keyword = keywordForSlug(slug, map);
  if (!keyword) return { kind: "not-found" };
  return { kind: "keyword", keyword, slug };
}
