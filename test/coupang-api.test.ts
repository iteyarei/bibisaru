import { afterEach, describe, expect, it } from "vitest";
import { coupangSearchAffiliateUrl } from "../shared/affiliate";
import {
  coupangAuthorization,
  coupangHmacHex,
  coupangSearchQuery,
  coupangSignedDate,
  coupangSignMessage,
  COUPANG_API_ORIGIN,
  COUPANG_API_PATH,
  productsFromCoupangSearch,
  searchCoupangPartners,
} from "../shared/coupang-api";
import { prepareResults } from "../shared/filter";
import { fetchers } from "../functions/lib/providers";

/**
 * Independent of the Web Crypto helper. Produced with Node `crypto.createHmac("sha256")`
 * for secret `coupang-test-secret` and the message below.
 */
const SIGNATURE_VECTOR = {
  secret: "coupang-test-secret",
  signedDate: "260101T000000Z",
  message:
    "260101T000000ZGET/v2/providers/affiliate_open_api/apis/openapi/products/searchkeyword=%E9%9B%BB%E9%8D%8B&limit=10&subId=bibisaru",
  hex: "bcd1e081c3bd24fd345eed65b598086db649bf4ffddb4d36b08d7ac46c01165f",
};

const ACCESS_KEY = "test-access-key";
const PRODUCT_URL = "https://link.tw.coupang.com/re2/AFFSDP?lptag=AF6766993&pageKey=123&itemId=9";

function envBag(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) throw new Error("missing process.env");
  return proc.env;
}

const originalAccess = envBag().COUPANG_ACCESS_KEY;
const originalSecret = envBag().COUPANG_SECRET_KEY;

afterEach(() => {
  if (originalAccess === undefined) delete envBag().COUPANG_ACCESS_KEY;
  else envBag().COUPANG_ACCESS_KEY = originalAccess;
  if (originalSecret === undefined) delete envBag().COUPANG_SECRET_KEY;
  else envBag().COUPANG_SECRET_KEY = originalSecret;
});

function partnerPayload() {
  return {
    rCode: "0",
    rMessage: "OK",
    data: {
      productData: [
        {
          productId: 101,
          productName: "大同電鍋 10人份",
          productPrice: 2480,
          firstPurchasePrice: 1990,
          productImage: "https://thumbnail.coupangcdn.com/thumbnails/remote/pot.jpg",
          productUrl: PRODUCT_URL,
          isRocket: true,
        },
        {
          productId: 102,
          productName: "大同 不鏽鋼電鍋 二手",
          productPrice: 1500,
          firstPurchasePrice: 900,
          productImage: "https://thumbnail.coupangcdn.com/thumbnails/remote/used.jpg",
          productUrl: "https://link.tw.coupang.com/re2/AFFSDP?lptag=AF6766993&pageKey=456",
          isRocket: false,
        },
        {
          productId: 103,
          productName: "象印電鍋",
          productPrice: 8900,
          productImage: "https://thumbnail.coupangcdn.com/thumbnails/remote/other.jpg",
          productUrl: "https://link.tw.coupang.com/re2/AFFSDP?lptag=AF6766993&pageKey=789",
          isRocket: false,
        },
      ],
    },
  };
}

describe("coupang partners signature", () => {
  it("matches the HMAC-SHA256 test vector", async () => {
    expect(coupangSignedDate(new Date("2026-01-01T00:00:00.000Z"))).toBe(SIGNATURE_VECTOR.signedDate);
    const query = coupangSearchQuery("電鍋");
    expect(query).toBe("keyword=%E9%9B%BB%E9%8D%8B&limit=10&subId=bibisaru");
    expect(query.includes("?")).toBe(false);
    const message = coupangSignMessage(SIGNATURE_VECTOR.signedDate, query);
    expect(message).toBe(SIGNATURE_VECTOR.message);
    expect(await coupangHmacHex(SIGNATURE_VECTOR.secret, message)).toBe(SIGNATURE_VECTOR.hex);
    expect(coupangAuthorization(ACCESS_KEY, SIGNATURE_VECTOR.signedDate, SIGNATURE_VECTOR.hex)).toBe(
      `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${SIGNATURE_VECTOR.signedDate}, signature=${SIGNATURE_VECTOR.hex}`,
    );
  });

  it("encodes a space in the keyword the same way it is sent", () => {
    expect(coupangSearchQuery("電 鍋")).toBe(
      `keyword=${encodeURIComponent("電 鍋")}&limit=10&subId=bibisaru`,
    );
  });
});

describe("coupang partners search", () => {
  it("sends a signed request and keeps productUrl and productPrice", async () => {
    const seen: Array<{ url: string; authorization: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), authorization: headers.get("authorization") ?? "" });
      return new Response(JSON.stringify(partnerPayload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const products = await searchCoupangPartners("電鍋", {
      fetchImpl,
      now: new Date("2026-01-01T00:00:00.000Z"),
      accessKey: ACCESS_KEY,
      secretKey: SIGNATURE_VECTOR.secret,
    });

    expect(seen).toHaveLength(1);
    const call = seen[0];
    expect(call?.url).toBe(
      `${COUPANG_API_ORIGIN}${COUPANG_API_PATH}?keyword=${encodeURIComponent("電鍋")}&limit=10&subId=bibisaru`,
    );
    expect(call?.url.includes(ACCESS_KEY)).toBe(false);
    expect(call?.url.includes(SIGNATURE_VECTOR.secret)).toBe(false);
    expect(call?.authorization.includes(SIGNATURE_VECTOR.secret)).toBe(false);
    expect(call?.authorization).toBe(
      `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${SIGNATURE_VECTOR.signedDate}, signature=${SIGNATURE_VECTOR.hex}`,
    );

    expect(products).toHaveLength(3);
    expect(products?.[0]).toMatchObject({
      platform: "coupang",
      title: "大同電鍋 10人份",
      price: 2480,
      image: "https://thumbnail.coupangcdn.com/thumbnails/remote/pot.jpg",
      url: PRODUCT_URL,
      rank: 0,
    });
    expect(products?.[0]?.url).toBe(PRODUCT_URL);

    const visible = prepareResults(products ?? [], {
      keywords: ["二手"],
      platforms: ["coupang"],
      sort: "price-asc",
      query: "大同電鍋",
      priceMin: null,
      priceMax: 3000,
    });
    expect(visible.map((product) => product.title)).toEqual(["大同電鍋 10人份"]);
    expect(visible[0]?.price).toBe(2480);
  });

  it("treats HTTP 200 with rCode other than 0 as failure", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ rCode: "400", rMessage: "bad request", data: {} }), { status: 200 });
    const products = await searchCoupangPartners("電鍋", {
      fetchImpl,
      now: new Date("2026-01-01T00:00:00.000Z"),
      accessKey: ACCESS_KEY,
      secretKey: SIGNATURE_VECTOR.secret,
    });
    expect(products).toBeNull();
    expect(productsFromCoupangSearch({ rCode: "0", data: { productData: [] } })).toEqual([]);
  });

  it("does not call fetch when the keys are missing", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      throw new Error("fetch should not run");
    };
    expect(
      await searchCoupangPartners("電鍋", { fetchImpl, accessKey: null, secretKey: SIGNATURE_VECTOR.secret }),
    ).toBeNull();
    expect(
      await searchCoupangPartners("電鍋", { fetchImpl, accessKey: "  ", secretKey: "  " }),
    ).toBeNull();
    expect(called).toBe(false);

    delete envBag().COUPANG_ACCESS_KEY;
    delete envBag().COUPANG_SECRET_KEY;
    const result = await fetchers.coupang("電鍋");
    expect(result.status).toBe("unavailable");
    expect(result.products).toEqual([]);
    expect(result.searchUrl).toBe(coupangSearchAffiliateUrl("電鍋"));
    expect(called).toBe(false);
  });
});
