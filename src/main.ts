import {
  addKeywords,
  commitKeywordDraft,
  keywordDraftHasDelimiter,
  parsePriceBound,
  prepareResults,
  removeKeywords,
} from "../shared/filter";
import { fill, formatCount, formatUpdated, messages, PRESET_EXCLUDE } from "../shared/i18n";
import { PLATFORM_IDS, PLATFORMS, platformById } from "../shared/platforms";
import { normalizeQuery } from "../shared/query";
import { similarQuery } from "../shared/similar";
import { applySplurgeName, pickSplurgeName, SPLURGE_ROLL_MS } from "../shared/splurge";
import type { PlatformId, SearchResponse, SortMode } from "../shared/types";
import { groupHotKeywords, HOT_KEYWORDS, hotKeywordPath } from "../shared/hot-keywords";
import { bindClearButton } from "./clear-field";
import { defaultPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";
import { renderNotices, renderStage } from "./render";
import { BUILD_VERSION } from "./version";

const prefs: Prefs = loadPrefs();
let response: SearchResponse | null = null;
let query = "";
let loading = false;
let error: string | null = null;
let requestId = 0;

const searchForm = document.querySelector<HTMLFormElement>("#search-form")!;
const searchInput = document.querySelector<HTMLInputElement>("#q")!;
const searchButton = searchForm.querySelector<HTMLButtonElement>(".sbtn")!;
const splurgeButton = document.querySelector<HTMLButtonElement>("#splurge")!;
const syncSearchClear = bindClearButton(searchInput, document.querySelector<HTMLButtonElement>("#clear-q")!);
const excludeInput = document.querySelector<HTMLInputElement>("#exclude-input")!;
const syncExcludeClear = bindClearButton(
  excludeInput,
  document.querySelector<HTMLButtonElement>("#clear-exclude")!,
);
const presetButton = document.querySelector<HTMLButtonElement>("#preset")!;
const platformRoot = document.querySelector<HTMLElement>("#platforms")!;
const toolbar = document.querySelector<HTMLElement>("#toolbar")!;
const countNode = document.querySelector<HTMLElement>("#count")!;
const updatedNode = document.querySelector<HTMLElement>("#updated")!;
const sortSelect = document.querySelector<HTMLSelectElement>("#sort")!;
const priceMinInput = document.querySelector<HTMLInputElement>("#price-min")!;
const priceMaxInput = document.querySelector<HTMLInputElement>("#price-max")!;
const noticeRoot = document.querySelector<HTMLElement>("#notices")!;
const stage = document.querySelector<HTMLElement>("#stage")!;

function enabledIds(): PlatformId[] {
  return PLATFORM_IDS.filter((id) => prefs.platforms[id]);
}

function visibleProducts() {
  if (!response) return [];
  return prepareResults(response.results, {
    keywords: prefs.exclude,
    platforms: enabledIds(),
    sort: prefs.sort,
    query,
    priceMin: prefs.priceMin,
    priceMax: prefs.priceMax,
  });
}

function syncExclude(): void {
  const chipRoot = document.querySelector<HTMLElement>("#chips")!;
  chipRoot.replaceChildren();
  prefs.exclude.forEach((word, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const text = document.createElement("span");
    text.textContent = word;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removeIndex = String(index);
    remove.textContent = "×";
    remove.setAttribute("aria-label", fill(messages.removeKeyword, { word }));
    chip.append(text, remove);
    chipRoot.append(chip);
  });
  presetButton.setAttribute("aria-pressed", String(prefs.preset));
}

function syncPlatforms(): void {
  for (const button of platformRoot.querySelectorAll<HTMLButtonElement>(".pill")) {
    const id = button.dataset.platform as PlatformId;
    const on = prefs.platforms[id];
    button.classList.toggle("off", !on);
    button.setAttribute("aria-pressed", String(on));
    const label = button.querySelector("span");
    if (label) label.textContent = on ? `${platformById(id).name} ✓` : platformById(id).name;
  }
}

function render(): void {
  const products = visibleProducts();
  const filtersHidResults = Boolean(response && response.results.length > 0 && products.length === 0);
  const nothingFetched = Boolean(response && response.results.length === 0);
  toolbar.hidden = !response || loading;
  if (response && !loading) {
    countNode.textContent = fill(messages.resultCount, { n: formatCount(products.length) });
    updatedNode.textContent = formatUpdated(response.fetchedAt);
    // Don't rewrite the select while it is open. Assigning its value inside the
    // change event makes some browsers snap back to the previous option.
    if (document.activeElement !== sortSelect && sortSelect.value !== prefs.sort) {
      sortSelect.value = prefs.sort;
    }
    syncPriceInput(priceMinInput, prefs.priceMin);
    syncPriceInput(priceMaxInput, prefs.priceMax);
  }
  const notices =
    response && !loading
      ? response.platforms.filter(
          (platform) =>
            prefs.platforms[platform.id] && (platform.status === "unavailable" || platform.status === "empty"),
        )
      : [];
  renderNotices(noticeRoot, notices, response?.meta.colo ?? "", response?.meta.fetchColo ?? "");
  renderStage(stage, {
    loading,
    error,
    searched: Boolean(query),
    products,
    filtersHidResults,
    nothingFetched,
    onReset: resetFilters,
    onSimilar: searchSimilar,
  });
  searchButton.setAttribute("aria-busy", loading ? "true" : "false");
}

function syncPriceInput(input: HTMLInputElement, bound: number | null): void {
  if (document.activeElement === input) return;
  const next = bound === null ? "" : String(bound);
  if (input.value !== next) input.value = next;
}

function renderPlatforms(): void {
  platformRoot.replaceChildren();
  for (const platform of PLATFORMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.style.setProperty("--c", platform.color);
    button.dataset.platform = platform.id;
    button.append(document.createElement("i"), document.createElement("span"));
    platformRoot.append(button);
  }
  syncPlatforms();
}

async function runSearch(raw: string, pushHistory: boolean): Promise<void> {
  const next = normalizeQuery(raw);
  if (!next) {
    error = messages.missingQuery;
    render();
    return;
  }
  const ids = enabledIds();
  if (!ids.length) {
    error = messages.enableOne;
    query = next;
    response = null;
    render();
    return;
  }

  const current = ++requestId;
  loading = true;
  error = null;
  query = next;
  render();
  if (pushHistory) {
    const page = `/?q=${encodeURIComponent(next)}`;
    if (`${location.pathname}${location.search}` !== page) history.pushState({ q: next }, "", page);
  }
  document.title = fill(messages.searchTitle, { q: next });

  try {
    const endpoint = `/api/search?q=${encodeURIComponent(next)}&platforms=${ids.join(",")}&v=${encodeURIComponent(BUILD_VERSION)}`;
    const result = await fetch(endpoint);
    const body = (await result.json()) as SearchResponse & { error?: string };
    if (current !== requestId) return;
    if (!result.ok || !Array.isArray(body.results)) {
      throw new Error(body.error || messages.networkError);
    }
    response = body;
    error = null;
  } catch (caught) {
    if (current !== requestId) return;
    response = null;
    error = caught instanceof Error && caught.message ? caught.message : messages.networkError;
  } finally {
    if (current === requestId) {
      loading = false;
      render();
    }
  }
}

function commitExclude(): void {
  const draft = commitKeywordDraft(prefs.exclude, excludeInput.value);
  if (!draft.clear) return;
  prefs.exclude = draft.keywords;
  prefs.preset = PRESET_EXCLUDE.every((word) => prefs.exclude.includes(word));
  excludeInput.value = "";
  syncExcludeClear();
  savePrefs(prefs);
  syncExclude();
  render();
}

function resetFilters(): void {
  const before = enabledIds().join(",");
  const fresh = defaultPrefs();
  prefs.exclude = fresh.exclude;
  prefs.preset = false;
  prefs.sort = fresh.sort;
  prefs.platforms = fresh.platforms;
  prefs.priceMin = null;
  prefs.priceMax = null;
  savePrefs(prefs);
  syncExclude();
  syncPlatforms();
  sortSelect.value = prefs.sort;
  priceMinInput.value = "";
  priceMaxInput.value = "";
  if (query && enabledIds().join(",") !== before) void runSearch(query, false);
  else render();
}

function searchSimilar(title: string): void {
  const next = normalizeQuery(similarQuery(title));
  if (!next) return;
  commitExclude();
  for (const id of PLATFORM_IDS) prefs.platforms[id] = true;
  savePrefs(prefs);
  syncPlatforms();
  searchInput.value = next;
  syncSearchClear();
  window.scrollTo(0, 0);
  void runSearch(next, true);
}

let lastSplurge = "";
let splurgeRolling = false;
splurgeButton.setAttribute("aria-label", messages.splurgeLabel);
splurgeButton.style.setProperty("--splurge-roll", `${SPLURGE_ROLL_MS}ms`);
const splurgeFull = splurgeButton.querySelector(".splurge-full");
const splurgeShort = splurgeButton.querySelector(".splurge-short");
if (splurgeFull) splurgeFull.textContent = messages.splurge;
if (splurgeShort) splurgeShort.textContent = messages.splurgeShort;
const desktopPointer = (): boolean => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
// mousedown, not pointerdown: canceling pointerdown can swallow the click on touch screens.
splurgeButton.addEventListener("mousedown", (event) => {
  event.preventDefault();
});
splurgeButton.addEventListener("click", () => {
  // A disabled button does not run CSS animations on its children, so the
  // dice stay still. Block repeat clicks without setting disabled.
  if (splurgeRolling) return;
  if (!desktopPointer()) searchInput.blur();
  splurgeRolling = true;
  splurgeButton.setAttribute("aria-disabled", "true");
  splurgeButton.classList.remove("rolling");
  void splurgeButton.offsetWidth;
  splurgeButton.classList.add("rolling");
  window.setTimeout(() => {
    const next = pickSplurgeName(lastSplurge);
    lastSplurge = next;
    applySplurgeName(searchInput, next, desktopPointer());
    syncSearchClear();
    splurgeButton.classList.remove("rolling");
    splurgeButton.removeAttribute("aria-disabled");
    splurgeRolling = false;
  }, SPLURGE_ROLL_MS);
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  commitExclude();
  void runSearch(searchInput.value, true);
});

document.querySelector<HTMLFormElement>("#exclude")!.addEventListener("submit", (event) => {
  event.preventDefault();
  commitExclude();
});

excludeInput.addEventListener("keydown", (event) => {
  // Virtual keyboards often send keyCode 229 while composing and never a real Enter.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitExclude();
  } else if (event.key === "Backspace" && excludeInput.value === "" && prefs.exclude.length) {
    prefs.exclude = prefs.exclude.slice(0, -1);
    prefs.preset = PRESET_EXCLUDE.every((word) => prefs.exclude.includes(word));
    savePrefs(prefs);
    syncExclude();
    render();
  }
});

excludeInput.addEventListener("input", (event) => {
  if (event instanceof InputEvent && event.isComposing) return;
  if (keywordDraftHasDelimiter(excludeInput.value)) commitExclude();
});

excludeInput.addEventListener("compositionend", () => {
  if (keywordDraftHasDelimiter(excludeInput.value)) commitExclude();
});

excludeInput.addEventListener("blur", () => {
  commitExclude();
});

document.querySelector("#exclude")!.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-index]");
  if (!button) return;
  const index = Number(button.dataset.removeIndex);
  prefs.exclude = prefs.exclude.filter((_word, wordIndex) => wordIndex !== index);
  prefs.preset = PRESET_EXCLUDE.every((word) => prefs.exclude.includes(word));
  savePrefs(prefs);
  syncExclude();
  render();
});

presetButton.addEventListener("click", () => {
  if (prefs.preset) {
    prefs.exclude = removeKeywords(prefs.exclude, PRESET_EXCLUDE);
    prefs.preset = false;
  } else {
    prefs.exclude = addKeywords(prefs.exclude, PRESET_EXCLUDE);
    prefs.preset = true;
  }
  savePrefs(prefs);
  syncExclude();
  render();
});

platformRoot.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-platform]");
  if (!button?.dataset.platform) return;
  const id = button.dataset.platform as PlatformId;
  const turningOn = !prefs.platforms[id];
  prefs.platforms[id] = turningOn;
  savePrefs(prefs);
  syncPlatforms();
  const alreadyFetched = response?.platforms.some((platform) => platform.id === id) ?? false;
  if (turningOn && query && !alreadyFetched) void runSearch(query, false);
  else render();
});

sortSelect.addEventListener("change", () => {
  prefs.sort = sortSelect.value as SortMode;
  savePrefs(prefs);
  render();
});

function onPriceInput(): void {
  prefs.priceMin = parsePriceBound(priceMinInput.value);
  prefs.priceMax = parsePriceBound(priceMaxInput.value);
  savePrefs(prefs);
  render();
}

priceMinInput.addEventListener("input", onPriceInput);
priceMaxInput.addEventListener("input", onPriceInput);

window.addEventListener("popstate", () => {
  const next = new URLSearchParams(location.search).get("q") ?? "";
  searchInput.value = next;
  syncSearchClear();
  if (normalizeQuery(next)) {
    void runSearch(next, false);
    return;
  }
  query = "";
  response = null;
  error = null;
  loading = false;
  document.title = messages.documentTitle;
  render();
});

function renderHotKeywords(): void {
  const root = document.querySelector<HTMLElement>("#hot-groups");
  if (!root) return;
  root.replaceChildren(
    ...groupHotKeywords(HOT_KEYWORDS).map((group) => {
      const wrap = document.createElement("div");
      wrap.className = "hot-group";
      const head = document.createElement("h3");
      head.textContent = group.category;
      const list = document.createElement("div");
      list.className = "hot-list";
      for (const item of group.items) {
        const link = document.createElement("a");
        link.className = "hot-chip";
        link.href = hotKeywordPath(item.keyword);
        link.textContent = item.keyword;
        link.title = item.reason;
        link.addEventListener("click", (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          searchInput.value = item.keyword;
          syncSearchClear();
          window.scrollTo(0, 0);
          void runSearch(item.keyword, true);
        });
        list.append(link);
      }
      wrap.append(head, list);
      return wrap;
    }),
  );
}

renderHotKeywords();
renderPlatforms();
syncExclude();
sortSelect.value = prefs.sort;
priceMinInput.value = prefs.priceMin === null ? "" : String(prefs.priceMin);
priceMaxInput.value = prefs.priceMax === null ? "" : String(prefs.priceMax);
render();

const initial = new URLSearchParams(location.search).get("q");
if (initial && normalizeQuery(initial)) {
  searchInput.value = initial;
  syncSearchClear();
  void runSearch(initial, false);
}
