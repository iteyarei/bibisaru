import {
  addKeywords,
  parseKeywordDraft,
  prepareResults,
  removeKeywords,
} from "../shared/filter";
import { fill, formatCount, formatUpdated, messages, PRESET_EXCLUDE } from "../shared/i18n";
import { PLATFORM_IDS, PLATFORMS, platformById } from "../shared/platforms";
import { normalizeQuery } from "../shared/query";
import type { PlatformId, SearchResponse, SortMode } from "../shared/types";
import { defaultPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";
import { renderNotices, renderStage } from "./render";

const prefs: Prefs = loadPrefs();
let response: SearchResponse | null = null;
let query = "";
let loading = false;
let error: string | null = null;
let requestId = 0;

const searchForm = document.querySelector<HTMLFormElement>("#search-form")!;
const searchInput = document.querySelector<HTMLInputElement>("#q")!;
const searchButton = searchForm.querySelector<HTMLButtonElement>(".sbtn")!;
const excludeInput = document.querySelector<HTMLInputElement>("#exclude-input")!;
const presetButton = document.querySelector<HTMLButtonElement>("#preset")!;
const platformRoot = document.querySelector<HTMLElement>("#platforms")!;
const toolbar = document.querySelector<HTMLElement>("#toolbar")!;
const countNode = document.querySelector<HTMLElement>("#count")!;
const updatedNode = document.querySelector<HTMLElement>("#updated")!;
const sortSelect = document.querySelector<HTMLSelectElement>("#sort")!;
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
  });
}

function syncExclude(): void {
  document.querySelectorAll("#exclude .chip").forEach((node) => node.remove());
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
    excludeInput.before(chip);
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
  }
  const notices =
    response && !loading
      ? response.platforms.filter(
          (platform) =>
            prefs.platforms[platform.id] && (platform.status === "unavailable" || platform.status === "empty"),
        )
      : [];
  renderNotices(noticeRoot, notices);
  renderStage(stage, {
    loading,
    error,
    searched: Boolean(query),
    products,
    filtersHidResults,
    nothingFetched,
    onReset: resetFilters,
  });
  searchButton.setAttribute("aria-busy", loading ? "true" : "false");
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
    const endpoint = `/api/search?q=${encodeURIComponent(next)}&platforms=${ids.join(",")}`;
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
  const incoming = parseKeywordDraft(excludeInput.value);
  if (!incoming.length && !/[,，]/.test(excludeInput.value)) return;
  prefs.exclude = addKeywords(prefs.exclude, incoming);
  prefs.preset = PRESET_EXCLUDE.every((word) => prefs.exclude.includes(word));
  excludeInput.value = "";
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
  savePrefs(prefs);
  syncExclude();
  syncPlatforms();
  sortSelect.value = prefs.sort;
  if (query && enabledIds().join(",") !== before) void runSearch(query, false);
  else render();
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runSearch(searchInput.value, true);
});

excludeInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" || event.key === ",") {
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

excludeInput.addEventListener("input", () => {
  if (/[,，]/.test(excludeInput.value)) commitExclude();
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

window.addEventListener("popstate", () => {
  const next = new URLSearchParams(location.search).get("q") ?? "";
  searchInput.value = next;
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

renderPlatforms();
syncExclude();
sortSelect.value = prefs.sort;
render();

const initial = new URLSearchParams(location.search).get("q");
if (initial && normalizeQuery(initial)) {
  searchInput.value = initial;
  void runSearch(initial, false);
}
