import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLATFORM_IDS } from "../shared/platforms";
import {
  bindFreshOnRestore,
  defaultPrefs,
  forgetSavedPrefs,
  LEGACY_STORAGE_KEY,
  resetPrefs,
  type RestoreEvent,
} from "../src/prefs";

describe("filters are not remembered between visits", () => {
  it("starts with every platform on and no filters", () => {
    const prefs = defaultPrefs();
    expect(PLATFORM_IDS.every((id) => prefs.platforms[id])).toBe(true);
    expect(prefs.exclude).toEqual([]);
    expect(prefs.preset).toBe(false);
    expect(prefs.sort).toBe("price-asc");
    expect(prefs.priceMin).toBeNull();
    expect(prefs.priceMax).toBeNull();
  });

  it("deletes what an older build saved", () => {
    const store = new Map<string, string>([
      [LEGACY_STORAGE_KEY, JSON.stringify({ exclude: ["二手"], platforms: { momo: false } })],
      ["other", "keep"],
    ]);
    forgetSavedPrefs({ removeItem: (key) => void store.delete(key) });
    expect(store.has(LEGACY_STORAGE_KEY)).toBe(false);
    expect(store.get("other")).toBe("keep");
    expect(LEGACY_STORAGE_KEY).toBe("bibisaru.prefs.v1");
  });

  it("does not throw when storage is blocked or missing", () => {
    expect(() =>
      forgetSavedPrefs({
        removeItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).not.toThrow();
    expect(() => forgetSavedPrefs(null)).not.toThrow();
  });

  it("never writes to storage from the page script", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const prefs = readFileSync("src/prefs.ts", "utf8");
    expect(main).not.toMatch(/localStorage|sessionStorage|document\.cookie|savePrefs|loadPrefs/);
    expect(prefs).not.toMatch(/setItem|getItem|sessionStorage|document\.cookie/);
  });

  it("resets filters in place", () => {
    const prefs = defaultPrefs();
    prefs.exclude = ["二手", "殼"];
    prefs.preset = true;
    prefs.sort = "relevance";
    prefs.priceMin = 100;
    prefs.priceMax = 50;
    prefs.platforms.momo = false;
    resetPrefs(prefs);
    expect(prefs).toEqual(defaultPrefs());
  });
});

describe("back/forward cache", () => {
  function harness() {
    const listeners: Array<(event: RestoreEvent) => void> = [];
    let restores = 0;
    bindFreshOnRestore(
      () => {
        restores += 1;
      },
      { addEventListener: (type, listener) => type === "pageshow" && listeners.push(listener) },
    );
    return {
      fire: (event: RestoreEvent) => listeners.forEach((listener) => listener(event)),
      restores: () => restores,
    };
  }

  it("resets when the page comes back from the cache", () => {
    const page = harness();
    page.fire({ persisted: true });
    expect(page.restores()).toBe(1);
  });

  it("leaves a normal first load alone", () => {
    const page = harness();
    page.fire({ persisted: false });
    page.fire({});
    expect(page.restores()).toBe(0);
  });
});

describe("homepage form fields", () => {
  const html = readFileSync("index.html", "utf8");

  it("asks the browser not to refill the search and filter fields", () => {
    for (const id of ["q", "exclude-input", "price-min", "price-max"]) {
      const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] ?? "";
      expect(tag, id).toContain('autocomplete="off"');
    }
    expect(html).toMatch(/<select id="sort"[^>]*autocomplete="off"/);
    expect(html).toMatch(/<form id="search-form"[^>]*autocomplete="off"/);
    expect(html).toMatch(/<form class="ex" id="exclude"[^>]*autocomplete="off"/);
  });
});
