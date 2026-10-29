import { describe, expect, it } from "vitest";
import raw from "../shared/hot-keywords.json";
import { groupHotKeywords, HOT_KEYWORDS, hotKeywordPath, validateHotKeywords } from "../shared/hot-keywords";
import { buildSitemap } from "../shared/sitemap";

describe("hot keywords", () => {
  it("data file matches schema", () => {
    // 筆數不寫死：每週換關鍵字、之後多「節慶熱門」分類都不該讓測試紅。
    const valid = validateHotKeywords(raw);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid).toHaveLength(raw.length);
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
  it("points every chip at its own landing page", () => {
    expect(hotKeywordPath("iPhone 18 Pro")).toBe("/k/iphone-18-pro/");
    expect(hotKeywordPath("除濕機")).toBe("/k/chushiji/");
    // 分類順序跟著資料檔出現的順序，不寫死清單。
    const expected = [...new Set(HOT_KEYWORDS.map((item) => item.category))];
    expect(groupHotKeywords(HOT_KEYWORDS).map((g) => g.category)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
  it("sitemap lists every keyword landing page", () => {
    const xml = buildSitemap("https://bibisaru.pages.dev");
    expect(xml).toContain("<loc>https://bibisaru.pages.dev/</loc>");
    for (const item of HOT_KEYWORDS) expect(xml).toContain(`https://bibisaru.pages.dev${hotKeywordPath(item.keyword)}`);
  });
});

import indexHtml from "../index.html?raw";
describe("hot keywords popover markup", () => {
  const html = indexHtml;
  it("panel sits inside the search form with flame title, old section removed", () => {
    const form = html.slice(html.indexOf('<form id="search-form"'), html.indexOf("</form>", html.indexOf('<form id="search-form"')));
    expect(form).toContain('id="hot-pop"');
    expect(form).toContain('id="hot-groups"');
    expect(form).toMatch(/🔥<\/span> 熱門搜尋商品 <span aria-hidden="true">🔥/);
    expect(html).not.toContain("最近大家在找");
    expect(html).toMatch(/id="q"[^>]*aria-expanded="false"/);
  });
});
