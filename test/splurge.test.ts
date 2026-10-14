import { describe, expect, it } from "vitest";
import { messages } from "../shared/i18n";
import { applySplurgeName, pickSplurgeName, SPLURGE_NAMES, SPLURGE_ROLL_MS } from "../shared/splurge";

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
    expect(SPLURGE_ROLL_MS).toBe(900);
    expect(SPLURGE_ROLL_MS).toBeGreaterThanOrEqual(800);
    expect(SPLURGE_ROLL_MS).toBeLessThanOrEqual(1_000);
    expect(messages.splurge).toBe("就想亂花錢");
    expect(messages.splurge.includes(messages.splurgeShort)).toBe(true);
    expect(messages.splurgeShort.length).toBeGreaterThan(1);
  });

  it("fills the name without focusing the field on a phone", () => {
    const field = {
      value: "",
      focused: false,
      focus() {
        this.focused = true;
      },
      blur() {
        this.focused = false;
      },
    };
    applySplurgeName(field, "貓砂", false);
    expect(field.value).toBe("貓砂");
    expect(field.focused).toBe(false);

    field.focused = true;
    applySplurgeName(field, "奶瓶", false);
    expect(field.value).toBe("奶瓶");
    expect(field.focused).toBe(false);

    applySplurgeName(field, "行李箱", true);
    expect(field.value).toBe("行李箱");
    expect(field.focused).toBe(true);
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
