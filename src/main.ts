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
import type { PlatformId, SearchResponse, SortMode } from "../shared/types";
import { groupHotKeywords, HOT_KEYWORDS, hotKeywordPath } from "../shared/hot-keywords";
import { bindClearButton } from "./clear-field";
import { applyFestivalMascot } from "./festival-mascot";
import { bindHotChipLoading } from "./hot-loading";
import { bindHotPopClose, createHotPop } from "./hot-pop";
import { bindFreshOnRestore, defaultPrefs, forgetSavedPrefs, resetPrefs, type Prefs } from "./prefs";
import { syncNewSiteNotice } from "./new-site";
import { renderNotices, renderStage } from "./render";
import { BUILD_VERSION } from "./version";

// Every visit starts from the default filters. Nothing is remembered between
// visits, and whatever an older build saved is deleted here.
forgetSavedPrefs();
const prefs: Prefs = defaultPrefs();
let response: SearchResponse | null = null;
let query = "";
let loading = false;
let error: string | null = null;
let requestId = 0;

const searchForm = document.querySelector<HTMLFormElement>("#search-form")!;
const searchInput = document.querySelector<HTMLInputElement>("#q")!;
const searchButton = searchForm.querySelector<HTMLButtonElement>(".sbtn")!;
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
const newSiteNotice = document.querySelector<HTMLElement>("#new-site");

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
  syncNewSiteNotice(newSiteNotice, location.hostname, query);
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
  syncPlatforms();
  searchInput.value = next;
  syncSearchClear();
  window.scrollTo(0, 0);
  void runSearch(next, true);
}

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
  syncExclude();
  render();
});

platformRoot.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-platform]");
  if (!button?.dataset.platform) return;
  const id = button.dataset.platform as PlatformId;
  const turningOn = !prefs.platforms[id];
  prefs.platforms[id] = turningOn;
  syncPlatforms();
  const alreadyFetched = response?.platforms.some((platform) => platform.id === id) ?? false;
  if (turningOn && query && !alreadyFetched) void runSearch(query, false);
  else render();
});

sortSelect.addEventListener("change", () => {
  prefs.sort = sortSelect.value as SortMode;
  render();
});

function onPriceInput(): void {
  prefs.priceMin = parsePriceBound(priceMinInput.value);
  prefs.priceMax = parsePriceBound(priceMaxInput.value);
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
        // A real link to the keyword's own landing page, which is server rendered
        // and carries the per-keyword title, description and canonical.
        link.href = hotKeywordPath(item.keyword);
        link.textContent = item.keyword;
        link.title = item.reason;
        list.append(link);
      }
      wrap.append(head, list);
      return wrap;
    }),
  );
}

const hotPopNode = document.querySelector<HTMLElement>("#hot-pop");
const hotPop = createHotPop({
  panel: hotPopNode,
  input: searchInput,
  enabled: HOT_KEYWORDS.length > 0,
});
const hotPopClose = document.querySelector<HTMLButtonElement>("#hot-pop-close");
if (hotPopClose) bindHotPopClose(hotPopClose, hotPop);

function hideHotPop(): void {
  hotPop.hide();
}
searchInput.addEventListener("focus", () => hotPop.onFocus());
searchInput.addEventListener("click", () => hotPop.onClickBox());
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideHotPop();
});
searchForm.addEventListener("submit", hideHotPop);

/**
 * A chip is a link to a server-rendered page, so a tap can look like nothing
 * happened for a second or two. This marks the chip and prints the waiting
 * line on the click itself, closes the panel so the line is not covered on a
 * phone, and clears both if the reader comes back.
 */
bindHotChipLoading({
  root: document.querySelector<HTMLElement>("#hot-groups"),
  status: document.querySelector<HTMLElement>("#hot-status"),
  hidePanel: hideHotPop,
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (target === searchInput || hotPopNode?.contains(target)) return;
  hideHotPop();
});
searchForm.addEventListener("focusout", (event) => {
  const next = event.relatedTarget as Node | null;
  // Focus staying on the box is not a blur; anything else means the box was left.
  if (next === searchInput) return;
  hotPop.onBlur();
  if (next && hotPopNode?.contains(next)) return;
  hideHotPop();
});

renderHotKeywords();
renderPlatforms();
// HTML 寫死平常版吉祥物，這裡才依當天節慶換圖（沒有節慶或還沒放圖就原封不動）。
applyFestivalMascot();

/**
 * Puts every box back to the default filters. Browsers may refill form fields
 * on their own (form restore after a reload or a restored tab), so the fields
 * are written explicitly instead of trusting what the HTML parser left there.
 */
function showFreshFilters(): void {
  excludeInput.value = "";
  syncExcludeClear();
  syncExclude();
  syncPlatforms();
  sortSelect.value = prefs.sort;
  priceMinInput.value = prefs.priceMin === null ? "" : String(prefs.priceMin);
  priceMaxInput.value = prefs.priceMax === null ? "" : String(prefs.priceMax);
}

/** The keyword in the address bar, from a shared link, a keyword page or history. */
function urlQuery(): string {
  const value = new URLSearchParams(location.search).get("q");
  return value && normalizeQuery(value) ? value : "";
}

showFreshFilters();
const initial = urlQuery();
searchInput.value = initial;
syncSearchClear();
render();
if (initial) void runSearch(initial, false);

// Coming back from the back/forward cache would otherwise show the old filters
// exactly as they were left. Reset them; the keyword in the address bar still
// counts, so its results are fetched again with all platforms on.
bindFreshOnRestore(() => {
  const before = enabledIds().join(",");
  resetPrefs(prefs);
  showFreshFilters();
  const next = urlQuery();
  searchInput.value = next;
  syncSearchClear();
  if (next && (next !== query || enabledIds().join(",") !== before || !response)) {
    void runSearch(next, false);
    return;
  }
  if (!next) {
    query = "";
    response = null;
    error = null;
    loading = false;
    document.title = messages.documentTitle;
  }
  render();
});
