import { describe, expect, it } from "vitest";
import {
  classifyTitle,
  deriveGroups,
  flattenGroups,
  groupPlan,
  K_ACCESSORY_ITEMS,
  K_HEAT_ITEMS,
  K_MAIN_ITEMS,
  pickKGroups,
  productHead,
} from "../shared/k-group";
import type { PlatformId, Product } from "../shared/types";

function product(over: Partial<Product> = {}): Product {
  const platform = over.platform ?? "momo";
  return {
    platform,
    title: "除濕機 12L 節能款",
    price: 4_990,
    image: "",
    url: `https://example.test/${platform}`,
    rank: 0,
    ...over,
  };
}

const titles = (items: readonly Product[]) => items.map((item) => item.title);
const kindOf = (title: string, keyword: string, category = "家電") => classifyTitle(title, groupPlan(keyword, category));

describe("which category gets sections", () => {
  it("groups 3C and 家電 only", () => {
    expect(groupPlan("除濕機", "家電").enabled).toBe(true);
    expect(groupPlan("Switch 2", "3C").enabled).toBe(true);
    // A 棉被 page is one list of blankets: a 配件 shelf there would be noise.
    expect(groupPlan("棉被", "生活").enabled).toBe(false);
    expect(groupPlan("咖啡豆", "食品").enabled).toBe(false);
  });

  it("titles the first shelf 主機 on 3C and 本體 elsewhere", () => {
    expect(groupPlan("Switch 2", "3C").titles.main).toBe("主機");
    expect(groupPlan("除濕機", "家電").titles.main).toBe("本體");
    expect(groupPlan("除濕機", "家電").titles.accessories).toBe("配件與周邊");
    expect(groupPlan("電熱毯", "家電").titles.heat).toBe("熱敷用品");
  });

  it("only offers a 熱敷 shelf on a blanket-like keyword", () => {
    expect(groupPlan("電熱毯", "家電").heatEnabled).toBe(true);
    expect(groupPlan("電熱墊", "家電").heatEnabled).toBe(true);
    expect(groupPlan("除濕機", "家電").heatEnabled).toBe(false);
    expect(groupPlan("電熱毯", "生活").heatEnabled).toBe(false);
  });

  it("stays one list when the category is not grouped", () => {
    const groups = pickKGroups([product({ title: "棉被 冬被" }), product({ title: "棉被 保護套", price: 200 })], {
      keyword: "棉被",
      category: "生活",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("main");
    expect(groups[0].products).toHaveLength(2);
  });
});

describe("cables are not an accessory word", () => {
  it("keeps a 無線吸塵器 on the main shelf", () => {
    // A bare 「線」 rule would read 「無線」 as a cable and bury the machines.
    expect(kindOf("小米 無線吸塵器 P30 22000Pa", "無線吸塵器")).toBe("main");
    expect(kindOf("Dyson V12 無線吸塵器 智慧感應", "無線吸塵器")).toBe("main");
    expect(kindOf("有線吸塵器 1200W", "有線吸塵器")).toBe("main");
  });

  it("still sends an actual cable to the add-ons", () => {
    expect(kindOf("適用 Dyson V12 無線吸塵器 充電線", "無線吸塵器")).toBe("accessories");
    expect(kindOf("無線吸塵器 專用延長線 5M", "無線吸塵器")).toBe("accessories");
    expect(kindOf("無線吸塵器 集塵袋 10入", "無線吸塵器")).toBe("accessories");
  });
});

describe("除濕機: the filter is an add-on, the machine is not", () => {
  it("puts a filter in 配件 and leaves the machine in 本體", () => {
    expect(kindOf("LG 除濕機 專用 濾網 副廠", "除濕機")).toBe("accessories");
    expect(kindOf("適用 日立 除濕機 RD-22FC 濾芯", "除濕機")).toBe("accessories");
    expect(kindOf("【SHARP 夏普】10公升 清淨除濕機 DW-LT10FT-W", "除濕機")).toBe("main");
  });

  it("does not read a machine's own filter or room size as an add-on", () => {
    // A machine that counts its filters, ships with a spare, or states its room.
    expect(kindOf("小米 無線吸塵器 P30(22000Pa吸力/五重濾網/850g超輕)", "無線吸塵器")).toBe("main");
    expect(kindOf("【小不記】附原裝濾網x6 無線吸塵器 輕便手持", "無線吸塵器")).toBe("main");
    expect(kindOf("【Panasonic】11公升一級能效除濕機◆適用14坪(F-Y22PN)", "除濕機")).toBe("main");
    expect(kindOf("11公升 智慧除濕機 (小米官方授權代理/10-15坪適用/一年保固)", "除濕機")).toBe("main");
    expect(kindOf("除濕機 12L 浴室臥室適用 110V", "除濕機")).toBe("main");
    expect(kindOf("負離子清淨機 四層過濾網 家用", "空氣清淨機")).toBe("main");
  });

  it("keeps 「適用」 that opens a listing as an add-on", () => {
    expect(kindOf("適用 LG 空氣清淨機 A9 濾網", "空氣清淨機")).toBe("accessories");
    expect(kindOf("【超值好物】滿300發貨大白濾網適用LG空氣清淨機PS-309IAS", "空氣清淨機")).toBe("accessories");
  });
});

describe("熱水器: a shower head is a different product", () => {
  it("drops 混水閥, 水龍頭 and 蓮蓬頭", () => {
    expect(kindOf("全銅智能恆溫閥 淋浴花灑水龍頭 電熱水器混水閥", "熱水器")).toBe("drop");
    expect(kindOf("增壓花灑噴頭 浴室 蓮蓬頭 熱水器洗澡", "熱水器")).toBe("drop");
    expect(kindOf("熱水器 專用 水龍頭", "熱水器")).toBe("drop");
  });

  it("keeps the water heaters themselves", () => {
    expect(kindOf("【SAKURA櫻花】五段調溫電熱水器 SH-186", "熱水器")).toBe("main");
    expect(kindOf("即熱式電熱水器 洗澡 家用 免打孔", "熱水器")).toBe("main");
  });

  it("does not drop a keyword that IS the word", () => {
    // A 水龍頭 page must not throw away every listing for being about taps.
    expect(kindOf("浴室 水龍頭 恆溫 全銅", "水龍頭")).toBe("main");
  });
});

describe("電熱毯: pads get their own shelf, pets do not", () => {
  it("sends 熱敷墊 to 熱敷用品", () => {
    expect(kindOf("恆溫電熱敷墊 加熱墊 110v電熱毯", "電熱毯")).toBe("heat");
    expect(kindOf("石墨烯 USB 熱敷墊 暖宮", "電熱毯")).toBe("heat");
    expect(kindOf("電熱毯 雙人 法蘭絨", "電熱毯")).toBe("main");
  });

  it("drops the pet beds", () => {
    expect(kindOf("寵物電熱毯 貓咪智能恒溫加熱墊", "電熱毯")).toBe("drop");
    expect(kindOf("電熱毯 USB 貓窩 狗窩 保暖", "電熱毯")).toBe("drop");
  });

  it("keeps a pet word that is not a different product", () => {
    // 「寵物毛」 is a feature of a vacuum, not a cat bed.
    expect(kindOf("無線吸塵器 強力吸寵物毛", "無線吸塵器")).toBe("main");
    expect(kindOf("空氣清淨機 寵物功能增加版", "空氣清淨機")).toBe("main");
  });
});

describe("a case is not the phone or the console", () => {
  it("sends iPhone cases to 配件 and keeps the phone in 主機", () => {
    expect(kindOf("DUX DUCIS iPhone 18 Pro 磁吸保護殼", "iPhone 18 Pro", "3C")).toBe("accessories");
    expect(kindOf("VOKAMO iPhone 18 Pro 鏡頭保護膜", "iPhone 18 Pro", "3C")).toBe("accessories");
    expect(kindOf("【Apple】iPhone 18 Pro 256G 6.3吋 智慧型手機", "iPhone 18 Pro", "3C")).toBe("main");
  });

  it("keeps a phone sold with a case in 主機", () => {
    // The case is a freebie here, not the goods; the capacity gives it away.
    expect(kindOf("iPhone 18 Pro 256GB 6.3吋 玻璃貼+保護殼組合", "iPhone 18 Pro", "3C")).toBe("main");
    expect(kindOf("iPhone 18 Pro(256G/6.3吋)(透明防摔殼組)", "iPhone 18 Pro", "3C")).toBe("main");
  });

  it("does the same for a console", () => {
    expect(kindOf("Switch 2 保護殼 透明 抗摔", "Switch 2", "3C")).toBe("accessories");
    expect(kindOf("NS2 Switch 2 Pro 控制器 手把", "Switch 2", "3C")).toBe("accessories");
    expect(kindOf("Switch 2 主機(台灣公司貨)", "Switch 2", "3C")).toBe("main");
    expect(kindOf("Switch 2 主機+鋼化膜+收納包", "Switch 2", "3C")).toBe("main");
  });
});

describe("the shelves are picked apart", () => {
  it("never lets a cheap add-on push the machines off the page", () => {
    const cheapCases = Array.from({ length: 30 }, (_, i) =>
      product({ platform: "ruten", title: `iPhone 18 Pro 保護殼 第${i}款`, price: 50 + i, rank: i }),
    );
    const phones = Array.from({ length: 5 }, (_, i) =>
      product({ platform: "momo", title: `iPhone 18 Pro 256G 手機 第${i}款`, price: 40_000 + i, rank: i }),
    );
    const groups = pickKGroups([...cheapCases, ...phones], { keyword: "iPhone 18 Pro", category: "3C" });

    expect(groups.map((group) => group.kind)).toEqual(["main", "accessories"]);
    expect(groups[0].products).toHaveLength(5);
    // Every phone stays on the first shelf, however cheap the cases are.
    expect(titles(groups[0].products).every((title) => title.includes("手機"))).toBe(true);
    expect(groups[1].products).toHaveLength(K_ACCESSORY_ITEMS);
  });

  it("caps each shelf and orders every one cheapest first", () => {
    const machines = Array.from({ length: 30 }, (_, i) =>
      product({ platform: "momo", title: `除濕機 第${i}款`, price: 5_000 - i, rank: i }),
    );
    const filters = Array.from({ length: 12 }, (_, i) =>
      product({ platform: "pchome", title: `除濕機 濾網 第${i}款`, price: 900 - i, rank: i }),
    );
    const groups = pickKGroups([...machines, ...filters], { keyword: "除濕機", category: "家電" });

    expect(groups[0].products).toHaveLength(K_MAIN_ITEMS);
    expect(groups[1].products).toHaveLength(K_ACCESSORY_ITEMS);
    for (const group of groups) {
      const prices = group.products.map((item) => item.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    }
    expect(K_MAIN_ITEMS).toBe(20);
    expect(K_ACCESSORY_ITEMS).toBe(8);
    expect(K_HEAT_ITEMS).toBe(6);
  });

  it("leaves an empty shelf out instead of printing a heading over nothing", () => {
    const groups = pickKGroups([product({ title: "除濕機 12L" })], { keyword: "除濕機", category: "家電" });
    expect(groups.map((group) => group.kind)).toEqual(["main"]);
  });

  it("stacks 主商品, then 配件, then 熱敷", () => {
    const groups = pickKGroups(
      [
        product({ title: "電熱毯 雙人", price: 1_200 }),
        product({ title: "電熱毯 熱敷墊", price: 500 }),
        product({ title: "電熱毯 保護套", price: 300 }),
      ],
      { keyword: "電熱毯", category: "家電" },
    );
    expect(groups.map((group) => group.kind)).toEqual(["main", "accessories", "heat"]);
  });

  it("takes a platform order and an exclusion like the flat picker", () => {
    const groups = pickKGroups(
      [
        product({ platform: "momo", title: "除濕機 A", price: 900 }),
        product({ platform: "pchome", title: "除濕機 B", price: 800 }),
        product({ platform: "ruten", title: "除濕機 C", price: 100 }),
      ],
      { keyword: "除濕機", category: "家電", limit: 1, platformOrder: ["pchome", "momo"], excludePlatforms: ["ruten"] },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].products).toHaveLength(1);
    expect(groups[0].products[0].platform).toBe("pchome");
  });
});

describe("flattening the shelves", () => {
  it("keeps the page order and drops nothing", () => {
    const groups = pickKGroups(
      [
        product({ title: "Switch 2 主機", price: 15_880 }),
        product({ title: "Switch 2 保護殼", price: 300 }),
      ],
      { keyword: "Switch 2", category: "3C" },
    );
    const flat = flattenGroups(groups);
    expect(flat.map((item) => item.price)).toEqual([15_880, 300]);
    expect(flat).toHaveLength(groups.reduce((sum, group) => sum + group.products.length, 0));
  });

  it("rebuilds the same sections from an already picked list, in place order", () => {
    const products = [
      product({ title: "Switch 2 主機", price: 15_880 }),
      product({ title: "Switch 2 主機 公司貨", price: 15_500 }),
      product({ title: "Switch 2 保護殼", price: 300 }),
    ];
    const groups = deriveGroups(products, "Switch 2", "3C");
    expect(groups.map((group) => group.kind)).toEqual(["main", "accessories"]);
    expect(titles(groups[0].products)).toEqual(["Switch 2 主機", "Switch 2 主機 公司貨"]);
    expect(titles(groups[1].products)).toEqual(["Switch 2 保護殼"]);
  });
});

describe("productHead", () => {
  const plan = groupPlan("除濕機", "家電");

  it("keeps the model name and drops the feature list", () => {
    expect(productHead("小米 無線吸塵器 P30(22000Pa吸力/五重濾網)", groupPlan("無線吸塵器", "家電"))).not.toContain("濾網");
    expect(productHead("【Panasonic】11公升除濕機(適用14坪)", plan)).toContain("除濕機");
  });

  it("cuts a bundle after the goods, never through a model name", () => {
    expect(productHead("Switch 2 主機+鋼化膜", groupPlan("Switch 2", "3C"))).toBe("switch2主機");
    // A9+ is a model, not a plus sign joining a bundle.
    expect(productHead("LG A9+無線吸塵器前置濾網", groupPlan("無線吸塵器", "家電"))).toContain("a9");
  });

  it("folds a bundle phrase away", () => {
    expect(productHead("Switch 2 主機 保護殼組合", groupPlan("Switch 2", "3C"))).toBe("switch2主機");
    expect(productHead("【Nintendo】Switch2 主機(贈超值三好禮)", groupPlan("Switch 2", "3C"))).toBe("nintendoswitch2主機");
  });
});

describe("a console page sells the console first", () => {
  it("treats a game as 周邊 unless the title says 主機", () => {
    expect(kindOf("【任天堂】Switch 2 薩爾達傳說 王國之淚 中文版", "Switch 2", "3C")).toBe("accessories");
    expect(kindOf("Switch 2 主機 + 《瑪利歐賽車世界》", "Switch 2", "3C")).toBe("main");
    expect(kindOf("任天堂 Switch 2 主機 台灣公司貨", "Switch 2", "3C")).toBe("main");
  });

  it("leaves a phone page alone: a phone has no 周邊 shelf of games", () => {
    expect(kindOf("iPhone 18 Pro 256G 中文版", "iPhone 18 Pro", "3C")).toBe("main");
    expect(kindOf("iPhone 18 Pro 512G 遊戲機", "iPhone 18 Pro", "3C")).toBe("main");
  });

  it("drops network gear that only shares the word switch", () => {
    // A search for 「Switch 2」 returns 乙太網路交換器 and 擷取卡. They are not
    // consoles, and they are not 周邊 to one either.
    expect(kindOf("【TP-Link】LS108G 8埠 乙太網路交換器 switch hub", "Switch 2", "3C")).toBe("drop");
    expect(kindOf("圓剛 GC551G2 4K 擷取卡 switch 實況", "Switch 2", "3C")).toBe("drop");
    // The same word on another page means nothing.
    expect(kindOf("小米 交換器 5埠", "除濕機", "家電")).toBe("main");
  });
});

describe("platform ids survive a legacy row", () => {
  it("only returns rows from the known shops", () => {
    const legacy = ["kingstone", "sanmin"] as unknown as PlatformId[];
    const stale = legacy.map((platform, index) =>
      product({ platform, title: `除濕機 12L 第${index}款`, price: 100 + index }),
    );
    const groups = pickKGroups([...stale, product({ title: "除濕機 12L" })], { keyword: "除濕機", category: "家電" });
    expect(groups[0].products).toHaveLength(1);
    expect(groups[0].products[0].platform).toBe("momo");
  });
});

describe("a machine names its own engineering", () => {
  // A search for 「除濕機」 returns its filters, and the shop words the machine
  // the way the filter is worded: 「6L一級能效除濕機｜大水箱・甲殼素濾網」.
  it("keeps the dehumidifier that mentions its filter on the main shelf", () => {
    expect(
      kindOf("【SAMPO 聲寶】6L一級能效除濕機｜大水箱・甲殼素濾網・乾衣模式(AD-WB512T)", "除濕機"),
    ).toBe("main");
    // The same model without the word 濾網, which was always read correctly.
    expect(kindOf("SAMPO聲寶 6L一級能效除濕機 AD-WB512T", "除濕機")).toBe("main");
  });

  it("still reads a filter for that machine as an add-on", () => {
    expect(kindOf("SAMPO 除濕機 專用 替換濾網", "除濕機")).toBe("accessories");
    // 「坪」 is the size of a room, not a capacity: it must not save this one.
    expect(kindOf("適用 14坪 除濕機 濾網", "除濕機")).toBe("accessories");
  });

  it("reads a capacity as the machine, and 適用 mid-title as nothing", () => {
    expect(kindOf("適用智能除溼機家用22L抽溼機靜音臥室去溼機全屋乾衣機", "乾衣機")).toBe("main");
    // A case quotes the phone it fits and no capacity of its own.
    expect(kindOf("適用 iPhone 18 Pro 保護殼", "iPhone 18 Pro", "3C")).toBe("accessories");
    expect(kindOf("磁吸保護殼", "iPhone 18 Pro", "3C")).toBe("accessories");
  });

  it("puts a machine's filter behind a model number back on the main shelf", () => {
    expect(
      kindOf("【SHARP 夏普】10坪AIoT智慧除菌離子空氣清淨機 FU-J41T-W(集塵HEPA濾網)", "空氣清淨機"),
    ).toBe("main");
    // The same filter sold on its own has no model in front of the bracket.
    expect(kindOf("適用 FU-J41T-W 集塵HEPA濾網 一年份", "空氣清淨機")).toBe("accessories");
  });
});

describe("dishwasher powder is not a dishwasher", () => {
  it("moves the powder to the add-ons", () => {
    expect(kindOf("【finish 亮碟】洗碗機專用強力洗滌粉劑洗碗粉", "洗碗機")).toBe("accessories");
  });

  it("keeps the machine that throws the powder in", () => {
    // 「送洗碗粉六人份」 is a freebie, so the head never reaches 洗碗粉.
    expect(
      kindOf("含基本安裝送洗碗粉六人份 熱風循環洗碗機 HDW-06BT010+HDP-10D1 (24h到貨)", "洗碗機"),
    ).toBe("main");
  });
});

describe("a console bundle is the console", () => {
  it("keeps a bundle with a game on the main shelf", () => {
    expect(kindOf("任天堂 Nintendo Switch 2 + 任選遊戲", "Switch 2", "3C")).toBe("main");
    expect(
      kindOf(
        "【Nintendo 任天堂】Switch 2 薩爾達40周年特仕版機+《NS2寶可夢傳說 Z-A》+《Joy-con 2》+《9H鋼化貼》",
        "Switch 2",
        "3C",
      ),
    ).toBe("main");
    expect(kindOf("任天堂 Nintendo Switch 2 + 任選joy-con", "Switch 2", "3C")).toBe("main");
  });

  it("still reads a game and a pad as 周邊", () => {
    expect(
      kindOf("【Nintendo 任天堂】NS2 Nintendo Switch 運動 度假勝地(台灣公司貨 -附贈首批特典)", "Switch 2", "3C"),
    ).toBe("accessories");
    expect(kindOf("Nintendo 任天堂 Switch 2 Joy-con 2 控制器 手把 (台灣公司貨)", "Switch 2", "3C")).toBe("accessories");
  });
});

describe("spare parts belong to the add-ons", () => {
  it("moves a brush sold for a robot to the add-ons", () => {
    expect(kindOf("【LG 樂金】掃地機器人專用 防糾結滾輪刷頭AHR73889701", "掃地機器人")).toBe("accessories");
    expect(
      kindOf("Vbot i6 / R8 / M270 / R10掃地機器人原廠專用 二代增效彈性刷毛 藍彩刷頭(4入)", "掃地機器人"),
    ).toBe("accessories");
  });

  it("keeps a machine that advertises the parts it runs", () => {
    // 「零纏繞邊刷」「自動洗拖布」 are features of the robot, not parts for sale.
    expect(kindOf("【Roborock】Qrevo L 全能掃拖機器人(自動洗拖布/零纏繞邊刷/10000Pa)", "掃地機器人")).toBe("main");
  });
});
