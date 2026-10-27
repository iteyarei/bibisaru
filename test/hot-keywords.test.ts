import { describe, expect, it } from "vitest";
import raw from "../shared/hot-keywords.json";
import { groupHotKeywords, HOT_KEYWORDS, hotKeywordPath, validateHotKeywords } from "../shared/hot-keywords";
import { buildSitemap } from "../shared/sitemap";

describe("hot keywords", () => {
  it("data file matches schema", () => {
    expect(validateHotKeywords(raw)).toHaveLength(17);
    for (const item of raw) expect(Object.keys(item).sort()).toEqual(["category", "keyword", "reason"]);
  });
  it("uses traditional chars", () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/[脱销]/);
  });
  it("rejects bad data", () => {
    expect(() => validateHotKeywords({})).toThrow();
    expect(() => validateHotKeywords([{ keyword: "", category: "a", reason: "b" }])).toThrow();
    expect(() => validateHotKeywords([{ keyword: "a", category: "a" }])).toThrow();
    expect(() => validateHotKeywords([{ keyword: "a", category: "x", reason: "b" }, { keyword: "a", category: "y", reason: "c" }])).toThrow();
  });
  it("builds search URLs and groups", () => {
    expect(hotKeywordPath("iPhone 18 Pro")).toBe("/?q=iPhone%2018%20Pro");
    expect(hotKeywordPath("除濕機")).toBe(`/?q=${encodeURIComponent("除濕機")}`);
    expect(groupHotKeywords(HOT_KEYWORDS).map((g) => g.category)).toEqual(["家電", "3C", "生活", "食品"]);
  });
  it("sitemap lists every keyword", async () => {
    const xml = buildSitemap("https://bibisaru.pages.dev");
    expect(xml).toContain("<loc>https://bibisaru.pages.dev/</loc>");
    for (const item of HOT_KEYWORDS) expect(xml).toContain(`https://bibisaru.pages.dev${hotKeywordPath(item.keyword)}`);
  });
});
