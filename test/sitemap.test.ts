import { describe, expect, it } from "vitest";
import raw from "../shared/hot-keywords.json";
import { HOT_KEYWORDS } from "../shared/hot-keywords";
import { buildSitemap, landingEntries, landingPaths, sitemapDate } from "../shared/sitemap";
import { KEYWORD_SLUGS } from "../shared/k-slugs";

const ORIGIN = "https://bibisaru.pages.dev";
const TODAY = new Date("2026-10-28T12:00:00Z");

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
}

describe("sitemap", () => {
  const xml = buildSitemap(ORIGIN, TODAY);

  it("is a well formed urlset", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    const open = (xml.match(/<url>/g) ?? []).length;
    const close = (xml.match(/<\/url>/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBe(locs(xml).length);
    // Every tag that opens also closes.
    for (const tag of ["url", "loc", "lastmod", "changefreq"]) {
      expect((xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length).toBe(
        (xml.match(new RegExp(`</${tag}>`, "g")) ?? []).length,
      );
    }
  });

  it("lists home, the overview and every keyword page", () => {
    const paths = locs(xml).map((loc) => loc.slice(ORIGIN.length));
    expect(paths[0]).toBe("/");
    expect(paths[1]).toBe("/k/");
    expect(paths).toHaveLength(HOT_KEYWORDS.length + 2);
    for (const item of HOT_KEYWORDS) {
      const slug = KEYWORD_SLUGS[item.keyword];
      expect(paths).toContain(`/k/${slug}/`);
    }
    expect(paths).toContain("/k/switch-2/");
    expect(paths).toContain("/k/iphone-18-pro/");
  });

  it("has no ?q= entries and no duplicates", () => {
    expect(xml).not.toContain("?q=");
    expect(xml).not.toContain("%3F");
    const all = locs(xml);
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses today's Taipei date, daily change frequency, and is deterministic", () => {
    expect(xml).toContain("<lastmod>2026-10-28</lastmod>");
    expect((xml.match(/<changefreq>daily<\/changefreq>/g) ?? []).length).toBe(HOT_KEYWORDS.length + 2);
    expect(buildSitemap(ORIGIN, TODAY)).toBe(xml);
  });

  it("drops keywords without a slug instead of inventing a URL", () => {
    const paths = landingPaths();
    expect(paths.every((path) => path === "/" || path === "/k/" || /^\/k\/[a-z0-9-]+\/$/.test(path))).toBe(true);
  });

  it("tolerates a trailing slash on the origin and escapes XML", () => {
    expect(buildSitemap(`${ORIGIN}/`, TODAY)).toBe(xml);
    const odd = buildSitemap("https://example.test/a&b", TODAY);
    expect(odd).toContain("<loc>https://example.test/a&amp;b/</loc>");
    expect(odd).not.toContain("a&b/");
  });

  it("dates the sitemap in Taipei time", () => {
    expect(sitemapDate(new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-28");
    expect(sitemapDate(new Date("2026-10-28T16:00:00Z"))).toBe("2026-10-29");
  });

  it("keeps the raw data file in sync with the compiled list", () => {
    expect(raw.map((item) => item.keyword)).toEqual(HOT_KEYWORDS.map((item) => item.keyword));
  });
});

describe("pages kept after they left the hot list", () => {
  const slugs = { ...KEYWORD_SLUGS, "暖暖包": "nuannuanbao" };
  const snapshots = { nuannuanbao: { date: "2024/01/15" } };
  const xml = buildSitemap(ORIGIN, TODAY);

  it("still lists a retired page, dated the day its snapshot was taken", () => {
    const entries = landingEntries(TODAY, slugs, snapshots);
    const retired = entries.find((entry) => entry.path === "/k/nuannuanbao/");
    expect(retired).toBeDefined();
    // Not today: the page is not regenerated any more, and saying otherwise
    // would have crawlers refetch a frozen page every morning.
    expect(retired?.lastmod).toBe("2024-01-15");
    expect(entries[0].lastmod).toBe("2026-10-28");
  });

  it("does not lose the live pages when a retired one joins the map", () => {
    const paths = landingEntries(TODAY, slugs, snapshots).map((entry) => entry.path);
    expect(paths).toContain("/k/chushiji/");
    expect(paths).toContain("/k/switch-2/");
    expect(paths).toContain("/k/nuannuanbao/");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("still emits a clean urlset for the shipped map", () => {
    expect(xml).not.toContain("nuannuanbao");
    expect(locs(xml)).toHaveLength(HOT_KEYWORDS.length + 2);
  });
});
