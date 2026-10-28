/**
 * 節慶吉祥物的日期判定。
 *
 * 純函式：不碰 DOM、不讀 `Date.now()`，時間一律從參數來，好測。
 * 農曆節慶的國曆日期來自 `shared/festival-dates.json`，那是由
 * `scripts/gen-festival-dates.mjs` 用 `lunar-javascript` 事先算好的。
 * **前端執行時不 import 農曆庫**，只讀這份 JSON，否則幾百 KB 會進 bundle。
 */
import { FESTIVAL_SETTINGS } from "./festival-config";
import dateTable from "./festival-dates.json";

export type FestivalKey =
  | "new-year"
  | "lunar-new-year"
  | "lantern"
  | "dragon-boat"
  | "mid-autumn"
  | "halloween"
  | "christmas";

export interface FestivalWindow {
  key: FestivalKey;
  label: string;
  startDate: string;
  endDate: string;
}

export interface FestivalDef {
  key: FestivalKey;
  label: string;
  /** 國曆固定的節慶；農曆節慶沒有這個欄位，日期查表。 */
  fixed?: { month: number; day: number };
}

/**
 * 全部節慶。**這個順序就是同一天平手時的優先序**（前面的贏）。
 * key 與顯示文字是對外契約，不要改名。
 */
export const FESTIVALS: readonly FestivalDef[] = [
  { key: "new-year", label: "新年快樂", fixed: { month: 1, day: 1 } },
  { key: "lunar-new-year", label: "新年快樂" },
  { key: "lantern", label: "元宵節快樂" },
  { key: "dragon-boat", label: "端午節快樂" },
  { key: "mid-autumn", label: "中秋節快樂" },
  { key: "halloween", label: "萬聖節快樂", fixed: { month: 10, day: 31 } },
  { key: "christmas", label: "聖誕節快樂", fixed: { month: 12, day: 25 } },
];

/** 節慶前幾天開始換圖：D-5 到 D，含頭尾。 */
export const LEAD_DAYS = 5;

type DateTable = Record<string, Partial<Record<FestivalKey, string>>>;
const DATES = dateTable as DateTable;

const pad = (n: number): string => String(n).padStart(2, "0");

const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * 台北時間的「那一天」，格式 YYYY-MM-DD。
 *
 * 一律走 `Asia/Taipei`，不看瀏覽器或執行環境的時區：台北 10/31 早上 7 點
 * 在 UTC 還是 10/30，用 UTC 判定就會慢一天。
 */
export function taipeiDayKey(now: Date | string): string {
  const date = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${String(now)}`);
  const parts = dayKeyFormatter.formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM-DD 加減天數。用 UTC 中午算，避開日光節約與時區位移。 */
export function shiftDay(dayKey: string, delta: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 兩個 YYYY-MM-DD 相差幾天（to - from）。 */
function daysBetween(from: string, to: string): number {
  const ms = (key: string): number => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** 某個節慶在某一年是哪一天；查不到（超出日期表）回 null。 */
export function festivalDate(def: FestivalDef, year: number): string | null {
  if (def.fixed) return `${year}-${pad(def.fixed.month)}-${pad(def.fixed.day)}`;
  return DATES[String(year)]?.[def.key] ?? null;
}

/**
 * 從一群節慶裡挑出 `today` 當天 active 的那一個。
 *
 * 規則：active 區間 = [D-5, D]，含頭尾。同時有多個 active 時取最接近的
 * （`D - today` 最小），平手時照 `defs` 的順序。
 * 抽出來是為了能用造出來的資料測「重疊」的情況——真實節慶幾乎不會撞期。
 */
export function pickFestival(
  today: string,
  defs: readonly FestivalDef[],
  dateOf: (def: FestivalDef, year: number) => string | null = festivalDate,
): FestivalWindow | null {
  const year = Number(today.slice(0, 4));
  let bestWindow: FestivalWindow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOrder = Number.POSITIVE_INFINITY;

  for (const [order, def] of defs.entries()) {
    // 往前一年、今年、明年都看：12/27 的元旦窗口屬於明年，12/31 的聖誕窗口屬於今年。
    for (const candidate of [year - 1, year, year + 1]) {
      const date = dateOf(def, candidate);
      if (!date) continue;
      const startDate = shiftDay(date, -LEAD_DAYS);
      if (today < startDate || today > date) continue;
      const distance = daysBetween(today, date);
      const wins = distance < bestDistance || (distance === bestDistance && order < bestOrder);
      if (!wins) continue;
      bestWindow = { key: def.key, label: def.label, startDate, endDate: date };
      bestDistance = distance;
      bestOrder = order;
    }
  }
  return bestWindow;
}

/**
 * 今天 active 的節慶，沒有就 null。
 *
 * `settings` 預設讀 `FESTIVAL_SETTINGS`；`enabled === false` 時直接 null，
 * 也就是完全回到平常版、不載入任何節慶圖。
 */
export function festivalOn(
  now: Date | string,
  settings: { enabled: boolean } = FESTIVAL_SETTINGS,
): FestivalWindow | null {
  if (!settings.enabled) return null;
  return pickFestival(taipeiDayKey(now), FESTIVALS);
}

/** 節慶吉祥物檔名。小珊照這個名字丟進 `src/assets/festivals/` 就會自動生效。 */
export function festivalImageName(key: FestivalKey): string {
  return `bibihou-${key}-1024.png`;
}

/**
 * 從「檔名 → 打包後網址」的對照表裡挑出這個節慶要用的圖。
 *
 * 只比對檔名（不寫死清單），所以小珊把 `bibihou-halloween-1024.png` 丟進目錄、
 * 重新部署就會生效。找不到就回 null —— 沒有圖時畫面維持平常版，不會破圖。
 */
export function pickFestivalImage(
  files: Readonly<Record<string, string>>,
  festival: Pick<FestivalWindow, "key">,
): string | null {
  const wanted = festivalImageName(festival.key);
  for (const [path, url] of Object.entries(files)) {
    if (path.split("/").pop() === wanted && url) return url;
  }
  return null;
}

/**
 * 今天該用哪一張節慶圖：先看有沒有節慶，再看那個節慶的圖在不在。
 *
 * 「沒圖就不切換」是最重要的保險：小珊的圖還沒到、或某個節慶漏放，
 * 這裡就回 null，畫面維持平常版，不會出現破圖。
 */
export function activeFestivalImage(
  now: Date | string,
  files: Readonly<Record<string, string>>,
  settings: { enabled: boolean } = FESTIVAL_SETTINGS,
): { window: FestivalWindow; url: string } | null {
  const window = festivalOn(now, settings);
  if (!window) return null;
  const url = pickFestivalImage(files, window);
  return url ? { window, url } : null;
}

/**
 * 圖旁邊那行小字。沒有節慶、或 `showLabel` 關掉時回 null（就不渲染）。
 * 抽成純函式，DOM 那邊只管把字放上去。
 */
export function festivalLabelText(
  active: { window: FestivalWindow } | null,
  settings: { showLabel: boolean } = FESTIVAL_SETTINGS,
): string | null {
  if (!active) return null;
  return settings.showLabel ? active.window.label : null;
}

/** 這份農曆日期表涵蓋的年份，給測試與文件用。 */
export function festivalDateYears(): number[] {
  return Object.keys(DATES).map(Number).sort((a, b) => a - b);
}
