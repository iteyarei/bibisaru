import { applyAffiliate } from "./affiliate";
import { MAX_PER_PLATFORM } from "./platforms";
import type { PlatformId, Product } from "./types";
import {
  canonicalImageUrl,
  canonicalProductUrl,
  cleanTitle,
  decodeHtml,
  jsUnescape,
  knownSoldOut,
  parseJsonArrayPrefix,
  parsePrice,
} from "./text";

interface Draft {
  title: string;
  price: number | null;
  image: string;
  url: string;
  skip?: boolean;
}

function makeProduct(platform: PlatformId, draft: Draft, rank: number): Product | null {
  if (draft.skip) return null;
  const title = cleanTitle(draft.title);
  if (!title || draft.price === null) return null;
  const url = canonicalProductUrl(platform, draft.url);
  if (!url) return null;
  return {
    platform,
    title,
    price: draft.price,
    image: canonicalImageUrl(draft.image),
    url: applyAffiliate(url),
    rank,
  };
}

function collect(platform: PlatformId, drafts: Draft[]): Product[] {
  const products: Product[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < drafts.length && products.length < MAX_PER_PLATFORM; index += 1) {
    const product = makeProduct(platform, drafts[index], index);
    if (!product || seen.has(product.url)) continue;
    seen.add(product.url);
    products.push(product);
  }
  return products;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function normalizePchome(data: unknown): Product[] {
  const prods = asRecord(data)?.prods;
  if (!Array.isArray(prods)) return [];
  return collect(
    "pchome",
    prods.slice(0, 80).map((item) => {
      const row = asRecord(item) ?? {};
      const id = String(row.Id ?? "");
      const pic = String(row.picB || row.picS || "");
      const image = pic.startsWith("http")
        ? pic
        : pic
          ? `https://img.pchome.com.tw/cs${pic.startsWith("/") ? "" : "/"}${pic}`
          : "";
      return {
        title: String(row.name ?? ""),
        price: parsePrice(row.price),
        image,
        url: id ? `https://24h.pchome.com.tw/prod/${encodeURIComponent(id)}` : "",
        skip: row.isNC17 === 1 || row.isNC17 === "1",
      };
    }),
  );
}

export function normalizeYahoo(html: string): Product[] {
  return yahooProducts(html) ?? [];
}

/** `null` when the embedded result list is missing, so the caller can treat it as a failure. */
export function yahooProducts(html: string): Product[] | null {
  const found = readYahooHits(html);
  if (!found) return null;
  return collect("yahoo", found);
}

export function readYahooHits(html: string): Draft[] | null {
  const marker = 'id="isoredux-data"';
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) return null;
  const start = html.indexOf(">", markerAt);
  const end = start >= 0 ? html.indexOf("</script>", start) : -1;
  if (start < 0 || end < 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(html.slice(start + 1, end));
  } catch {
    return null;
  }
  const hits = asRecord(asRecord(asRecord(data)?.search)?.ecsearch)?.hits;
  if (!Array.isArray(hits)) return null;
  return hits.slice(0, 80).map((item) => {
    const row = asRecord(item) ?? {};
    return {
      title: String(row.ec_title ?? ""),
      price: parsePrice(row.ec_price),
      image: String(row.ec_image ?? ""),
      url: String(row.ec_item_url ?? ""),
      skip:
        row.ec_is_adult_product === 1 ||
        row.ec_is_adult_product === "1" ||
        row.ec_has_stock === 0 ||
        row.ec_has_stock === "0" ||
        knownSoldOut(row.ec_stockcount),
    };
  });
}

export function normalizeMomo(html: string): Product[] {
  return momoProducts(html) ?? [];
}

/** `null` when the result list is missing from the page. */
export function momoProducts(html: string): Product[] | null {
  const list = readMomoList(html);
  if (!list) return null;
  return momoDrafts(list);
}

export function readMomoList(html: string): unknown[] | null {
  return extractJsonArray(html, "goodsInfoList");
}

function momoDrafts(list: unknown[]): Product[] {
  return collect(
    "momo",
    list.slice(0, 80).map((item) => {
      const row = asRecord(item) ?? {};
      const code = String(row.goodsCode ?? "").trim();
      const given = String(row.goodsUrl ?? "").trim();
      const url =
        given ||
        (code ? `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${encodeURIComponent(code)}` : "");
      return {
        title: String(row.goodsName ?? ""),
        price: momoPrice(row),
        image: String(row.imgUrl ?? ""),
        url,
        skip: row.isAdultLimit === true || knownSoldOut(row.goodsStock),
      };
    }),
  );
}

function momoPrice(row: Record<string, unknown>): number | null {
  const model = asRecord(row.goodsPriceModel);
  const base = asRecord(model?.basePrice);
  return parsePrice(base?.price) ?? parsePrice(row.goodsPrice) ?? parsePrice(row.SALE_PRICE);
}

export function normalizeCoupang(html: string): Product[] {
  const blocks = coupangBlocks(html);
  return collect(
    "coupang",
    blocks.map((block) => {
      const href = /href="(\/products\/[^"]+)"/.exec(block);
      const name = /ProductUnit_productName[^"]*"[^>]*>([^<]+)/.exec(block);
      const alt = /<img[^>]*alt="([^"]*)"/.exec(block);
      const image = /src="((?:https?:)?\/\/thumbnail[^"]+)"/.exec(block);
      const withoutOriginal = block.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, "");
      const explicit = /<span[^>]*translate="no"[^>]*>\s*\$([0-9,]+)\s*<\/span>/.exec(withoutOriginal);
      const fallback = /\$([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/.exec(withoutOriginal);
      const path = href ? decodeHtml(href[1]) : "";
      return {
        title: name?.[1] ?? alt?.[1] ?? "",
        price: parsePrice(explicit?.[1] ?? fallback?.[1] ?? null),
        image: image?.[1] ?? "",
        url: path ? `https://www.tw.coupang.com${path}` : "",
      };
    }),
  );
}

export function coupangHasList(html: string): boolean {
  return html.includes('id="product-list"') || html.includes("ProductUnit_productUnit");
}

function coupangBlocks(html: string): string[] {
  const byClass = html.split('<li class="ProductUnit_productUnit');
  if (byClass.length > 1) return byClass.slice(1, 81);
  const listAt = html.indexOf('id="product-list"');
  if (listAt < 0) return [];
  return html.slice(listAt, listAt + 500_000).split(/<li\b/i).slice(1, 81);
}

export function normalizePxgo(data: unknown): Product[] {
  const payload = asRecord(asRecord(data)?.data) ?? asRecord(data);
  const products = payload?.product_list;
  if (!Array.isArray(products)) return [];
  return collect(
    "pxgo",
    products.slice(0, 80).map((item) => {
      const row = asRecord(item) ?? {};
      const id = row.id;
      return {
        title: String(row.product_name ?? ""),
        price: parsePrice(row.sale_price),
        image: String(row.picture || row.first_product_picture || ""),
        url: id === undefined || id === null || String(id) === ""
          ? ""
          : `https://pxbox.es.pxmart.com.tw/product/${encodeURIComponent(String(id))}`,
        skip: row.is_upcoming_product === true || row.is_sold_out === true || knownSoldOut(row.stock),
      };
    }),
  );
}

export function pxgoProducts(data: unknown): Product[] | null {
  const payload = asRecord(asRecord(data)?.data) ?? asRecord(data);
  if (!payload || !Array.isArray(payload.product_list)) return null;
  return normalizePxgo(data);
}

export function normalizeEtmall(data: unknown): Product[] {
  const products = asRecord(asRecord(data)?.SearchProductResult)?.products;
  if (!Array.isArray(products)) return [];
  return collect(
    "etmall",
    products.slice(0, 80).map((item) => {
      const row = asRecord(item) ?? {};
      const link = String(row.pageLink ?? "");
      const url = link.startsWith("https://")
        ? link
        : link.startsWith("/")
          ? `https://www.etmall.com.tw${link}`
          : "";
      return {
        title: String(row.title ?? ""),
        price: parsePrice(row.finalPrice),
        image: String(row.imageUrl ?? ""),
        url,
        skip:
          row.isAgeRating === true ||
          row.purchasable === false ||
          row.haveStocks === false ||
          row.haveStocks === "false" ||
          row.haveStocks === "False",
      };
    }),
  );
}

export function etmallProducts(data: unknown): Product[] | null {
  const products = asRecord(asRecord(data)?.SearchProductResult)?.products;
  if (!Array.isArray(products)) return null;
  return normalizeEtmall(data);
}

export function normalizeKingstone(html: string): Product[] {
  return kingstoneProducts(html) ?? [];
}

export function kingstoneProducts(html: string): Product[] | null {
  if (!html.includes('class="displayunit"')) return null;
  const chunks = html.split('class="displayunit"').slice(1, 81);
  return collect(
    "kingstone",
    chunks.map((chunk) => {
      const href = /href="\/basic\/(\d+)/.exec(chunk);
      const title = /<h3 class="pdnamebox">\s*<a\b[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
      const image = /<img\b[^>]*\ssrc="(https:[^"]+)"/.exec(chunk);
      const price = /(?:特價|定價|優惠價)<b>([\d,]+)<\/b>/.exec(chunk);
      return {
        title: title?.[1] ?? "",
        price: parsePrice(price?.[1] ?? null),
        image: image?.[1] ?? "",
        url: href ? `https://www.kingstone.com.tw/basic/${href[1]}/` : "",
        skip: /貨到通知|缺貨|已售完|無庫存/.test(chunk),
      };
    }),
  );
}

export function normalizeSanmin(html: string): Product[] {
  return sanminProducts(html) ?? [];
}

export function sanminProducts(html: string): Product[] | null {
  if (!html.includes('class="sProduct"')) return null;
  const chunks = html.split('class="sProduct"').slice(1, 81);
  return collect(
    "sanmin",
    chunks.map((chunk) => {
      const href = /href="\/product\/index\/(\d+)"/.exec(chunk);
      const title = /<h3>([\s\S]*?)<\/h3>/.exec(chunk);
      const image = /data-src="(https:[^"]+)"/.exec(chunk);
      const sale = /class="Price\s*"[^>]*>([\d,]+)/.exec(chunk);
      const list = /class="ListPrice"[^>]*>[\s\S]*?([\d,]{2,})/.exec(chunk);
      const stockHtml = /class="Stock\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? "";
      const stockText = decodeHtml(stockHtml.replace(/<[^>]*>/g, "")).replace(/\s+/g, "");
      return {
        title: title?.[1] ?? "",
        price: parsePrice(sale?.[1] ?? list?.[1] ?? null),
        image: image?.[1] ?? "",
        url: href ? `https://www.sanmin.com.tw/product/index/${href[1]}` : "",
        skip: stockText.includes("無庫存") || /^庫存[:：]0(?:$|[^0-9])/.test(stockText),
      };
    }),
  );
}

export function normalizeShopee(data: unknown): Product[] {
  const items = asRecord(data)?.items;
  if (!Array.isArray(items)) return [];
  return collect(
    "shopee",
    items.slice(0, 80).map((item) => {
      const basic = asRecord(asRecord(item)?.item_basic);
      if (!basic) return { title: "", price: null, image: "", url: "" };
      const shopId = basic.shopid;
      const itemId = basic.itemid;
      const rawPrice = typeof basic.price === "number" ? Math.round(basic.price / 100_000) : null;
      const imageKey = String(basic.image ?? "");
      const image = imageKey.startsWith("http")
        ? imageKey
        : imageKey
          ? `https://down-tw.img.susercontent.com/file/${imageKey}`
          : "";
      return {
        title: String(basic.name ?? ""),
        price: parsePrice(rawPrice),
        image,
        url: shopId && itemId ? `https://shopee.tw/-i.${shopId}.${itemId}` : "",
      };
    }),
  );
}

function extractJsonArray(html: string, key: string): unknown[] | null {
  const markers = [`\\"${key}\\":`, `"${key}":`];
  for (const marker of markers) {
    const escaped = marker.startsWith("\\");
    let from = 0;
    while (from < html.length) {
      const at = html.indexOf(marker, from);
      if (at < 0) break;
      const bracket = at + marker.length;
      if (html[bracket] !== "[") {
        from = bracket;
        continue;
      }
      const scriptEnd = html.indexOf("</script>", bracket);
      const cap = Math.min(html.length, bracket + 300_000);
      const sliceEnd = scriptEnd === -1 ? cap : Math.min(scriptEnd, cap);
      const raw = html.slice(bracket, sliceEnd);
      const text = escaped ? jsUnescape(raw) : raw;
      try {
        const parsed = parseJsonArrayPrefix(text);
        if (parsed) return parsed;
      } catch {
        // Keep looking. A later copy of the list may be intact.
      }
      from = bracket;
    }
  }
  return null;
}
