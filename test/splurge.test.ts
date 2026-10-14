import { describe, expect, it } from "vitest";
import { pickSplurgeName, SPLURGE_NAMES, SPLURGE_ROLL_MS } from "../shared/splurge";

describe("就想亂花錢", () => {
  it("keeps a broad pool of short product names", () => {
    expect(SPLURGE_NAMES.length).toBeGreaterThanOrEqual(300);
    expect(new Set(SPLURGE_NAMES).size).toBe(SPLURGE_NAMES.length);
    for (const name of SPLURGE_NAMES) expect(name.length).toBeLessThanOrEqual(40);
    expect(SPLURGE_NAMES).toContain("藍牙耳機");
    expect(SPLURGE_NAMES).toContain("電鍋");
    expect(SPLURGE_NAMES).toContain("沐浴乳");
    expect(SPLURGE_NAMES).toContain("拖鞋");
    expect(SPLURGE_NAMES).toContain("洋芋片");
    expect(SPLURGE_NAMES).toContain("Switch 手把");
    expect(SPLURGE_NAMES).toContain("貓砂");
    expect(SPLURGE_NAMES).toContain("嬰兒尿布");
    expect(SPLURGE_NAMES).toContain("行車紀錄器");
    expect(SPLURGE_NAMES).toContain("行李箱");
    expect(SPLURGE_NAMES).toContain("維他命");
    expect(SPLURGE_ROLL_MS).toBe(2_000);
  });

  it("fills a pool name and does not repeat the previous pick", () => {
    const first = pickSplurgeName("", () => 0);
    expect(first).toBe(SPLURGE_NAMES[0]);
    const again = pickSplurgeName(first, () => 0);
    expect(again).not.toBe(first);
    expect(SPLURGE_NAMES).toContain(again);
    const seen = new Set<string>();
    let previous = "";
    for (let step = 0; step < 40; step += 1) {
      const next = pickSplurgeName(previous, Math.random);
      expect(next).not.toBe(previous);
      expect(SPLURGE_NAMES).toContain(next);
      seen.add(next);
      previous = next;
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
