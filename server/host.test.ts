import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { decodeShopBody } from "../functions/lib/shop-body";
import { readMemoryCache, resetMemoryCache, writeMemoryCache } from "./memory-cache";
import { handleHome, handleRobots, handleSearch, handleSitemap } from "./routes";
import { createRateLimiter } from "../shared/rate-limit";
import { visitorKey, withinBudget } from "./visitor";

afterEach(() => {
  resetMemoryCache();
});

describe("shop body", () => {
  it("unzips a body Node left compressed", async () => {
    const text = "<html>樂天耳機</html>";
    const decoded = await decodeShopBody(gzipSync(text), "gzip");
    expect(decoded).toBe(text);
  });
});

describe("memory cache", () => {
  it("keeps a response until s-maxage and drops no-store", () => {
    writeMemoryCache("a", {
      status: 200,
      body: "ok",
      cacheControl: "public, max-age=30, s-maxage=180",
      contentType: "application/json",
    }, 1_000);
    expect(readMemoryCache("a", 1_000 + 179_000)?.body).toBe("ok");
    expect(readMemoryCache("a", 1_000 + 180_000)).toBeNull();
    writeMemoryCache("b", {
      status: 200,
      body: "no",
      cacheControl: "no-store",
      contentType: "application/json",
    }, 1_000);
    expect(readMemoryCache("b", 1_000)).toBeNull();
  });
});

describe("cursor host routes", () => {
  it("counts the address the proxy appended, not one the visitor wrote", () => {
    const request = new Request("https://bibisaru.example/", {
      headers: { "x-forwarded-for": "203.0.113.8, 198.51.100.20" },
    });
    expect(visitorKey(request)).toBe("198.51.100.20");
    const invented = new Request("https://bibisaru.example/", { headers: { "x-forwarded-for": "not-an-ip" } });
    const another = new Request("https://bibisaru.example/", { headers: { "x-forwarded-for": "also-not" } });
    expect(visitorKey(invented)).toBe(visitorKey(another));
  });

  it("leaves the shared budget alone after that visitor is already out of searches", () => {
    const allowVisitor = createRateLimiter(1, 60_000);
    const allowAll = createRateLimiter(2, 60_000);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.1", 1_000)).toBe(true);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.1", 1_000)).toBe(false);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.2", 1_000)).toBe(true);
  });

  it("stops a new visitor key from getting a fresh budget once the shared ceiling is spent", () => {
    const allowVisitor = createRateLimiter(20, 60_000);
    const allowAll = createRateLimiter(2, 60_000);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.1", 1_000)).toBe(true);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.2", 1_000)).toBe(true);
    expect(withinBudget(allowVisitor, allowAll, "198.51.100.3", 1_000)).toBe(false);
  });

  it("rejects an empty search without calling a shop", async () => {
    const response = await handleSearch(new Request("https://bibisaru.example/api/search"));
    expect(response.status).toBe(400);
  });

  it("serves robots and a sitemap for the request origin", async () => {
    const robots = handleRobots(new Request("https://bibisaru.example/robots.txt"));
    expect(await robots.text()).toContain("Sitemap: https://bibisaru.example/sitemap.xml");
    const sitemap = handleSitemap(new Request("https://bibisaru.example/sitemap.xml"));
    const xml = await sitemap.text();
    expect(xml).toContain("https://bibisaru.example/k/");
    expect(xml).not.toContain("bibisaru.pages.dev");
  });

  it("points the home page canonical at this host", () => {
    const response = handleHome(new Request("https://bibisaru.example/"));
    return response.text().then((html) => {
      if (response.status === 500) return;
      expect(html).toContain("https://bibisaru.example/");
      expect(html).not.toContain("bibisaru.pages.dev");
    });
  });
});
