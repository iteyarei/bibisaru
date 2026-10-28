/**
 * 節慶吉祥圖的執行時接線。
 *
 * 圖放在 `src/assets/festivals/`，命名 `bibihou-<key>-512.png`。
 * 這裡用 `import.meta.glob` 把目錄裡的檔名收集起來，再依檔名判斷哪個節慶有圖：
 *   - 目錄空的時候 glob 回空物件，就算今天有節慶也**不切換**，所以不會破圖；
 *   - 小珊把圖丟進去、重新部署，圖就自動生效，不用改任何程式。
 * 512 優先，沒有 512 才退回 1024：畫面上吉祥物最大只有 168px，兩者看不出差別，
 * 但九張 512 只要 2MB，1024 要 6MB。
 */
import { activeFestivalImage, festivalLabelText, type FestivalWindow } from "../shared/festival";
import { FESTIVAL_SETTINGS } from "../shared/festival-config";

const FESTIVAL_FILES = import.meta.glob("./assets/festivals/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export interface ActiveFestivalMascot {
  window: FestivalWindow;
  url: string;
}

let resolved: ActiveFestivalMascot | null | undefined;

/** 今天該用哪一張節慶圖。沒有節慶、開關關掉、或圖還沒放進來都回 null。 */
export function activeFestivalMascot(now: Date = new Date()): ActiveFestivalMascot | null {
  if (resolved !== undefined) return resolved;
  resolved = activeFestivalImage(now, FESTIVAL_FILES);
  return resolved;
}

/** 只給測試用：清掉快取。 */
export function resetFestivalMascotCache(): void {
  resolved = undefined;
}

/** 吉祥物圖該用的 src；平常版就是 `/mascot.png`。 */
export function mascotSrc(): string {
  return activeFestivalMascot()?.url ?? "/mascot.png";
}

/** 圖片載入失敗就退回平常版，只退一次，避免無限重試。 */
export function bindMascotFallback(img: HTMLImageElement): void {
  img.addEventListener("error", () => {
    if (img.dataset.mascotFallback === "1") return;
    img.dataset.mascotFallback = "1";
    img.src = "/mascot.png";
  });
}

function preloadImage(doc: Document, url: string): void {
  const existing = doc.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]');
  for (const link of existing) if (link.getAttribute("href") === url) return;
  const link = doc.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  doc.head.append(link);
}

/**
 * 把頁面上既有的吉祥物圖換成節慶版，並補上節慶小字與 preload。
 * HTML 一律寫死 `/mascot.png`，所以沒有 JS 時照常顯示平常版；
 * 只有真的有節慶圖時才由這裡接手換掉。
 */
export function applyFestivalMascot(
  doc: Document = document,
  active: ActiveFestivalMascot | null = activeFestivalMascot(),
): void {
  if (!active) return;

  preloadImage(doc, active.url);

  for (const img of doc.querySelectorAll<HTMLImageElement>("img[data-mascot]")) {
    img.src = active.url;
    bindMascotFallback(img);
  }

  const text = festivalLabelText(active, FESTIVAL_SETTINGS);
  if (!text) return;
  for (const host of doc.querySelectorAll<HTMLElement>("[data-festival-label-host]")) {
    if (host.querySelector(".festival-label")) continue;
    const label = doc.createElement("p");
    label.className = "festival-label";
    label.textContent = text;
    host.append(label);
  }
}
