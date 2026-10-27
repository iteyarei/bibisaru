import { HOT_KEYWORDS, hotKeywordPath } from "./hot-keywords";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSitemap(rawOrigin: string): string {
  const origin = escapeXml(rawOrigin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>daily</changefreq>
  </url>
${HOT_KEYWORDS.map(
  (item) => `  <url>
    <loc>${origin}${escapeXml(hotKeywordPath(item.keyword))}</loc>
    <changefreq>weekly</changefreq>
  </url>
`,
).join("")}</urlset>
`;
}
