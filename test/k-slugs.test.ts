import { describe, expect, it } from "vitest";
import raw from "../shared/hot-keywords.json";
import { HOT_KEYWORDS } from "../shared/hot-keywords";
import {
  assertSlugMap,
  KEYWORD_SLUGS,
  keywordForSlug,
  kPathForKeyword,
  resolveKPath,
  slugForKeyword,
  SLUG_PATTERN,
} from "../shared/k-slugs";

describe("keyword slugs", () => {
  it("every hot keyword has its own slug, and the map is bijective", () => {
    expect(() => assertSlugMap(HOT_KEYWORDS)).not.toThrow();
    expect(() => assertSlugMap(raw)).not.toThrow();
  });

  it("uses the agreed hand-written slugs", () => {
    expect(slugForKeyword("除濕機")).toBe("chushiji");
    expect(slugForKeyword("乾衣機")).toBe("ganyiji");
    expect(slugForKeyword("iPhone 18 Pro")).toBe("iphone-18-pro");
    expect(slugForKeyword("薑母鴨")).toBe("jiangmuya");
    expect(slugForKeyword("Switch 2")).toBe("switch-2");
    expect(slugForKeyword("濾掛咖啡")).toBe("luguakafei");
  });

  it("keeps every slug url-safe and stable across calls", () => {
    for (const [keyword, slug] of Object.entries(KEYWORD_SLUGS)) {
      expect(slug).toMatch(SLUG_PATTERN);
      expect(slugForKeyword(keyword)).toBe(slug);
      expect(keywordForSlug(slug)).toBe(keyword);
      expect(kPathForKeyword(keyword)).toBe(`/k/${slug}/`);
    }
  });

  it("fails loudly for a keyword with no slug instead of guessing one", () => {
    expect(() => assertSlugMap([{ keyword: "不存在的商品" }])).toThrow(/without a slug/);
    expect(slugForKeyword("不存在的商品")).toBeNull();
    expect(kPathForKeyword("不存在的商品")).toBeNull();
  });
});

describe("resolving a /k/ path", () => {
  it("reads the overview with or without a trailing slash", () => {
    expect(resolveKPath("/k")).toEqual({ kind: "overview" });
    expect(resolveKPath("/k/")).toEqual({ kind: "overview" });
    expect(resolveKPath("/k///")).toEqual({ kind: "overview" });
  });

  it("reads a keyword page with or without a trailing slash", () => {
    const expected = { kind: "keyword", keyword: "Switch 2", slug: "switch-2" };
    expect(resolveKPath("/k/switch-2")).toEqual(expected);
    expect(resolveKPath("/k/switch-2/")).toEqual(expected);
    expect(resolveKPath("/k/Switch-2/")).toEqual(expected);
  });

  it("returns not-found for anything else", () => {
    for (const path of ["/k/nope-xyz", "/k/iphone-18", "/k/switch-2/extra", "/k/%20", "/k/%E9%99%A4", "/", "/p/switch-2"]) {
      expect(resolveKPath(path)).toEqual({ kind: "not-found" });
    }
  });
});
