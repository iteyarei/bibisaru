import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikeChallenge } from "../../../functions/lib/providers";
import { challengePage } from "../lib/challenge";
import { decodeBody } from "../lib/decode-body";
import {
  beginProbe,
  endProbe,
  acceptsProbeCall,
  liveProbeEnabled,
  parseProbeBody,
  resetProbeSlots,
  sameOrigin,
} from "../lib/gate";
import { probeShop } from "../lib/probe";

const VENDOR = ["affiliate.ts", "coupang-api.ts", "normalize.ts", "platforms.ts", "text.ts", "types.ts"];

const SIGNATURE =
  "bcd1e081c3bd24fd345eed65b598086db649bf4ffddb4d36b08d7ac46c01165f";

function rakutenPage(items: unknown[]): string {
  const data = { initialData: { searchPage: { result: { items } } } };
  return `<html><script data-component-name="SearchPage">${JSON.stringify(data)}</script></html>`;
}

const rakutenItem = {
  itemName: "有線耳機",
  itemUrl: "https://www.rakuten.com.tw/shop/polywell/product/f88b3l6sa/?s-id=ad",
  itemPrice: { min: 160, max: 160 },
  itemImageUrl: "https://tshop.r10s.com/7a8/a.png",
  itemStatus: "Available",
};

describe("賣場連線測試", () => {
  it("keeps the vendored shop logic identical to the site", () => {
    for (const name of VENDOR) {
      expect(readFileSync(`apps/shop-reach/vendor/shared/${name}`, "utf8")).toBe(readFileSync(`shared/${name}`, "utf8"));
    }
  });

  it("uses the same challenge check as the shop fetcher", () => {
    const samples = ["hello", "<html>captcha</html>", "Verify you are human", "請稍後再試", "異常流量", `${"x".repeat(200_000)}captcha`];
    for (const sample of samples) expect(challengePage(sample)).toBe(looksLikeChallenge(sample));
  });

  it("decodes a gzip body and leaves plain text alone", () => {
    const html = "<html>耳機</html>";
    expect(decodeBody(gzipSync(Buffer.from(html)), "gzip")).toBe(html);
    expect(decodeBody(new TextEncoder().encode(html), "gzip")).toBe(html);
  });

  it("signs one Coupang request and counts parsed products", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const report = await probeShop("coupang", "電鍋", {
      now: new Date(Date.UTC(2026, 0, 1)),
      accessKey: "test-access-key",
      secretKey: "coupang-test-secret",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Response.json({
          rCode: "0",
          data: {
            productData: [
              {
                productName: "大同電鍋",
                productPrice: 2480,
                productImage: "https://thumbnail.coupangcdn.com/thumbnails/remote/pot.jpg",
                productUrl: "https://link.tw.coupang.com/re2/AFFSDP?lptag=AF6766993&pageKey=123",
              },
            ],
          },
        });
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api-gateway.tw.coupang.com/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=%E9%9B%BB%E9%8D%8B&limit=10&subId=bibisaru",
    );
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(
      `CEA algorithm=HmacSHA256, access-key=test-access-key, signed-date=260101T000000Z, signature=${SIGNATURE}`,
    );
    expect(calls[0]?.init.redirect).toBe("follow");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(report).toMatchObject({ sent: true, httpStatus: 200, parsed: true, count: 1, ok: true, reason: null, emptyCause: null });
    expect(report.products[0]).toMatchObject({ title: "大同電鍋", price: 2480 });
    const body = JSON.stringify(report);
    expect(body).not.toContain("test-access-key");
    expect(body).not.toContain("coupang-test-secret");
    expect(body).not.toContain(SIGNATURE);
  });

  it("tells an empty Coupang catalog from rows that cannot be listed", async () => {
    const keys = { accessKey: "test-access-key", secretKey: "coupang-test-secret" };
    const empty = await probeShop("coupang", "耳機", {
      ...keys,
      fetchImpl: async () => Response.json({ rCode: "0", data: { productData: [] } }),
    });
    expect(empty).toMatchObject({ ok: true, parsed: true, count: 0, emptyCause: "no_rows", rawRows: 0, reason: "empty_no_rows" });
    expect(empty.products).toEqual([]);

    const unusable = await probeShop("coupang", "耳機", {
      ...keys,
      fetchImpl: async () => Response.json({
        rCode: "0",
        data: {
          productData: [
            { productName: "", productPrice: 100, productUrl: "https://link.tw.coupang.com/re2/AFFSDP?pageKey=1" },
            { productName: "沒有售價", productPrice: 0, productUrl: "https://link.tw.coupang.com/re2/AFFSDP?pageKey=2" },
            { productName: "外站", productPrice: 80, productUrl: "https://evil.example/item" },
          ],
        },
      }),
    });
    expect(unusable).toMatchObject({
      ok: true,
      count: 0,
      emptyCause: "rows_unusable",
      rawRows: 3,
      skipped: { title: 1, price: 1, url: 1, duplicate: 0 },
    });
    expect(JSON.stringify(unusable)).not.toContain("coupang-test-secret");
  });

  it("does not call Coupang when a key is missing, and redacts keys from failures", async () => {
    let calls = 0;
    const missing = await probeShop("coupang", "耳機", {
      accessKey: "",
      secretKey: null,
      fetchImpl: async () => {
        calls += 1;
        return new Response("no");
      },
    });
    expect(calls).toBe(0);
    expect(missing.sent).toBe(false);
    expect(missing.reason).toBe("missing_keys COUPANG_ACCESS_KEY=false COUPANG_SECRET_KEY=false");

    const failed = await probeShop("coupang", "耳機", {
      accessKey: "test-access-key",
      secretKey: "coupang-test-secret",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ rCode: "400", rMessage: "bad coupang-test-secret" }, { status: 200 });
      },
    });
    expect(calls).toBe(1);
    expect(failed.ok).toBe(false);
    expect(failed.parsed).toBe(false);
    expect(failed.httpStatus).toBe(200);
    expect(failed.reason).toContain("rcode_400");
    expect(failed.reason).not.toContain("coupang-test-secret");
    expect(JSON.stringify(failed)).not.toContain("test-access-key");
  });

  it("treats a Coupang verification page and an HTTP error as unsuccessful", async () => {
    const challenge = await probeShop("coupang", "耳機", {
      accessKey: "test-access-key",
      secretKey: "coupang-test-secret",
      fetchImpl: async () => new Response("<html><title>Just a moment</title>captcha</html>", { status: 200 }),
    });
    expect(challenge).toMatchObject({ sent: true, httpStatus: 200, parsed: false, ok: false, reason: "challenge" });

    let calls = 0;
    const denied = await probeShop("coupang", "耳機", {
      accessKey: "test-access-key",
      secretKey: "coupang-test-secret",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ rCode: "403", rMessage: "denied" }, { status: 403 });
      },
    });
    expect(calls).toBe(1);
    expect(denied).toMatchObject({ sent: true, httpStatus: 403, parsed: false, ok: false, reason: "http_403" });
  });

  it("requests Rakuten once at the fixed search URL and counts a parsed page", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const report = await probeShop("rakuten", " https://evil.example/x ", {
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(rakutenPage([rakutenItem]), { status: 200 });
      },
    });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin).toBe("https://www.rakuten.com.tw");
    expect(url.pathname).toBe("/search/https%3A%2F%2Fevil.example%2Fx/");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("accept-encoding")).toBe("gzip, deflate, br");
    expect(headers.get("referer")).toBe("https://www.rakuten.com.tw/");
    expect(headers.get("user-agent")).toContain("Chrome/131.0.0.0");
    expect(report).toMatchObject({ sent: true, httpStatus: 200, parsed: true, count: 1, ok: true, reason: null });
    expect(report.products[0]?.title).toBe("有線耳機");
    expect(report.products[0]?.price).toBe(160);
    expect(JSON.stringify(report)).not.toContain("evil.example");
  });

  it("counts an empty Rakuten list as parsed and a challenge page as not parsed", async () => {
    const empty = await probeShop("rakuten", "耳機", {
      fetchImpl: async () => new Response(rakutenPage([]), { status: 200 }),
    });
    expect(empty).toMatchObject({ ok: true, parsed: true, count: 0, httpStatus: 200 });

    const challenge = await probeShop("rakuten", "耳機", {
      fetchImpl: async () => new Response("<html>please verify you are human</html>", { status: 200 }),
    });
    expect(challenge).toMatchObject({ ok: false, parsed: false, httpStatus: 200, reason: "challenge" });

    const broken = await probeShop("rakuten", "耳機", {
      fetchImpl: async () => new Response("<html><title>樂天</title></html>", { status: 200 }),
    });
    expect(broken).toMatchObject({ ok: false, parsed: false, reason: "parse_error" });
  });

  it("keeps the probe on the published production app and on fixed fields", () => {
    expect(liveProbeEnabled({}, "production")).toBe(false);
    expect(liveProbeEnabled({ CURSOR_APP_ID: " app " }, "production")).toBe(true);
    expect(liveProbeEnabled({ CURSOR_APP_ID: "app" }, "preview")).toBe(false);
    expect(parseProbeBody({ platform: "coupang", keyword: " 耳機 ", url: "https://evil.example" })).toEqual({
      platform: "coupang",
      keyword: "耳機",
    });
    expect(parseProbeBody({ platform: "other", keyword: "耳機" })).toEqual({ error: "bad_request" });
    expect(parseProbeBody({ platform: "rakuten", keyword: "" })).toEqual({ error: "empty_keyword" });
    const local = { url: "http://localhost:3210/api/probe", host: "127.0.0.1:3210", forwardedHost: null };
    expect(sameOrigin(local, "http://127.0.0.1:3210")).toBe(true);
    expect(sameOrigin({ url: "https://shop.example/api/probe", host: "shop.example", forwardedHost: null }, "https://shop.example")).toBe(true);
    expect(sameOrigin({ url: "https://shop.example/api/probe", host: "shop.example", forwardedHost: null }, "https://evil.example")).toBe(false);
    expect(sameOrigin({ url: "https://shop.example/api/probe", host: "shop.example", forwardedHost: null }, "javascript:alert(1)")).toBe(false);
    expect(
      sameOrigin(
        { url: "https://internal.example/api/probe", host: "internal.example", forwardedHost: "shop-reach.apps.grok.bot" },
        "https://shop-reach.apps.grok.bot",
      ),
    ).toBe(true);
    expect(
      acceptsProbeCall({
        site: "same-origin",
        origin: "https://shop-reach.apps.grok.bot",
        url: "https://internal.example/api/probe",
        host: "internal.example",
        forwardedHost: null,
      }),
    ).toBe(true);
    expect(
      acceptsProbeCall({
        site: "cross-site",
        origin: "https://shop-reach.apps.grok.bot",
        url: "https://shop-reach.apps.grok.bot/api/probe",
        host: "shop-reach.apps.grok.bot",
        forwardedHost: null,
      }),
    ).toBe(false);
    expect(
      acceptsProbeCall({
        site: null,
        origin: null,
        url: "https://shop-reach.apps.grok.bot/api/probe",
        host: "shop-reach.apps.grok.bot",
        forwardedHost: null,
      }),
    ).toBe(true);

    resetProbeSlots();
    expect(beginProbe("user:1", "coupang", 1_000)).toBe("ok");
    expect(beginProbe("user:1", "coupang", 1_001)).toBe("busy");
    endProbe("user:1", "coupang");
    expect(beginProbe("user:1", "coupang", 2_000)).toBe("cooldown");
    expect(beginProbe("user:1", "rakuten", 2_000)).toBe("ok");
    expect(beginProbe("user:2", "coupang", 2_000)).toBe("ok");
    endProbe("user:1", "coupang");
    expect(beginProbe("user:1", "coupang", 5_000)).toBe("ok");
  });

  it("does not route the probe through the existing fetch proxy", () => {
    const probe = readFileSync("apps/shop-reach/lib/probe.ts", "utf8");
    const route = readFileSync("apps/shop-reach/app/api/probe/route.ts", "utf8");
    for (const source of [probe, route]) {
      expect(source).not.toContain("FETCH_PROXY");
      expect(source).not.toContain("callFetchProxy");
      expect(source).not.toContain("workers.dev");
    }
    expect(route).toContain("requireIdentity");
    expect(route).toContain("liveProbeEnabled");
    expect(route.indexOf("liveProbeEnabled")).toBeLessThan(route.indexOf("probeShop"));
  });
});
