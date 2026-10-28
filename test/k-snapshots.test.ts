import { describe, expect, it } from "vitest";
import { K_SNAPSHOTS, snapshotDate, snapshotForSlug, validateSnapshots } from "../shared/k-snapshots";
import { taipeiDate } from "../shared/k-page";

const item = {
  platform: "momo",
  title: "暖暖包",
  price: 89,
  image: "https://img.example.test/a.jpg",
  url: "https://www.momoshop.com.tw/goods/1",
  rank: 0,
};

describe("snapshots of retired pages", () => {
  it("accepts a well formed snapshot", () => {
    const parsed = validateSnapshots({ nuannuanbao: { date: "2024/01/15", products: [item] } });
    expect(parsed.nuannuanbao.date).toBe("2024/01/15");
    expect(parsed.nuannuanbao.products).toHaveLength(1);
  });

  it("rejects a snapshot whose date is not YYYY/MM/DD", () => {
    expect(() => validateSnapshots({ x: { date: "2024-01-15", products: [] } })).toThrow(/YYYY\/MM\/DD/);
    expect(() => validateSnapshots({ x: { products: [] } })).toThrow(/YYYY\/MM\/DD/);
  });

  it("rejects a product a page could not render", () => {
    expect(() => validateSnapshots({ x: { date: "2024/01/15", products: [{ ...item, price: 0 }] } })).toThrow(/invalid product/);
    expect(() => validateSnapshots({ x: { date: "2024/01/15", products: [{ ...item, title: " " }] } })).toThrow(/invalid product/);
    expect(() => validateSnapshots({ x: { date: "2024/01/15", products: "nope" } })).toThrow(/invalid product/);
  });

  it("rejects a file that is not an object", () => {
    expect(() => validateSnapshots([])).toThrow(/must be an object/);
    expect(() => validateSnapshots(null)).toThrow(/must be an object/);
  });

  it("looks a slug up case-insensitively and misses cleanly", () => {
    const store = validateSnapshots({ nuannuanbao: { date: "2024/01/15", products: [item] } });
    expect(snapshotForSlug(" NUANNUANBAO ", store)?.date).toBe("2024/01/15");
    expect(snapshotForSlug("chushiji", store)).toBeNull();
  });

  it("turns the stored date into noon in Taipei, so no timezone can shift the day", () => {
    const at = snapshotDate({ date: "2024/01/15", products: [] });
    expect(at.toISOString()).toBe("2024-01-15T04:00:00.000Z");
    expect(taipeiDate(at)).toBe("2024/01/15");
  });

  it("ships an empty store: every live page still fetches its own prices", () => {
    expect(Object.keys(K_SNAPSHOTS)).toHaveLength(0);
  });
});
