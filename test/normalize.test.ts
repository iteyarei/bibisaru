import { describe, expect, it } from "vitest";
import { AFFILIATE_ENABLED, applyAffiliate } from "../shared/affiliate";
import {
  normalizeCoupang,
  normalizeMomo,
  normalizePchome,
  normalizeShopee,
  normalizeYahoo,
} from "../shared/normalize";
import { parsePrice } from "../shared/text";
import type { Product } from "../shared/types";

function momoPage(items: unknown[]): string {
  const json = JSON.stringify({ goodsInfoList: items });
  const escaped = json.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `<script>self.__next_f.push([1,"${escaped}"])</script>`;
}

const momoItem = {
  goodsCode: "14040053",
  goodsName: "輕巧入耳式耳機",
  goodsPrice: "$$1,290",
  goodsPriceModel: { basePrice: { price: "1,290" } },
  imgUrl: "https://img4.momoshop.com.tw/goodsimg/a.jpg",
  goodsUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=14040053",
  isAdultLimit: false,
};

describe("parsePrice", () => {
  it("reads store price strings", () => {
    expect(parsePrice(1290)).toBe(1290);
    expect(parsePrice("1,290")).toBe(1290);
    expect(parsePrice("$1,290")).toBe(1290);
    expect(parsePrice("$$2,690")).toBe(2690);
    expect(parsePrice(6450.4)).toBe(6450);
  });

  it("rejects missing or non-positive prices", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("熱銷一空")).toBeNull();
    expect(parsePrice(0)).toBeNull();
    expect(parsePrice(-1)).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe("normalizePchome", () => {
  const data = {
    prods: [
      {
        Id: "DYAQ9M-A900G43N8",
        name: "無線藍牙耳機",
        price: 1340,
        picB: "/items/DYAQ9MA900G43N8/000001.jpg",
        isNC17: 0,
      },
      { Id: "ADULT-1", name: "限制級", price: 999, picB: "/items/a.jpg", isNC17: 1 },
      { Id: "FREE-1", name: "詢價", price: 0, picB: "/items/b.jpg", isNC17: 0 },
    ],
  };

  it("keeps priced general goods and builds a PChome url", () => {
    const products = normalizePchome(data);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      platform: "pchome",
      title: "無線藍牙耳機",
      price: 1340,
      image: "https://img.pchome.com.tw/cs/items/DYAQ9MA900G43N8/000001.jpg",
      url: "https://24h.pchome.com.tw/prod/DYAQ9M-A900G43N8",
      rank: 0,
    });
  });
});

describe("normalizeYahoo", () => {
  it("reads the embedded search JSON and skips adult items", () => {
    const payload = {
      search: {
        ecsearch: {
          hits: [
            {
              ec_title: "AirPods Pro",
              ec_price: 6450,
              ec_image: "https://img.yec.tw/zp/a.jpg",
              ec_item_url: "https://tw.buy.yahoo.com/gdsale/airpods-11986319.html",
              ec_is_adult_product: 0,
            },
            {
              ec_title: "限制級",
              ec_price: 100,
              ec_image: "https://img.yec.tw/zp/b.jpg",
              ec_item_url: "https://tw.buy.yahoo.com/gdsale/adult.html",
              ec_is_adult_product: 1,
            },
            {
              ec_title: "不安全連結",
              ec_price: 100,
              ec_image: "https://img.yec.tw/zp/c.jpg",
              ec_item_url: "http://tw.buy.yahoo.com/gdsale/plain.html",
              ec_is_adult_product: 0,
            },
          ],
        },
      },
    };
    const html = `<script id="isoredux-data" type="mime/invalid">${JSON.stringify(payload)}</script>`;
    const products = normalizeYahoo(html);
    expect(products.map((product) => product.title)).toEqual(["AirPods Pro"]);
    expect(products[0].price).toBe(6450);
    expect(products[0].url).toContain("https://tw.buy.yahoo.com/");
  });
});

describe("normalizeMomo", () => {
  it("reads an escaped goods list, including brackets and quotes in the title", () => {
    const html = momoPage([
      momoItem,
      { ...momoItem, goodsCode: "9", goodsName: "成人用品", goodsPrice: "$$99", isAdultLimit: true, goodsUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=9" },
      {
        ...momoItem,
        goodsCode: "8",
        goodsName: '耳機 [公司貨] "特別"',
        goodsPrice: "$$880",
        goodsPriceModel: { basePrice: { price: "880" } },
        goodsUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=8",
      },
    ]);
    const products = normalizeMomo(html);
    expect(products.map((product) => product.title)).toEqual(["輕巧入耳式耳機", '耳機 [公司貨] "特別"']);
    expect(products[0].price).toBe(1290);
    expect(products[0].image).toContain("momoshop.com.tw");
    expect(products[1].price).toBe(880);
  });

  it("returns nothing when the page has no result list", () => {
    expect(normalizeMomo("<html><title>Access Denied</title></html>")).toEqual([]);
  });
});

describe("normalizeCoupang", () => {
  it("uses the sale price, not the struck-through price", () => {
    const html = `
      <ul id="product-list">
        <li class="ProductUnit_productUnit__abc" data-id="1">
          <a href="/products/earbuds-1?itemId=2&amp;q=%E8%80%B3%E6%A9%9F">
            <img alt="真無線耳機" src="//thumbnail.coupangcdn.com/thumbnails/remote/a.jpg"/>
            <div class="ProductUnit_productNameV2__x">真無線耳機</div>
            <del>$590</del>
            <span translate="no">$539</span>
          </a>
        </li>
      </ul>`;
    const products = normalizeCoupang(html);
    expect(products).toHaveLength(1);
    const product = products[0] as Product;
    expect(product.price).toBe(539);
    expect(product.title).toBe("真無線耳機");
    expect(product.image).toBe("https://thumbnail.coupangcdn.com/thumbnails/remote/a.jpg");
    const url = new URL(product.url);
    expect(url.hostname).toBe("www.tw.coupang.com");
    expect(url.pathname).toBe("/products/earbuds-1");
    expect(url.searchParams.get("itemId")).toBe("2");
  });
});

describe("normalizeShopee", () => {
  it("converts the 100000-unit price and builds a product url", () => {
    const products = normalizeShopee({
      items: [
        {
          item_basic: {
            itemid: 42,
            shopid: 7,
            name: "藍牙耳機",
            price: 129_000_000,
            image: "tw-11134207-example",
          },
        },
      ],
    });
    expect(products[0]).toMatchObject({
      platform: "shopee",
      title: "藍牙耳機",
      price: 1290,
      image: "https://down-tw.img.susercontent.com/file/tw-11134207-example",
      url: "https://shopee.tw/-i.7.42",
    });
  });

  it("does not invent items from an error payload", () => {
    expect(normalizeShopee({ error: 90309999 })).toEqual([]);
  });
});

describe("affiliate switch", () => {
  it("stays off and does not rewrite urls", () => {
    expect(AFFILIATE_ENABLED).toBe(false);
    const url = "https://24h.pchome.com.tw/prod/ABC";
    expect(applyAffiliate(url)).toBe(url);
  });
});
