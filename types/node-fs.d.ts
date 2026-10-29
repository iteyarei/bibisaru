/**
 * 測試會直接讀 `src/styles.css`（Vite 的 `?raw` 對 CSS 會走 CSS 管線，拿到空字串），
 * 這個 repo 沒有裝 `@types/node`，所以在這裡宣告用到的那一個函式。
 */
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
