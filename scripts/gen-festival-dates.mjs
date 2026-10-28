#!/usr/bin/env node
/**
 * 產生農曆節慶的國曆日期表：shared/festival-dates.json
 *
 * 只用來「離線」產生資料，`lunar-javascript` 是 devDependency，不會進到前端 bundle。
 * 前端執行時只讀這份 JSON（見 shared/festival.ts）。
 *
 * 用法：npm run festival:dates
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Lunar } = require("lunar-javascript");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "shared", "festival-dates.json");
const FIRST_YEAR = 2025;
const LAST_YEAR = 2045;

/** 農曆節慶：[key, 農曆月, 農曆日]。固定國曆的節慶（元旦、萬聖、聖誕）不需要這張表。 */
const LUNAR_FESTIVALS = [
  ["lunar-new-year", 1, 1],
  ["lantern", 1, 15],
  ["dragon-boat", 5, 5],
  ["ghost-festival", 7, 15],
  ["mid-autumn", 8, 15],
];

const table = {};
for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
  const row = {};
  for (const [key, month, day] of LUNAR_FESTIVALS) {
    row[key] = Lunar.fromYmd(year, month, day).getSolar().toYmd();
  }
  table[String(year)] = row;
}

const text = `${JSON.stringify(table, null, 2)}\n`;

let previous = null;
try {
  previous = readFileSync(OUT, "utf8");
} catch {
  previous = null;
}

if (previous === text) {
  console.log(`festival-dates.json 沒有變動（${FIRST_YEAR}-${LAST_YEAR}，每年 5 個農曆節慶）。`);
} else {
  writeFileSync(OUT, text);
  console.log(`已寫入 shared/festival-dates.json：${FIRST_YEAR}-${LAST_YEAR}，每年 5 個農曆節慶。`);
}
