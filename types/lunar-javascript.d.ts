/**
 * `lunar-javascript` 沒有附型別，這裡只宣告我們用到的那一小塊。
 *
 * 這個套件只給 `scripts/gen-festival-dates.mjs` 與測試使用（devDependency），
 * 前端執行時不會 import 它。
 */
declare module "lunar-javascript" {
  export interface SolarDate {
    toYmd(): string;
  }
  export interface LunarDate {
    getSolar(): SolarDate;
  }
  export const Lunar: {
    fromYmd(year: number, month: number, day: number): LunarDate;
  };
}
