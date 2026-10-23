import { describe, expect, it } from "vitest";
import { applyAffiliate, shopeeAffiliateUrl } from "../shared/affiliate";
import { filterBySearchTerms } from "../shared/filter";
import {
  kingstoneProducts,
  normalizeCoupang,
  normalizeEtmall,
  normalizeMomo,
  normalizePchome,
  normalizePxgo,
  normalizeShopee,
  normalizeYahoo,
  rakutenProducts,
  rutenProducts,
  rutenSearchIds,
  sanminProducts,
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
      {
        Id: "DYALS9-A900K9ONE",
        name: "Galaxy Z Fold8 (12G/512G)",
        describe: "Samsung Galaxy Z Fold8 (12G/512G)\\r\\n",
        price: 57900,
        picB: "/items/DYALS9A900K9ONE/000001.jpg",
        isNC17: 0,
      },
      {
        Id: "LONG-1",
        name: "Go POP +真無線藍牙耳機",
        describe: "CP值再升級 !美國 100美元以下耳機銷售冠軍JLab Go POP +真無線藍牙耳機\r\n單次電力8H+",
        price: 799,
        picB: "/items/long.jpg",
        isNC17: 0,
      },
    ],
  };

  it("keeps priced general goods and builds a PChome url", () => {
    const products = normalizePchome(data);
    expect(products).toHaveLength(3);
    expect(products[0]).toMatchObject({
      platform: "pchome",
      title: "無線藍牙耳機",
      price: 1340,
      image: "https://img.pchome.com.tw/cs/items/DYAQ9MA900G43N8/000001.jpg",
      url: "https://24h.pchome.com.tw/prod/DYAQ9M-A900G43N8",
      rank: 0,
    });
    expect(products[1]?.title).toBe("Samsung Galaxy Z Fold8 (12G/512G)");
    expect(products[2]?.title).toBe("Go POP +真無線藍牙耳機");
    expect(filterBySearchTerms(products, "samsung fold8 512").map((product) => product.title)).toEqual([
      "Samsung Galaxy Z Fold8 (12G/512G)",
    ]);
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
    expect(products[0].url).toBe(
      `https://product.mchannles.com/redirect_wa.php?k=2IsZi&uid1=bibisaru&tourl=${encodeURIComponent("https://tw.buy.yahoo.com/gdsale/airpods-11986319.html")}`,
    );
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
    expect(url.origin + url.pathname).toBe("https://link.tw.coupang.com/re2/AFFSDP");
    expect(url.searchParams.get("lptag")).toBe("AF6766993");
    expect(url.searchParams.get("pageKey")).toBe("earbuds-1");
    expect(url.searchParams.get("itemId")).toBe("2");
    expect(url.searchParams.has("traceid")).toBe(false);
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
      url: shopeeAffiliateUrl("https://shopee.tw/-i.7.42"),
    });
  });

  it("does not invent items from an error payload", () => {
    expect(normalizeShopee({ error: 90309999 })).toEqual([]);
  });
});

describe("newer storefronts", () => {
  it("reads 全聯 sale price and product id", () => {
    const products = normalizePxgo({
      data: {
        product_list: [
          {
            id: 2655,
            product_name: "光泉保久乳",
            sale_price: 436,
            picture: "https://img-pxbox.es.pxmart.com.tw/milk.png",
            is_upcoming_product: false,
          },
          { id: 9, product_name: "尚未開賣", sale_price: 100, picture: "", is_upcoming_product: true },
        ],
      },
    });
    expect(products).toEqual([
      {
        platform: "pxgo",
        title: "光泉保久乳",
        price: 436,
        image: "https://img-pxbox.es.pxmart.com.tw/milk.png",
        url: "https://pxbox.es.pxmart.com.tw/product/2655",
        rank: 0,
      },
    ]);
  });

  it("uses 東森 final price and skips adult or unbuyable rows", () => {
    const products = normalizeEtmall({
      SearchProductResult: {
        products: [
          {
            id: 7926508,
            title: "藍牙耳機",
            imageUrl: "//media.etmall.com.tw/nximg/a.jpg",
            pageLink: "/i/7926508",
            marketingPrice: "8980",
            finalPrice: "2980",
            isAgeRating: false,
            purchasable: true,
          },
          {
            title: "限制級",
            finalPrice: "100",
            pageLink: "/i/1",
            isAgeRating: true,
            purchasable: true,
          },
        ],
      },
    });
    expect(products[0]).toMatchObject({
      platform: "etmall",
      title: "藍牙耳機",
      price: 2980,
      image: "https://media.etmall.com.tw/nximg/a.jpg",
      url: "https://www.etmall.com.tw/i/7926508",
    });
    expect(products).toHaveLength(1);
  });

  it("drops listings the storefront marks as sold out", () => {
    const momo = normalizeMomo(
      momoPage([
        { ...momoItem, goodsStock: "12" },
        { ...momoItem, goodsCode: "8", goodsName: "已售完耳機", goodsStock: "0", goodsUrl: "https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=8" },
      ]),
    );
    expect(momo.map((product) => product.title)).toEqual(["輕巧入耳式耳機"]);

    const yahoo = normalizeYahoo(
      `<script id="isoredux-data" type="application/json">${JSON.stringify({
        search: {
          ecsearch: {
            hits: [
              {
                ec_title: "有貨",
                ec_price: 100,
                ec_image: "https://img.yec.tw/a.jpg",
                ec_item_url: "https://tw.buy.yahoo.com/gdsale/a.html",
                ec_has_stock: "1",
                ec_stockcount: "3",
              },
              {
                ec_title: "缺貨",
                ec_price: 80,
                ec_image: "https://img.yec.tw/b.jpg",
                ec_item_url: "https://tw.buy.yahoo.com/gdsale/b.html",
                ec_has_stock: "0",
                ec_stockcount: "0",
              },
            ],
          },
        },
      })}</script>`,
    );
    expect(yahoo.map((product) => product.title)).toEqual(["有貨"]);

    const px = normalizePxgo({
      data: {
        product_list: [
          { id: 1, product_name: "有貨", sale_price: 50, picture: "https://img-pxbox.es.pxmart.com.tw/a.png", stock: 2, is_sold_out: false },
          { id: 2, product_name: "售完", sale_price: 40, picture: "https://img-pxbox.es.pxmart.com.tw/b.png", stock: 0, is_sold_out: true },
        ],
      },
    });
    expect(px.map((product) => product.title)).toEqual(["有貨"]);

    const et = normalizeEtmall({
      SearchProductResult: {
        products: [
          { title: "有貨", finalPrice: "100", pageLink: "/i/1", imageUrl: "", haveStocks: true, purchasable: true },
          { title: "售完", finalPrice: "90", pageLink: "/i/2", imageUrl: "", haveStocks: false, purchasable: true },
        ],
      },
    });
    expect(et.map((product) => product.title)).toEqual(["有貨"]);

    const kingstone = kingstoneProducts(`
      <div class="displayunit"><h3 class="pdnamebox"><a href="/basic/1/">有貨</a></h3><span>特價<b>100</b>元</span>加入購物車</div>
      <div class="displayunit"><h3 class="pdnamebox"><a href="/basic/2/">售完</a></h3><span>特價<b>90</b>元</span>貨到通知</div>`);
    expect(kingstone?.map((product) => product.title)).toEqual(["有貨"]);

    const sanmin = sanminProducts(`
      <div class="sProduct"><a href="/product/index/1"><h3>有貨</h3></a><span class="Price ">100</span><div class="Stock">庫存：2</div></div>
      <div class="sProduct"><a href="/product/index/2"><h3>售完</h3></a><span class="Price ">80</span><div class="Stock">無庫存</div></div>`);
    expect(sanmin?.map((product) => product.title)).toEqual(["有貨"]);
  });

  it("reads 金石堂 sale price from the result card", () => {
    const html = `
      <div class="displayunit">
        <img src="https://cdn.kingstone.com.tw/a.jpg" alt="惠普耳機">
        <h3 class="pdnamebox"><a href="/basic/3030000102785/?lid=search">惠普耳機</a></h3>
        <span>特價<b>699</b>元</span>
      </div>`;
    expect(kingstoneProducts(html)?.[0]).toMatchObject({
      platform: "kingstone",
      title: "惠普耳機",
      price: 699,
      url: `https://product.mchannles.com/redirect_wa.php?k=2IsZi&uid1=bibisaru&tourl=${encodeURIComponent("https://www.kingstone.com.tw/basic/3030000102785/")}`,
    });
    expect(kingstoneProducts("<html></html>")).toBeNull();
  });

  it("prefers 三民 discount price over list price", () => {
    const html = `
      <div class="sProduct">
        <a href="/product/index/004113511"><h3>BIDENUO耳機</h3></a>
        <img data-src="https://cdnec.sanmin.com.tw/product_images/677/a.jpg" />
        <span class="ListPrice">定價：600 元</span>
        <span class="Price ">360</span>
      </div>
      <div class="sProduct">
        <a href="/product/index/004100001"><h3>只有定價</h3></a>
        <span class="ListPrice">定價：200 元</span>
      </div>`;
    const products = sanminProducts(html);
    expect(products?.map((product) => product.price)).toEqual([360, 200]);
    expect(products?.[0]?.url).toBe("https://www.sanmin.com.tw/product/index/004113511");
    expect(sanminProducts("<html>no list</html>")).toBeNull();
  });
});

describe("affiliate switch", () => {
  it("does not rewrite shops without a program", () => {
    const url = "https://24h.pchome.com.tw/prod/ABC";
    expect(applyAffiliate(url)).toBe(url);
  });
});

function rakutenPage(items: unknown[]): string {
  const data = { initialData: { searchPage: { result: { items } } } };
  return `<html><script type="application/json" class="js-react-on-rails-component" data-component-name="SearchPage" data-dom-id="x">${JSON.stringify(data).replace(/</g, "\\u003c")}</script></html>`;
}

const rakutenItem = {
  itemName: "POLYWELL 3.5mm耳塞式有線耳機麥克風",
  itemUrl: "https://www.rakuten.com.tw/shop/polywell/product/f88b3l6sa/?s-id=RADSearch_ProductAd_01",
  itemPrice: { min: 160, max: 160 },
  itemListPrice: { min: 399, max: 399 },
  itemImageUrl: "https://tshop.r10s.com/7a8/a.png?_ex=400x400",
  itemStatus: "Available",
  shopName: "POLYWELL 寶利威爾官方旗艦店",
  review: { reviewScore: 5, reviewCount: 2 },
  adFlag: true,
};

function viaIchannels(url: string): string {
  return `https://product.mchannles.com/redirect_wa.php?k=2IsZi&uid1=bibisaru&tourl=${encodeURIComponent(url)}`;
}

describe("樂天", () => {
  it("reads the embedded SearchPage JSON, drops s-id, and wraps the visitor link", () => {
    const products = rakutenProducts(
      rakutenPage([
        rakutenItem,
        {
          ...rakutenItem,
          itemName: "區間價耳機",
          itemUrl: "https://www.rakuten.com.tw/shop/a/product/b/",
          itemPrice: { min: 451, max: 506 },
        },
        { ...rakutenItem, itemName: "已下架耳機", itemStatus: "SoldOut" },
        { ...rakutenItem, itemName: "網址不是樂天", itemUrl: "https://evil.example/x" },
      ]),
    );
    expect(products?.map((product) => product.title)).toEqual(["POLYWELL 3.5mm耳塞式有線耳機麥克風", "區間價耳機"]);
    expect(products?.[0]).toMatchObject({
      platform: "rakuten",
      price: 160,
      image: "https://tshop.r10s.com/7a8/a.png?_ex=400x400",
      url: viaIchannels("https://www.rakuten.com.tw/shop/polywell/product/f88b3l6sa/"),
    });
    expect(products?.[0]?.url).not.toContain("s-id");
    expect(products?.[1]?.price).toBe(451);
  });

  it("returns null when the SearchPage JSON or its item list is missing", () => {
    expect(rakutenProducts("<html></html>")).toBeNull();
    expect(rakutenProducts(rakutenPage([]))).toEqual([]);
    expect(
      rakutenProducts('<script data-component-name="SearchPage">{not json</script>'),
    ).toBeNull();
    expect(
      rakutenProducts('<script data-component-name="SearchPage">{"initialData":{}}</script>'),
    ).toBeNull();
  });
});

describe("露天", () => {
  const search = {
    TotalRows: 3,
    Rows: [{ Id: "22324948234766", R18: 0 }, { Id: "22509824206099", R18: 0 }, { Id: "99", R18: 1 }, { Id: "bad" }],
  };
  const detail = [
    {
      ProdId: "22509824206099",
      ProdName: "安全帽藍芽耳機",
      PriceRange: [246, 789],
      Image: "/g4/47f/e86/x/1/7d/13/22509824206099_994_m.jpg",
      StockQty: 281,
      SoldQty: 19,
      ShippingCost: 60,
      SaleType: "buy",
    },
    {
      ProdId: "22324948234766",
      ProdName: "Redmi Buds 8 Active",
      PriceRange: [509, 509],
      Image: "/g5/411/ab6/q/0/12/0e/22324948234766_459_m.jpg",
      StockQty: 297,
      SoldQty: 324,
      ShippingCost: 60,
      SaleType: "buy",
    },
    { ProdId: "1", ProdName: "沒庫存", PriceRange: [10, 10], Image: "", StockQty: 0, SaleType: "buy" },
    { ProdId: "2", ProdName: "競標品", PriceRange: [10, 10], Image: "", StockQty: 1, SaleType: "bid" },
  ];

  it("keeps the search ids that are safe to look up", () => {
    expect(rutenSearchIds(search)).toEqual(["22324948234766", "22509824206099"]);
    expect(rutenSearchIds({ TotalRows: 0, Rows: [] })).toEqual([]);
    expect(rutenSearchIds({})).toBeNull();
  });

  it("uses b.rimg.com.tw for /c… image folders and gcs.rimg.com.tw for /g… ones", () => {
    const rows = [
      { ProdId: "1", ProdName: "甲", PriceRange: [10], Image: "/c1/0ed/1c4/x/3/cc/1_109_m.jpg", SaleType: "buy", StockQty: 3 },
      { ProdId: "2", ProdName: "乙", PriceRange: [20], Image: "/g4/59d/ccc/y/4/01/7a/2_707_m.jpg", SaleType: "buy", StockQty: 3 },
    ];
    const products = rutenProducts(rows, ["1", "2"]);
    expect(products?.[0]?.image).toBe("https://b.rimg.com.tw/c1/0ed/1c4/x/3/cc/1_109_m.jpg");
    expect(products?.[1]?.image).toBe("https://gcs.rimg.com.tw/g4/59d/ccc/y/4/01/7a/2_707_m.jpg");
  });

  it("builds products in search order, with image host, item page, and no affiliate wrapping", () => {
    const products = rutenProducts(detail, ["22324948234766", "22509824206099"]);
    expect(products?.map((product) => product.title)).toEqual(["Redmi Buds 8 Active", "安全帽藍芽耳機"]);
    expect(products?.[0]).toMatchObject({
      platform: "ruten",
      price: 509,
      image: "https://gcs.rimg.com.tw/g5/411/ab6/q/0/12/0e/22324948234766_459_m.jpg",
      url: "https://www.ruten.com.tw/item/22324948234766/",
    });
    expect(products?.[1]?.price).toBe(246);
    expect(products?.every((product) => !product.url.includes("mchannles"))).toBe(true);
    expect(rutenProducts({})).toBeNull();
  });
});
