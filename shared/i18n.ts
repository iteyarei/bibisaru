/**
 * UI copy. Only zh-TW ships today.
 * To add a language later, duplicate this object and select it in one place
 * (see `messages` at the bottom) instead of scattering strings through the UI.
 */
export const zhTW = {
  brand: "比比猴",
  tagline: "猴子都會用的比價網站",
  documentTitle: "比比猴 — 台灣購物比價",
  searchTitle: "{q} — 比比猴",
  metaDescription:
    "一次搜尋 momo、PChome、Yahoo 奇摩、酷澎、蝦皮、全聯、東森、樂天、露天等購物網站，把價格由低到高排好。沒有廣告、沒有置頂。",
  searchLabel: "關鍵字",
  searchPlaceholder: "想找什麼？例如：藍芽耳機",
  searchHint: "多個關鍵字可用空格分開，全部符合的商品才會顯示",
  searchSubmit: "搜尋",
  clear: "清除",
  excludeLabel: "排除關鍵字",
  excludePlaceholder: "不想看到的字，例如：二手",
  removeKeyword: "移除「{word}」",
  presetExclude: "排除配件與二手",
  platformsLabel: "平台",
  resultCount: "共 {n} 筆",
  sortLabel: "排序",
  sortPriceAsc: "價格 低→高",
  sortPriceDesc: "價格 高→低",
  sortRelevance: "相關度",
  priceRange: "價格範圍",
  priceMin: "最低價格",
  priceMax: "最高價格",
  priceMinPlaceholder: "最低",
  priceMaxPlaceholder: "最高",
  priceUnit: "元",
  lowest: "✓ 最低價",
  lowestLabel: "最低價",
  buy: "前往購買",
  similar: "搜尋同款",
  updatedJustNow: "剛剛更新",
  updatedMinutes: "約 {n} 分鐘前更新",
  empty: "找不到符合的商品，試試放寬價格、少一個排除字，或打開更多平台",
  reset: "重設篩選",
  introTitle: "輸入關鍵字，一次比較各家價格",
  introBody: "momo、PChome、Yahoo 奇摩、酷澎、蝦皮、全聯、東森、樂天、露天。沒有廣告。",
  unavailable: "{name}商品暫時無法陳列",
  unavailableReason: "原因：{reason} · {colo}",
  unavailableReasonOnly: "原因：{reason}",
  unavailableReasonFetch: "原因：{reason} · {colo} · fetchColo {fetchColo}",
  unavailableReasonFetchOnly: "原因：{reason} · fetchColo {fetchColo}",
  platformEmpty: "{name}沒有相符商品",
  goSearch: "前往搜尋",
  goSearchSame: "同關鍵字前往搜尋",
  noData: "這次沒有取得商品，可以直接前往各平台搜尋",
  enableOne: "請至少打開一個平台",
  networkError: "連線失敗，請稍後再試",
  missingQuery: "請輸入關鍵字",
  rateLimited: "搜尋太頻繁，請稍後再試",
  loading: "搜尋中",
  /** Shown the instant a hot keyword chip is tapped, before the page leaves. */
  hotLoading: "正在取得「{word}」的比價資料…",
  hotLoadingGeneric: "正在取得比價資料…",
  footer: "價格與庫存以各購物平台頁面為準。比比猴不販售商品，也沒有置頂廣告。",
  footnoteLimit: "搜尋結果為各平台搜尋的前幾筆，非該站全部商品。",
  affiliateNote: "部分連結為聯盟行銷分潤連結，不影響您的購買價格。",
  openProduct: "{lowest}在{name}開啟「{title}」，{price}",
  noscript: "比比猴需要 JavaScript 才能搜尋比價。",
} as const;

export const messages = zhTW;

/** Suggested negative keywords from the competitor notes. Off until the user turns them on. */
export const PRESET_EXCLUDE = ["殼", "套", "膜", "訂金", "二手", "福利品"] as const;

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars[key] ?? ""));
}

/** Small gray line under a 暫時無法取得 card. fetchColo is where the outbound fetch ran. */
export function unavailableNote(
  reason: string | undefined,
  colo: string | undefined,
  fetchColo: string | undefined = "",
): string {
  const why = reason?.trim() ?? "";
  const where = colo?.trim() ?? "";
  const fetched = fetchColo?.trim() ?? "";
  if (why && where && fetched) {
    return fill(messages.unavailableReasonFetch, { reason: why, colo: where, fetchColo: fetched });
  }
  if (why && fetched) return fill(messages.unavailableReasonFetchOnly, { reason: why, fetchColo: fetched });
  if (why && where) return fill(messages.unavailableReason, { reason: why, colo: where });
  if (why) return fill(messages.unavailableReasonOnly, { reason: why });
  if (where && fetched) return `${where} · fetchColo ${fetched}`;
  if (fetched) return `fetchColo ${fetched}`;
  return where;
}

export function formatPrice(amount: number): string {
  return `$${new Intl.NumberFormat("zh-TW").format(amount)}`;
}

export function formatCount(amount: number): string {
  return new Intl.NumberFormat("zh-TW").format(amount);
}

export function formatUpdated(iso: string, now = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const minutes = Math.floor(Math.max(0, now - parsed) / 60_000);
  if (minutes < 1) return messages.updatedJustNow;
  return fill(messages.updatedMinutes, { n: minutes });
}
