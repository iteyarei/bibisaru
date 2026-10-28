import { describe, expect, it } from "vitest";
import { Lunar } from "lunar-javascript";
import {
  activeFestivalImage,
  FESTIVALS,
  festivalDate,
  festivalDateYears,
  festivalImageName,
  festivalLabelText,
  festivalOn,
  pickFestival,
  pickFestivalImage,
  shiftDay,
  taipeiDayKey,
  type FestivalDef,
} from "../shared/festival";
import { FESTIVAL_SETTINGS } from "../shared/festival-config";

const OFF = { enabled: false };

/** 台北時間的某一天中午，避免 UTC 位移把日期推到前一天。 */
const taipeiNoon = (day: string): Date => new Date(`${day}T04:00:00Z`);

describe("taipeiDayKey", () => {
  it("reads the day in Asia/Taipei, not UTC", () => {
    // 台北 10/31 早上 07:00，UTC 還是 10/30 的 23:00。
    expect(taipeiDayKey(new Date("2026-10-30T23:00:00Z"))).toBe("2026-10-31");
  });

  it("keeps a late Taipei evening on the same day it happened", () => {
    // 台北 10/26 23:59，UTC 15:59。
    expect(taipeiDayKey(new Date("2026-10-26T15:59:00Z"))).toBe("2026-10-26");
  });

  it("accepts a date string and rejects garbage", () => {
    expect(taipeiDayKey("2026-12-25T04:00:00Z")).toBe("2026-12-25");
    expect(() => taipeiDayKey("not a date")).toThrow();
  });
});

describe("festivalOn for a fixed-date festival (Halloween)", () => {
  const halloween = { key: "halloween" as const, label: "萬聖節快樂", startDate: "2026-10-26", endDate: "2026-10-31" };

  it("is active on D-5", () => {
    expect(festivalOn(taipeiNoon("2026-10-26"))).toEqual(halloween);
  });

  it("is not active on D-6", () => {
    expect(festivalOn(taipeiNoon("2026-10-25"))).toBeNull();
  });

  it("is active on D", () => {
    expect(festivalOn(taipeiNoon("2026-10-31"))).toEqual(halloween);
  });

  it("is gone on D+1", () => {
    expect(festivalOn(taipeiNoon("2026-11-01"))).toBeNull();
  });

  it("uses Taipei time at the edges of the window", () => {
    // 台北 10/31 07:00 → 是節慶當天。
    expect(festivalOn(new Date("2026-10-30T23:00:00Z"))?.key).toBe("halloween");
    // 台北 10/26 23:59 → 窗口第一天，算 active。
    expect(festivalOn(new Date("2026-10-26T15:59:00Z"))?.key).toBe("halloween");
    // 台北 10/25 23:59 → 還差一天，不算。
    expect(festivalOn(new Date("2026-10-25T15:59:00Z"))).toBeNull();
  });
});

describe("festivalOn across the new year", () => {
  it("shows the new-year window from 12/27", () => {
    expect(festivalOn(taipeiNoon("2026-12-27"))).toEqual({
      key: "new-year",
      label: "新年快樂",
      startDate: "2026-12-27",
      endDate: "2027-01-01",
    });
  });

  it("is not up on 12/26", () => {
    expect(festivalOn(taipeiNoon("2026-12-26"))).toBeNull();
  });

  it("still shows on 1/1 and drops on 1/2", () => {
    expect(festivalOn(taipeiNoon("2027-01-01"))?.key).toBe("new-year");
    expect(festivalOn(taipeiNoon("2027-01-02"))).toBeNull();
  });
});

describe("festivalOn for lunar festivals", () => {
  it("uses the committed table for 2026", () => {
    expect(festivalOn(taipeiNoon("2026-02-17"))).toMatchObject({
      key: "lunar-new-year",
      label: "新年快樂",
      startDate: "2026-02-12",
      endDate: "2026-02-17",
    });
    expect(festivalOn(taipeiNoon("2026-03-03"))?.key).toBe("lantern");
    expect(festivalOn(taipeiNoon("2026-06-19"))?.key).toBe("dragon-boat");
    expect(festivalOn(taipeiNoon("2026-09-25"))?.key).toBe("mid-autumn");
  });

  it("returns null past the end of the table instead of throwing", () => {
    expect(() => festivalOn(taipeiNoon("2046-02-17"))).not.toThrow();
    expect(festivalOn(taipeiNoon("2046-02-17"))).toBeNull();
    expect(festivalOn(taipeiNoon("2099-06-01"))).toBeNull();
    // 固定日期的節慶沒有查表問題，2046 的萬聖節照樣算得出來。
    expect(festivalOn(taipeiNoon("2046-10-31"))?.key).toBe("halloween");
  });
});

describe("overlapping festivals", () => {
  // 真實的節慶在 2025-2045 之間完全沒有撞期，所以重疊一律用造出來的資料測。
  const backToBack: FestivalDef[] = [
    { key: "halloween", label: "萬聖節快樂", fixed: { month: 10, day: 31 } },
    { key: "christmas", label: "聖誕節快樂", fixed: { month: 11, day: 2 } },
  ];

  it("picks the nearer of two overlapping festivals", () => {
    // 10/30：萬聖剩 1 天、假節慶剩 3 天 → 萬聖。
    expect(pickFestival("2026-10-30", backToBack)?.key).toBe("halloween");
    // 11/1：萬聖過期了，只剩假節慶（剩 1 天）。
    expect(pickFestival("2026-11-01", backToBack)?.key).toBe("christmas");
  });

  it("does not just take the first entry in the list", () => {
    const farThenNear: FestivalDef[] = [
      { key: "christmas", label: "聖誕節快樂", fixed: { month: 11, day: 2 } },
      { key: "halloween", label: "萬聖節快樂", fixed: { month: 10, day: 31 } },
    ];
    // 清單第一個是較遠的那個，但 10/30 要取較近的萬聖。
    expect(pickFestival("2026-10-30", farThenNear)?.key).toBe("halloween");
  });

  it("breaks a tie with the order of the list", () => {
    // 兩個不同的 key 撞在同一天，距離相同 → 照清單順序。
    const tieDefs: FestivalDef[] = [
      { key: "halloween", label: "萬聖節快樂", fixed: { month: 10, day: 31 } },
      { key: "christmas", label: "聖誕節快樂", fixed: { month: 10, day: 31 } },
    ];
    expect(pickFestival("2026-10-29", tieDefs)?.key).toBe("halloween");
    expect(pickFestival("2026-10-29", [...tieDefs].reverse())?.key).toBe("christmas");
  });

  it("ignores a festival whose window already closed", () => {
    // 聖誕 12/25 的窗口是 12/20-12/25，所以 12/27 只剩元旦，不會挑到聖誕。
    expect(pickFestival("2026-12-27", FESTIVALS)?.key).toBe("new-year");
  });

  it("never lets a farther festival win while a nearer one is still live", () => {
    // 性質檢查：窗口都是 [D-5, D]，所以兩個都 active 時，D 較早的一定較近。
    // 也就是「取最接近」等價於「取最早結束的那個」，這條鎖住實作不要走鐘。
    for (let offset = 0; offset <= 5; offset += 1) {
      const today = shiftDay("2026-10-31", -offset);
      expect(pickFestival(today, backToBack)?.key).toBe("halloween");
    }
  });
});

describe("the settings switch", () => {
  it("returns null for every day when disabled", () => {
    for (const day of ["2026-01-01", "2026-02-17", "2026-10-31", "2026-12-25"]) {
      expect(festivalOn(taipeiNoon(day), OFF)).toBeNull();
    }
  });

  it("ships enabled with the label on", () => {
    expect(FESTIVAL_SETTINGS).toEqual({ enabled: true, showLabel: true });
  });
});

describe("the lunar date table", () => {
  const LUNAR: [string, number, number][] = [
    ["lunar-new-year", 1, 1],
    ["lantern", 1, 15],
    ["dragon-boat", 5, 5],
    ["mid-autumn", 8, 15],
  ];

  it("covers 2025 through 2045 with all four lunar festivals", () => {
    const years = festivalDateYears();
    expect(years[0]).toBe(2025);
    expect(years.at(-1)).toBe(2045);
    expect(years).toHaveLength(21);
  });

  it("matches lunar-javascript for every year in the table", () => {
    const mismatches: string[] = [];
    for (const year of festivalDateYears()) {
      const def = (key: string): FestivalDef => FESTIVALS.find((item) => item.key === key)!;
      for (const [key, month, day] of LUNAR) {
        const expected = Lunar.fromYmd(year, month, day).getSolar().toYmd();
        const actual = festivalDate(def(key), year);
        if (actual !== expected) mismatches.push(`${year} ${key}: table=${actual} lunar=${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("matches the dates the brief spot-checked", () => {
    const def = (key: string): FestivalDef => FESTIVALS.find((item) => item.key === key)!;
    expect({
      2026: {
        "lunar-new-year": festivalDate(def("lunar-new-year"), 2026),
        lantern: festivalDate(def("lantern"), 2026),
        "dragon-boat": festivalDate(def("dragon-boat"), 2026),
        "mid-autumn": festivalDate(def("mid-autumn"), 2026),
      },
      2027: {
        "lunar-new-year": festivalDate(def("lunar-new-year"), 2027),
        lantern: festivalDate(def("lantern"), 2027),
        "dragon-boat": festivalDate(def("dragon-boat"), 2027),
        "mid-autumn": festivalDate(def("mid-autumn"), 2027),
      },
      2028: {
        "lunar-new-year": festivalDate(def("lunar-new-year"), 2028),
        lantern: festivalDate(def("lantern"), 2028),
        "dragon-boat": festivalDate(def("dragon-boat"), 2028),
        "mid-autumn": festivalDate(def("mid-autumn"), 2028),
      },
    }).toEqual({
      2026: {
        "lunar-new-year": "2026-02-17",
        lantern: "2026-03-03",
        "dragon-boat": "2026-06-19",
        "mid-autumn": "2026-09-25",
      },
      2027: {
        "lunar-new-year": "2027-02-06",
        lantern: "2027-02-20",
        "dragon-boat": "2027-06-09",
        "mid-autumn": "2027-09-15",
      },
      2028: {
        "lunar-new-year": "2028-01-26",
        lantern: "2028-02-09",
        "dragon-boat": "2028-05-28",
        "mid-autumn": "2028-10-03",
      },
    });
  });
});

describe("image naming and lookup", () => {
  it("names files bibihou-<key>-1024.png", () => {
    expect(festivalImageName("halloween")).toBe("bibihou-halloween-1024.png");
    expect(festivalImageName("lunar-new-year")).toBe("bibihou-lunar-new-year-1024.png");
  });

  it("finds the image by file name, whatever the hashed url is", () => {
    const files = {
      "./assets/festivals/bibihou-halloween-1024.png": "/assets/bibihou-halloween-1024-a1b2.png",
      "./assets/festivals/bibihou-halloween-512.png": "/assets/bibihou-halloween-512-c3d4.png",
    };
    expect(pickFestivalImage(files, { key: "halloween" })).toBe(
      "/assets/bibihou-halloween-1024-a1b2.png",
    );
  });

  it("returns null when that festival has no image yet", () => {
    expect(pickFestivalImage({}, { key: "halloween" })).toBeNull();
    expect(
      pickFestivalImage({ "./assets/festivals/bibihou-christmas-1024.png": "/x.png" }, { key: "halloween" }),
    ).toBeNull();
  });
});

describe("activeFestivalImage: no image means no switch", () => {
  const empty = {};
  const halloweenOnly = {
    "./assets/festivals/bibihou-halloween-1024.png": "/assets/bibihou-halloween-1024-abc.png",
  };

  it("stays on the normal mascot while the folder is empty", () => {
    // 現在的真實狀態：10/31 是萬聖節，但圖還沒到，所以什麼都不該換。
    expect(activeFestivalImage(taipeiNoon("2026-10-31"), empty)).toBeNull();
  });

  it("switches as soon as the file with the right name is there", () => {
    expect(activeFestivalImage(taipeiNoon("2026-10-31"), halloweenOnly)).toEqual({
      window: {
        key: "halloween",
        label: "萬聖節快樂",
        startDate: "2026-10-26",
        endDate: "2026-10-31",
      },
      url: "/assets/bibihou-halloween-1024-abc.png",
    });
  });

  it("still stays normal on a day with no festival, whatever is in the folder", () => {
    expect(activeFestivalImage(taipeiNoon("2026-10-20"), halloweenOnly)).toBeNull();
  });

  it("respects the master switch", () => {
    expect(activeFestivalImage(taipeiNoon("2026-10-31"), halloweenOnly, OFF)).toBeNull();
  });
});

describe("the label text", () => {
  const active = { window: { key: "halloween" as const, label: "萬聖節快樂", startDate: "2026-10-26", endDate: "2026-10-31" } };

  it("uses the festival's own words", () => {
    expect(festivalLabelText(active)).toBe("萬聖節快樂");
  });

  it("renders nothing when showLabel is off", () => {
    expect(festivalLabelText(active, { showLabel: false })).toBeNull();
  });

  it("renders nothing when there is no festival", () => {
    expect(festivalLabelText(null)).toBeNull();
  });

  it("has a label for every key, and two of them read 新年快樂", () => {
    const labels = Object.fromEntries(FESTIVALS.map((item) => [item.key, item.label]));
    expect(labels).toEqual({
      "new-year": "新年快樂",
      "lunar-new-year": "新年快樂",
      lantern: "元宵節快樂",
      "dragon-boat": "端午節快樂",
      "mid-autumn": "中秋節快樂",
      halloween: "萬聖節快樂",
      christmas: "聖誕節快樂",
    });
  });
});
