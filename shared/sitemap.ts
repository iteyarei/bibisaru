import { escapeXml } from "./html";
import { HOT_KEYWORDS } from "./hot-keywords";
import { K_SNAPSHOTS } from "./k-snapshots";
import { kOverviewPath, kPagePath, KEYWORD_SLUGS } from "./k-slugs";

/**
 * Today in Taipei time as YYYY-MM-DD. A fixed date string keeps the output
 * deterministic inside a test and matches the day a reader in Taiwan sees.
 */
export function sitemapDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function urlEntry(origin: string, path: string, lastmod: string): string {
  return `  <url>
    <loc>${origin}${escapeXml(path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
  </url>
`;
}

/**
 * One entry per landing page, with the date it was really last regenerated.
 *
 * This week's keywords are regenerated daily, so they get today. A keyword
 * that dropped off the list keeps its page and its URL forever, but it is no
 * longer rebuilt, so its lastmod is the day its snapshot was captured — that
 * is the honest answer, and a crawler will not keep refetching a frozen page.
 */
export function landingEntries(
  now: Date = new Date(),
  slugs: Readonly<Record<string, string>> = KEYWORD_SLUGS,
  snapshots: Readonly<Record<string, { date: string }>> = K_SNAPSHOTS,
): { path: string; lastmod: string }[] {
  const today = sitemapDate(now);
  const hot = new Set(HOT_KEYWORDS.map((item) => item.keyword));
  const entries = [
    { path: "/", lastmod: today },
    { path: kOverviewPath(), lastmod: today },
  ];
  const seen = new Set(entries.map((entry) => entry.path));
  for (const [keyword, slug] of Object.entries(slugs)) {
    const path = kPagePath(slug);
    if (seen.has(path)) continue;
    seen.add(path);
    const snapshot = hot.has(keyword) ? undefined : snapshots[slug];
    entries.push({ path, lastmod: snapshot ? snapshot.date.replace(/\//g, "-") : today });
  }
  return entries;
}

/** Home page plus every /k/ landing page. No ?q= entries: those were never real pages. */
export function landingPaths(): string[] {
  return landingEntries().map((entry) => entry.path);
}

export function buildSitemap(rawOrigin: string, now: Date = new Date()): string {
  const origin = escapeXml(rawOrigin.replace(/\/+$/, ""));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${landingEntries(now)
  .map((entry) => urlEntry(origin, entry.path, entry.lastmod))
  .join("")}</urlset>
`;
}
