import { addKeywords } from "../shared/filter";
import { PRESET_EXCLUDE } from "../shared/i18n";
import { PLATFORM_IDS } from "../shared/platforms";
import type { PlatformId, SortMode } from "../shared/types";

const STORAGE_KEY = "bibisaru.prefs.v1";

export interface Prefs {
  platforms: Record<PlatformId, boolean>;
  exclude: string[];
  sort: SortMode;
  preset: boolean;
}

export function defaultPrefs(): Prefs {
  return {
    platforms: { momo: true, pchome: true, coupang: true, yahoo: true, shopee: true },
    exclude: [],
    sort: "price-asc",
    preset: false,
  };
}

function presetComplete(exclude: readonly string[]): boolean {
  return PRESET_EXCLUDE.every((word) => exclude.includes(word));
}

export function loadPrefs(): Prefs {
  const prefs = defaultPrefs();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return prefs;
    const data = JSON.parse(raw) as Partial<Prefs>;
    const stored = data.platforms;
    if (stored && typeof stored === "object") {
      for (const id of PLATFORM_IDS) {
        if (typeof stored[id] === "boolean") prefs.platforms[id] = stored[id];
      }
    }
    if (Array.isArray(data.exclude)) {
      prefs.exclude = addKeywords(
        [],
        data.exclude.filter((item): item is string => typeof item === "string"),
      );
    }
    if (data.sort === "price-asc" || data.sort === "price-desc" || data.sort === "relevance") {
      prefs.sort = data.sort;
    }
    prefs.preset = data.preset === true && presetComplete(prefs.exclude);
    return prefs;
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export { presetComplete };
