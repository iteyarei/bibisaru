import { PLATFORM_IDS } from "../shared/platforms";
import type { PlatformId, SortMode } from "../shared/types";

/**
 * Key older builds saved filters under. Filters are no longer remembered: every
 * time the page is opened it starts from the defaults. The key is only kept so
 * the value an older build left behind can be wiped.
 */
export const LEGACY_STORAGE_KEY = "bibisaru.prefs.v1";

export interface Prefs {
  platforms: Record<PlatformId, boolean>;
  exclude: string[];
  sort: SortMode;
  preset: boolean;
  priceMin: number | null;
  priceMax: number | null;
}

/** All platforms on, no excluded words, cheapest first, no price range. */
export function defaultPrefs(): Prefs {
  return {
    platforms: Object.fromEntries(PLATFORM_IDS.map((id) => [id, true])) as Record<PlatformId, boolean>,
    exclude: [],
    sort: "price-asc",
    preset: false,
    priceMin: null,
    priceMax: null,
  };
}

/** The part of Storage this module touches. */
export interface RemovableStorage {
  removeItem(key: string): void;
}

function browserStorage(): RemovableStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some privacy modes throw on the mere access.
    return null;
  }
}

/**
 * Deletes the filters an older build saved (platform switches, excluded words,
 * sort, price range), so a returning visitor also starts clean. Never throws.
 */
export function forgetSavedPrefs(storage: RemovableStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Blocked storage has nothing of ours to delete.
  }
}

/** Puts every filter back to its default, in place, so references stay valid. */
export function resetPrefs(prefs: Prefs): void {
  Object.assign(prefs, defaultPrefs());
}

/** The only part of a pageshow event we read. */
export interface RestoreEvent {
  persisted?: boolean;
}

/**
 * Calls `onRestore` when the browser shows the page from its back/forward cache
 * (or a tab restored from memory), which would otherwise bring the old filters
 * back exactly as they were left. A normal first load is left alone.
 */
export function bindFreshOnRestore(
  onRestore: () => void,
  events: { addEventListener(type: string, listener: (event: RestoreEvent) => void): void } | null =
    typeof window === "undefined" ? null : window,
): void {
  events?.addEventListener("pageshow", (event) => {
    if (event?.persisted === true) onRestore();
  });
}
