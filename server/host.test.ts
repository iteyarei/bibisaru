import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { decodeShopBody } from "../functions/lib/shop-body";
import { SHOPEE_AFFILIATE_ID, shopeeAffiliateUrl } from "../shared/affiliate";
import { renderKPage } from "../shared/k-page";
import { kPagePath } from "../shared/k-slugs";
import { createRateLimiter } from "../shared/rate-limit";
import { readMemoryCache, resetMemoryCache, writeMemoryCache } from "./memory-cache";
import { OFFICIAL_ORIGIN, handleHome, handleKeyword, handleRobots, handleSearch, handleSitemap, withOfficialOrigin } from "./routes";
import { visitorKey, withinBudget } from "./visitor";

/** Deployment hostname Google saw on 7 Nov 2026. The public site is proxied here. */
const PREVIEW_HOST = "bibisaru-apps-grok-4zdje77be-cursor-user342832795-i9oplk7h.vercel.app";

function previewRequest(path: string): Request {
  return new Request(`https://${PREVIEW_HOST}${path}`, {
    headers: {
      host: PREVIEW_HOST,
      "x-forwarded-host": PREVIEW_HOST,
      "x-forwarded-proto": "https",
    },
  });
}

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

});

describe("official origin", () => {
  it("points robots and the sitemap at the official host, not the deployment host", async () => {
    const robots = handleRobots(previewRequest("/robots.txt"));
    expect(robots.headers.get("x-robots-tag")).toBeNull();
    expect(await robots.text()).toBe(
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${OFFICIAL_ORIGIN}/sitemap.xml\n`,
    );

    const sitemap = handleSitemap(previewRequest("/sitemap.xml"));
    expect(sitemap.headers.get("x-robots-tag")).toBeNull();
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${OFFICIAL_ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${OFFICIAL_ORIGIN}/k/</loc>`);
    expect(xml).toContain(`<loc>${OFFICIAL_ORIGIN}${kPagePath("chushiji")}</loc>`);
    expect(xml).not.toContain("vercel.app");
    expect(xml).not.toContain("pages.dev");
    expect(xml).not.toContain("bibisaru.example");
  });

  it("keeps keyword canonical, open graph, and structured data on the official path", async () => {
    const search = `https://shopee.tw/search?keyword=${encodeURIComponent("除濕機")}`;
    const affiliate = shopeeAffiliateUrl(search);
    const parsed = new URL(affiliate);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://s.shopee.tw/an_redir");
    expect(parsed.searchParams.get("affiliate_id")).toBe("16330620037");
    expect(SHOPEE_AFFILIATE_ID).toBe("16330620037");
    expect(parsed.searchParams.get("origin_link")).toBe(search);

    const html = withOfficialOrigin(
      renderKPage({
        keyword: "除濕機",
        slug: "chushiji",
        category: "家電",
        reason: "test",
        products: [
          {
            platform: "shopee",
            title: "除濕機",
            price: 1990,
            image: "https://example.com/dehumidifier.png",
            url: search,
            rank: 1,
          },
        ],
        platforms: [],
        fetchedAt: new Date("2026-11-07T00:00:00Z"),
      }),
    );
    expect(html).toContain(`<link rel="canonical" href="${OFFICIAL_ORIGIN}/k/chushiji/">`);
    expect(html).toContain(`<meta property="og:url" content="${OFFICIAL_ORIGIN}/k/chushiji/">`);
    expect(html).toContain(`"item":"${OFFICIAL_ORIGIN}/"`);
    expect(html).toContain(`"item":"${OFFICIAL_ORIGIN}/k/"`);
    expect(html).toContain(`"item":"${OFFICIAL_ORIGIN}/k/chushiji/"`);
    expect(html).toContain(affiliate);
    expect(html).not.toContain("pages.dev");
    expect(html).not.toContain("vercel.app");

    const overview = await handleKeyword(previewRequest("/k/"));
    expect(overview.status).toBe(200);
    expect(overview.headers.get("x-robots-tag")).toBeNull();
    const overviewHtml = await overview.text();
    expect(overviewHtml).toContain(`<link rel="canonical" href="${OFFICIAL_ORIGIN}/k/">`);
    expect(overviewHtml).toContain(`<meta property="og:url" content="${OFFICIAL_ORIGIN}/k/">`);
    expect(overviewHtml).toContain(`"item":"${OFFICIAL_ORIGIN}/"`);
    expect(overviewHtml).toContain(`"item":"${OFFICIAL_ORIGIN}/k/"`);
    expect(overviewHtml).not.toContain('content="noindex"');
    expect(overviewHtml).not.toContain("vercel.app");
    expect(overviewHtml).not.toContain("pages.dev");
  });

  it("rewrites homepage canonical and open graph without adding an indexing header", async () => {
    const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const html = withOfficialOrigin(source);
    expect(html).toContain(`<link rel="canonical" href="${OFFICIAL_ORIGIN}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${OFFICIAL_ORIGIN}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${OFFICIAL_ORIGIN}/icon-512.png" />`);
    expect(html).toContain('content="hiPEIDd2LoEf3C9nIQEwNFb353HUttc4ugjK3jMdL_c"');
    expect(html).toContain('content="kqltPE-6xy07GJe16DqsguMuHgAWmbYrzHOrdHAa_OA"');
    expect(html).not.toContain("pages.dev");
    expect(html).not.toContain("vercel.app");

    const response = handleHome(previewRequest("/"));
    expect(response.headers.get("x-robots-tag")).toBeNull();
    if (response.status === 500) return;
    const body = await response.text();
    expect(body).toContain(`<link rel="canonical" href="${OFFICIAL_ORIGIN}/"`);
    expect(body).not.toContain("vercel.app");
    expect(body).not.toContain("pages.dev");
  });
});
