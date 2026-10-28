import { pickKProducts } from "./k-pick";
import { normalizeMatchText } from "./text";
import type { PlatformId, Product } from "./types";

/**
 * Which shelf a /k/ listing belongs on.
 *
 * A search for 「除濕機」 also returns its filters, and a search for 「熱水器」
 * returns shower heads. Dropping every add-on threw away a comparison people
 * actually want, so the add-ons get their own section. What must not stay is a
 * different product altogether: a 混水閥 is not a water heater, and a 貓窩 is
 * not an electric blanket.
 *
 * Only 3C and 家電 pages group. A 棉被 page is one list of blankets, and an
 * 「配件」 shelf there would only confuse the reader.
 */

export type KGroupKind = "main" | "accessories" | "heat";

/** Add-ons for the thing the page is about. A title carrying one goes to 配件. */
export const ACCESSORY_WORDS: readonly string[] = [
  "保護殼",
  "保護貼",
  "保護套",
  "玻璃貼",
  "充電殼",
  "充電器",
  "充電頭",
  "支架",
  "濾網",
  "濾芯",
  "集塵袋",
  "耗材",
  "副廠",
  "適用",
  // A title that calls itself a 配件 is one. Machines that merely ship with
  // some are handled by the bundle phrases below.
  "配件",
  // The same shelf, named the way phone and console add-ons name themselves.
  // Without these a 280 元 case would be the cheapest 「主機」 on the page.
  "保護膜",
  "貼膜",
  "鋼化膜",
  "手機殼",
  "防摔殼",
  "皮套",
  "鏡頭貼",
  // Console peripherals: they are 周邊 to a console, and without
  // them a gamepad and a game would sit in 「主機」 above the actual console.
  "手把",
  "握把",
  "手柄",
  "控制器",
  "充電座",
  "充電底座",
  "底座",
  "收納包",
  "降溫座",
  "joycon",
  "記憶卡",
  "電源供應器",
  "攝影機",
  "遊戲片",
  // Consumables for a machine: a dishwasher's powder is not a dishwasher, however
  // often the box says 洗碗機 on it.
  "洗碗粉",
  "洗滌粉",
  "粉劑",
  "清潔劑",
  "軟化鹽",
  "亮碟劑",
  "去味器",
  "濾心",
  "替換",
  "補充包",
  "濾網組",
  // Spare parts. A machine advertises 「零纏繞邊刷」「自動洗拖布」 as features, so
  // reading these off the whole title would misfile it. They only count once
  // `productHead` has taken the feature list out: 「掃地機器人專用 刷頭」 and
  // 「原廠主刷組」 keep theirs, 「(自動洗拖布/零纏繞邊刷)」 loses it with the bracket.
  "刷頭",
  "刷毛",
  "主刷",
];

/**
 * Cables, spelled out one by one. A bare 「線」 must never be a word here:
 * 「無線吸塵器」 and 「有線」 would land in the accessory section, which is the
 * single most embarrassing thing this list could do.
 */
export const CABLE_WORDS: readonly string[] = [
  "充電線",
  "傳輸線",
  "電源線",
  "延長線",
  "連接線",
  "數據線",
  "線材",
  // 「4K影音轉換線 取代原廠底座」: a dock replacement sold as a cable.
  "轉換線",
];

/**
 * A search for a console also returns network switches and capture cards: they
 * share the word 「switch」 and nothing else. Only a console page drops them.
 */
export const CONSOLE_JUNK_WORDS: readonly string[] = ["交換器", "集線器", "採集卡", "擷取卡", "路游器", "路由器", "分享器"];

/**
 * The console itself. A title that says 主機 is the machine, even with a game
 * or a case thrown in; without the check a bundle would land in 周邊.
 */
export const HARDWARE_WORDS: readonly string[] = [
  "主機",
  "同捆",
  // A console sold as a bundle names itself this way without ever saying 主機:
  // 「Switch 2 + 任選遊戲」, 「薩爾達40周年特仕版機」. Never a bare 「組合」 —
  // 「磁吸保護殼組合」 is a case, and this list is read against the whole title.
  "特仕版",
  "特仕機",
  "任選遊戲",
  "主機組合",
  "含遊戲",
  "加贈遊戲",
  "同捆機",
  // 「Switch 2 + 任選joy-con」 is the console plus a pad of your choice, and a
  // second-hand machine is often advertised only as 「全新未激活Switch2」.
  "任選joycon",
  "未激活",
];

/**
 * What a machine says about itself. No add-on for it writes 「一級能效」 or
 * 「壓縮機」, so a title carrying one is the goods even when it also names the
 * filter it ships with: 「6L一級能效除濕機｜大水箱・甲殼素濾網」 is a dehumidifier.
 */
export const MACHINE_WORDS: readonly string[] = [
  "能效",
  "能源效率",
  "壓縮機",
  "變頻",
  "馬達",
  "除濕能力",
  "乾衣模式",
  "節能",
  "省電",
  "馬力",
  "風量",
  "轉速",
  "加熱管",
];

/**
 * Read as machine words too, but an add-on quotes them while saying what it
 * fits (「適用 小米掃拖機器人 水箱」, 「適用14坪除濕機濾網」). They only count when
 * the title carries no concrete accessory noun.
 */
export const MACHINE_SPEC_WORDS: readonly string[] = ["水箱", "坪數"];

/**
 * A capacity is only quoted on the device. 「坪」 is deliberately absent: it is
 * the size of a room, and 「適用14坪除濕機濾網」 would become a dehumidifier.
 * A digit straight after the unit is part of a model number (「AS401L2HEPA」).
 */
export const CAPACITY = /\d+(?:\.\d+)?\s*(?:L|公升|KG|公斤|吋|W|瓦)(?![A-Za-z0-9])/i;

/** A console page sells one machine, and everything else is 周邊 to it. */
const CONSOLE_PAGE = /switch|playstation|ps\s*[45]|xbox|steam\s*deck|遊戲主機/i;

/** Warming pads sold alongside electric blankets: another use, so a third shelf. */
export const HEAT_WORDS: readonly string[] = ["熱敷墊", "熱敷", "暖宮", "護腰帶"];

/** Different products that turn up in a search and belong in no section at all. */
export const OTHER_PRODUCT_WORDS: readonly string[] = [
  "混水閥",
  "水龍頭",
  "花灑",
  "蓮蓬頭",
  "孵化",
];

/**
 * Pet heaters. Only dropped on a blanket-like keyword: 「寵物毛」 is a feature
 * of a cordless vacuum, and 「寵物功能增加版」 is an air purifier, not a cat bed.
 */
export const PET_WORDS: readonly string[] = ["貓窩", "狗窩", "倉鼠", "蜜袋鼯", "寵物"];

/** Categories whose pages get sections. Everything else stays one list. */
export const GROUPED_CATEGORIES: readonly string[] = ["3C", "家電"];

/** Listings per section. The main shelf is never squeezed by the add-ons. */
export const K_MAIN_ITEMS = 20;
export const K_ACCESSORY_ITEMS = 8;
export const K_HEAT_ITEMS = 6;

/**
 * Right after 「適用」 a size or a capacity means the listing says which room
 * the machine fits (「適用14坪」, 「適用坪數4-8坪」), not that it is an add-on.
 */
/**
 * A storage size followed by a screen size is how a listing describes the
 * device itself: 「iPhone 18 Pro 256GB 6.3吋 智慧型手機 玻璃貼+保護殼組合」 is
 * a phone that comes with a case, and 「iPhone 18 Pro(256G/6.3吋)(透明防摔殼
 * 組)」 likewise. A case for that phone never states both.
 */
const DEVICE_SPEC = /\d(?:GB|TB|G|T)[^\p{L}\p{N}]{0,4}\d{1,2}(?:\.\d)?吋/iu;

/** Storage is only quoted on a device, and only phones and tablets are 3C here. */
const IS_3C = "3C";

const SIZE_AFTER = /^(?:\d|坪|公分|公厘|cm|mm|平方|公升|公克|吋|寸|人|ml|kg|g|w|l)/i;

/**
 * Freebies are named in a trailing bracket: 「iPhone 18 Pro 512G(hoda保護殼
 * 組合)」 is a phone sold with a case. Removing the phrase keeps it on the main
 * shelf, while a bare 「磁吸保護殼」 still goes to the add-ons.
 */
const BUNDLE_PHRASES: readonly string[] = [
  "保護殼組合",
  "保護貼組合",
  "保護貼組",
  "殼貼組",
  "殼貼",
  "原廠配件",
  "多配件",
  // 「Switch 2 主機 收納包組」 is a console with a bag, not a bag.
  "收納包組",
  // A type or an upgrade, not an add-on: a cheap 「濾網式」 purifier is still a
  // purifier, and 「濾網升級」 is a better filter inside one.
  "濾網式",
  "濾網型",
  "濾網升級",
  // 「負離子空氣清淨機 四層過濾網」 counts its filters; it is not selling one.
  "層過濾網",
  // 「Qrevo 2 Pro掃拖機器人-耗材組」 is the robot with a year of supplies, and
  // 「(皮套豪禮組) TCL NXTPAPER 11.5吋 平板電腦」 is the tablet with a case.
  "耗材組",
  "皮套豪禮組",
  "大禮包",
  // 「Switch 2 + 任選joy-con」 is the console with a pad of your choice. The pad
  // word has to come off the head, or 「joycon」 sends the whole bundle below.
  "任選joycon",
];

/**
 * A slash-separated bracket is a feature list, not the thing being sold:
 * 「小米 無線吸塵器 P30(22000Pa吸力/五重濾網/850g超輕)」 is a vacuum cleaner
 * whose specs happen to mention a filter. A case for it names its models
 * without slashes, so nothing real is lost.
 */
const SPEC_BRACKET =
  /[（(【](?:[^）)】]*[/／、][^）)】]*|[^）)】]*\s[^）)】]*\s[^）)】]*)[）)】]/g;

/**
 * A machine names what it runs on at the end of its own name:
 * 「…空氣清淨機 FU-J41T-W(集塵HEPA濾網)」 sells the purifier, not a filter. A
 * filter for sale opens with 適用／專用 instead, or puts 濾網 outside a bracket.
 */
const PART_BRACKET = /[（(]([^）)（）]{1,24})[）)]\s*$/;

/** A bracket holding nothing but the part itself. */
const PART_ONLY = /^(?:集塵|水洗|活性碳|HEPA|奈米|除菌)*(?:濾網|濾芯|濾心|濾袋)(?:組|\d+入)?$/i;

/** A model number in front of the bracket, which is what makes it a spec. */
const MODEL_BEFORE = /[A-Za-z][A-Za-z0-9_-]*\d/;

/**
 * A bracket that claims a gift is a bonus, not the goods:
 * 「【再送1片活性碳濾網】HPA720WTW 空氣清淨機一年份原廠濾網組」 is the filter
 * pack after it, and 「Switch2 主機(贈超值三好禮)」 is the console.
 */
const GIFT_BRACKET = /[【（(][^】）)]*(?:[送贈附]|[一二三四五六七八九十\d]+年份)[^】）)]*[】）)]/g;

/**
 * A bracket stating which room or area the machine is for is a specification,
 * never a product: 「(適用5-10坪｜小淨★一年份濾網組★)」 describes a purifier
 * that comes with filters. A filter for sale would put 濾網 outside it.
 */
const AREA_BRACKET = /[（(【][^）)】]*坪[^）)】]*[）)】]/g;

/** 「附原裝濾網x6」 and 「送HEPA濾網」 say what is thrown in, not what is sold. */
const BONUS_PHRASE =
  /[附送贈含][^\s，。;；【】（）()]{0,6}?(?:濾網|濾芯|濾心|集塵袋|耗材|配件|保護貼|保護殼|保護膜|鋼化膜|玻璃貼|貼膜|洗碗粉|洗滌粉|粉劑|清潔劑|軟化鹽|亮碟劑|去味器|補充包)\d*(?:[x×*]\d+)?(?:入|片|個|組|包|盒)?(?:[+＋][^\s，。;；【】（）()]{0,8})?/g;

export interface KGroupPlan {
  /** False on 生活／食品 pages: one list, no headings, nothing dropped. */
  enabled: boolean;
  /** True on a blanket-like keyword, where a 熱敷用品 shelf makes sense. */
  heatEnabled: boolean;
  titles: Record<KGroupKind, string>;
  limits: Record<KGroupKind, number>;
  /** Folded words, ready to be compared with a folded title. */
  accessory: string[];
  heat: string[];
  drop: string[];
  /** Network gear that merely shares the word 「switch」: not a console at all. */
  consoleDrop: string[];
  /**
   * True when the keyword is a console: then the first shelf is the machine
   * itself, and a title that never says 主機 is a game or a pad for it.
   */
  consolePage: boolean;
  /** What makes a title the console itself rather than a game for it. */
  hardware: string[];
  /** Words only the machine itself writes. */
  machine: string[];
  /** Words the machine and its add-ons both write. */
  machineSpec: string[];
  /** Add-on words naming a thing, which outrank a capacity; 「適用」 does not. */
  accessoryNouns: string[];
  /** The shape of a capacity quote: 22L, 6公斤, 11.5吋, 1500W. Never 坪. */
  capacity: string;
  /** The accessory word that may also introduce a size. */
  specWord: string;
  /** What may follow `specWord` and mean a measurement rather than an add-on. */
  specAfter: string;
  /** Phrases naming a bundled freebie rather than the item. */
  bundlePhrases: string[];
  /** Where a title stops naming the goods and starts listing the bundle. */
  bundleSplit: string;
  /** Chinese text before a separator, which is what makes a plus a bundle sign. */
  cjkBefore: string;
  /** The shape of a spec quote that only a device listing carries. */
  deviceSpec: string;
  /** The bracket shapes that describe rather than sell. */
  specBracket: string;
  /** A trailing bracket naming the part a machine runs on, and a model before it. */
  partBracket: string;
  partOnly: string;
  modelBefore: string;
  areaBracket: string;
  giftBracket: string;
  bonusPhrase: string;
}

/** Letters and digits only, so words match through width, case and spaces. */
export function foldTitle(value: string): string {
  return normalizeMatchText(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The words of `list` that the keyword itself does not use. */
function keep(list: readonly string[], keyword: string): string[] {
  const hay = foldTitle(keyword);
  return list.map(foldTitle).filter((word) => word && !hay.includes(word));
}

/**
 * A query that IS the word keeps it: searching 「水龍頭」 must not drop every
 * title for being about a tap, and searching 「寵物飲水機」 must not drop every
 * title for mentioning pets.
 */
export function groupPlan(keyword: string, category: string): KGroupPlan {
  const enabled = GROUPED_CATEGORIES.includes(category);
  const specWordFolded = foldTitle("適用");
  const heatEnabled = enabled && /毯|墊/.test(foldTitle(keyword));
  return {
    enabled,
    heatEnabled,
    titles: { ...GROUP_TITLES, main: category === "3C" ? "主機" : "本體" },
    limits: { main: K_MAIN_ITEMS, accessories: K_ACCESSORY_ITEMS, heat: K_HEAT_ITEMS },
    accessory: enabled ? keep([...ACCESSORY_WORDS, ...CABLE_WORDS], keyword) : [],
    heat: enabled && heatEnabled ? keep(HEAT_WORDS, keyword) : [],
    drop: enabled
      ? [...keep(OTHER_PRODUCT_WORDS, keyword), ...(heatEnabled ? keep(PET_WORDS, keyword) : [])]
      : [],
    consoleDrop: enabled && CONSOLE_PAGE.test(keyword ?? "") ? keep(CONSOLE_JUNK_WORDS, keyword) : [],
    consolePage: enabled && CONSOLE_PAGE.test(keyword ?? ""),
    hardware: HARDWARE_WORDS.map(foldTitle),
    machine: enabled ? keep(MACHINE_WORDS, keyword) : [],
    machineSpec: enabled ? keep(MACHINE_SPEC_WORDS, keyword) : [],
    accessoryNouns: enabled ? keep([...ACCESSORY_WORDS, ...CABLE_WORDS], keyword).filter((w) => w !== specWordFolded) : [],
    capacity: enabled ? CAPACITY.source : "",
    specWord: foldTitle("適用"),
    specAfter: SIZE_AFTER.source,
    bundlePhrases: BUNDLE_PHRASES.map(foldTitle),
    bundleSplit: BUNDLE_SPLIT.source,
    cjkBefore: CJK_BEFORE.source,
    deviceSpec: enabled && category === IS_3C ? DEVICE_SPEC.source : "",
    specBracket: SPEC_BRACKET.source,
    partBracket: PART_BRACKET.source,
    partOnly: PART_ONLY.source,
    modelBefore: MODEL_BEFORE.source,
    areaBracket: AREA_BRACKET.source,
    giftBracket: GIFT_BRACKET.source,
    bonusPhrase: BONUS_PHRASE.source,
  };
}

function anyWord(hay: string, words: readonly string[]): boolean {
  return words.some((word) => word && hay.includes(word));
}

/**
 * Where a title stops naming the product and starts listing what comes with it:
 * 「Switch 2 主機+鋼化膜」, 「Switch 2 主機 贈收納包」, 「…(內含軍規殼)」.
 */
const BUNDLE_SPLIT = /[+＋]|[贈送附含]/;

/** The last character that is not a space, so 「主機 + 收納包」 still reads as Chinese. */
function lastChar(text: string): string {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return "";
}

/** 「買一送一」 is a promotion, not a freebie: cutting there would leave 「買一」. */
const PROMO_BUNDLE = /買[一二三四五六七八九十\d]+送[一二三四五六七八九十\d]+/g;

/** A plus after Chinese text separates a bundle; after a digit or letter it is a model name. */
const CJK_BEFORE = /[\u3400-\u9fff）)】」』]/;

/**
 * The part of a title that names what is being sold, with feature lists and
 * bundled-freebie phrases taken out. What is left still carries the model
 * names, so 「適用 iPhone 18 Pro 保護殼」 keeps its accessory word.
 */
export function productHead(title: string, plan: KGroupPlan): string {
  const bare = withoutPartBracket(title ?? "", plan)
    .replace(new RegExp(plan.giftBracket, "g"), " ")
    .replace(new RegExp(plan.areaBracket, "g"), " ")
    .replace(new RegExp(plan.specBracket, "g"), " ")
    .replace(new RegExp(plan.bonusPhrase, "g"), " ");
  // The split has to happen before folding, which drops the punctuation.
  const promo = bare.replace(PROMO_BUNDLE, " ");
  const cut = promo.search(BUNDLE_SPLIT);
  // A model suffix is not a bundle: 「LG A9+無線吸塵器前置濾網」 is a filter for
  // an A9+, so the split only counts when Chinese text comes before it, spaces
  // aside (「主機 + 收納包」).
  const before = cut > 0 ? lastChar(promo.slice(0, cut)) : "";
  const named = cut > 0 && CJK_BEFORE.test(before) ? promo.slice(0, cut) : promo;
  const head = foldTitle(named);
  return plan.bundlePhrases.reduce((text, phrase) => text.split(phrase).join(""), head);
}

/**
 * 「SHARP 10坪AIoT智慧除菌離子空氣清淨機 FU-J41T-W(集塵HEPA濾網)」 is a purifier
 * that says which filter it runs on; 「適用 FU-J41T-W 集塵HEPA濾網」 is the filter.
 * The difference is the model number and a name in front of the bracket.
 */
function withoutPartBracket(title: string, plan: KGroupPlan): string {
  const bracket = new RegExp(plan.partBracket).exec(title);
  if (!bracket) return title;
  if (!new RegExp(plan.partOnly, "i").test(bracket[1])) return title;
  const before = title.slice(0, bracket.index);
  if (!new RegExp(plan.modelBefore).test(before)) return title;
  if (!/[\u3400-\u9fff]/.test(before)) return title;
  // A listing that only says what it fits is not the machine it fits.
  if (/^(?:適用|專用|替換|通用|副廠)/.test(foldTitle(before))) return title;
  return before;
}

/**
 * 「適用」 counts unless the size behind it describes the machine itself.
 * 「10-15坪適用」 ends the title, so nothing follows and it counts as a size.
 */
function accessoryHit(head: string, plan: KGroupPlan): boolean {
  if (!plan.accessory.length) return false;
  const size = new RegExp(plan.specAfter, "i");
  return plan.accessory.some((word) => {
    const at = head.indexOf(word);
    if (at < 0) return false;
    if (word !== plan.specWord) return true;
    // 「適用」 is how add-on listings open; a machine says 「臥室浴室適用」
    // mid-sentence and is not an add-on for that.
    if (at > 0) return false;
    const after = head.slice(word.length);
    return Boolean(after) && !size.test(after);
  });
}

/** Which section a title belongs in, or `drop` when it is a different product. */
export function classifyTitle(title: string, plan: KGroupPlan): KGroupKind | "drop" {
  if (!plan.enabled) return "main";
  const hay = foldTitle(title);
  if (!hay) return "main";
  if (anyWord(hay, plan.drop)) return "drop";
  if (anyWord(hay, plan.consoleDrop)) return "drop";
  if (plan.heatEnabled && anyWord(hay, plan.heat)) return "heat";
  // A phone sold with a case is still a phone: its capacity gives it away even
  // after the freebie list is trimmed off.
  if (plan.deviceSpec && new RegExp(plan.deviceSpec, "iu").test(title ?? "")) return "main";
  // A console page sells the console first: only a title that says 主機 (or
  // 同捆) is the machine. Everything else — 「薩爾達傳說 中文版」, a spare
  // Joy-Con, a 記憶卡 — is 周邊 however the shop words it. Without this a
  // NT$1,580 game would be the cheapest 「主機」 on the page.
  if (plan.consolePage && !anyWord(hay, plan.hardware)) return "accessories";
  // The machine names its own engineering. That outranks an add-on word in the
  // same title, because 「6L一級能效除濕機｜大水箱・甲殼素濾網」 sells the machine.
  if (anyWord(hay, plan.machine)) return "main";
  const head = productHead(title, plan);
  if (!accessoryHit(head, plan)) return "main";
  // A capacity or a 水箱 is weak evidence: an add-on quotes them while saying
  // what it fits. It only wins when no concrete accessory noun is on the title.
  if (machineSpecHit(title, head, plan) && !anyWord(head, plan.accessoryNouns)) return "main";
  return "accessories";
}

/** 22L on a machine of its own, not on a filter that says which machine it fits. */
function machineSpecHit(title: string, head: string, plan: KGroupPlan): boolean {
  if (anyWord(head, plan.machineSpec)) return true;
  if (!plan.capacity) return false;
  const capacity = new RegExp(plan.capacity, "i");
  return capacity.test(title ?? "") || capacity.test(head);
}

/** One rendered section. Only sections with listings ever reach the page. */
export interface KPageGroup {
  kind: KGroupKind;
  title: string;
  products: Product[];
}

/** The heading of a shelf: 「主機」 on a 3C page, 「本體」 on an appliance page. */
export const GROUP_TITLES: Record<KGroupKind, string> = {
  main: "本體",
  accessories: "配件與周邊",
  heat: "熱敷用品",
};

const KINDS: readonly KGroupKind[] = ["main", "accessories", "heat"];

function bucket(products: readonly Product[], keyword: string, category: string) {
  const plan = groupPlan(keyword, category);
  const pools: Record<KGroupKind, Product[]> = { main: [], accessories: [], heat: [] };
  for (const product of products) {
    const kind = classifyTitle(product.title, plan);
    if (kind !== "drop") pools[kind].push(product);
  }
  return { plan, pools };
}

export interface PickGroupsOptions {
  keyword: string;
  category: string;
  /** Shops that may not appear at all. */
  excludePlatforms?: readonly PlatformId[];
  /** Round-robin order. Shops left out of it keep taking turns afterwards. */
  platformOrder?: readonly PlatformId[];
  /** How many listings each section wants. Defaults to 20 / 8 / 6. */
  limits?: Partial<Record<KGroupKind, number>>;
  /** Shorthand for `limits.main`, kept so callers can still ask for N listings. */
  limit?: number;
}

/**
 * Every section of one landing page. Each shelf runs the picker on its own, so
 * a wall of cheap cases can never push the consoles off the main shelf.
 */
export function pickKGroups(products: readonly Product[], options: PickGroupsOptions): KPageGroup[] {
  const { plan, pools } = bucket(products, options.keyword, options.category);
  return KINDS.map((kind) => ({
    kind,
    title: plan.titles[kind],
    products: pickKProducts(pools[kind], {
      keyword: options.keyword,
      limit: options.limits?.[kind] ?? (kind === "main" ? options.limit : undefined) ?? plan.limits[kind],
      excludePlatforms: options.excludePlatforms ?? [],
      platformOrder: options.platformOrder,
    }),
  })).filter((group) => group.products.length > 0);
}

/** The flat list the head, the intro and the JSON-LD are built from. */
export function flattenGroups(groups: readonly KPageGroup[]): Product[] {
  return groups.flatMap((group) => group.products);
}

/**
 * Rebuild the sections from an already picked list: an archived snapshot, or a
 * caller that only holds the flat list. The incoming order is kept inside each
 * section, which is cheapest-first as the picker left it.
 */
export function deriveGroups(
  products: readonly Product[],
  keyword: string,
  category: string,
): KPageGroup[] {
  const { plan, pools } = bucket(products, keyword, category);
  return KINDS.map((kind) => ({ kind, title: plan.titles[kind], products: pools[kind] })).filter(
    (group) => group.products.length > 0,
  );
}
