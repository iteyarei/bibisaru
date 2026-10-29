import { platformSearchUrl } from "./platforms";
import { failureReason } from "./reliability";
import type { PlatformFetcher, PlatformId, PlatformReport, PlatformResult, SearchResponse } from "./types";

/** The reason a shop carries when the fetch budget ran out before it answered. */
export const SEARCH_TIMEOUT_REASON = "timeout";

export function unavailableResult(id: PlatformId, query: string, reason?: string): PlatformResult {
  const result: PlatformResult = { id, status: "unavailable", products: [], searchUrl: platformSearchUrl(id, query) };
  if (reason) result.reason = reason;
  return result;
}

/** Timer hooks, so a deadline can be tested without really waiting. */
export interface SearchTimer {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimer: SearchTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SearchLimits {
  /**
   * Wall-clock budget for the whole fan-out. A shop that has not answered by
   * then is reported as `timeout` and the response is built from the shops that
   * did answer, so one slow shop can never hold the caller. Omitted or 0 waits
   * for every shop, which is what /api/search still does.
   */
  budgetMs?: number;
  /**
   * Extra time granted when the budget ran out and not a single product has
   * arrived yet: an empty page is worse than a slower one, so give the shops a
   * second chance instead of rendering nothing.
   */
  extendIfEmptyMs?: number;
  /** Replaced in tests only. */
  timer?: SearchTimer;
}

function deadline(ms: number, timer: SearchTimer): { reached: Promise<void>; cancel: () => void } {
  let fire: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    fire = () => resolve();
  });
  const handle = timer.set(fire, ms);
  return { reached, cancel: () => timer.clear(handle) };
}

/** True when every shop settled before `limit` fired. */
async function settleWithin(all: Promise<unknown>, limit: Promise<void>): Promise<boolean> {
  return Promise.race([all.then(() => true), limit.then(() => false)]);
}

/**
 * Whether any shop was cut off by the budget. Such an answer is good enough to
 * show, but it is not the whole picture, so the caller keeps it only briefly
 * instead of for the full reuse window.
 */
export function hasTimedOutShop(platforms: readonly { reason?: string }[]): boolean {
  return platforms.some((platform) => platform.reason === SEARCH_TIMEOUT_REASON);
}

export async function searchPlatforms(
  query: string,
  ids: readonly PlatformId[],
  fetchers: Partial<Record<PlatformId, PlatformFetcher>>,
  now: () => Date = () => new Date(),
  colo = "",
  limits: SearchLimits = {},
): Promise<SearchResponse> {
  const timer = limits.timer ?? realTimer;
  // Holes stay `undefined` when a shop ran past the budget.
  const answers: Array<PlatformResult | undefined> = new Array(ids.length).fill(undefined);
  // How many products have arrived so far, read when the budget runs out.
  let productsSoFar = 0;

  const tasks = ids.map(async (id, index) => {
    const fetcher = fetchers[id];
    try {
      if (!fetcher) {
        answers[index] = unavailableResult(id, query, "exception: no fetcher");
        return;
      }
      const result = await fetcher(query);
      if (result.status === "ok" && result.products.length > 0) productsSoFar += result.products.length;
      answers[index] = result;
    } catch (error) {
      // A fetcher that throws must never take the whole fan-out down.
      answers[index] = unavailableResult(id, query, failureReason(error));
    }
  });

  const all = Promise.all(tasks);
  const budget = limits.budgetMs ?? 0;
  if (budget > 0) {
    const first = deadline(budget, timer);
    const done = await settleWithin(all, first.reached);
    first.cancel();
    const extra = limits.extendIfEmptyMs ?? 0;
    if (!done && extra > 0 && productsSoFar === 0) {
      const second = deadline(extra, timer);
      await settleWithin(all, second.reached);
      second.cancel();
    }
  } else {
    await all;
  }

  const settled = ids.map((id, index) => answers[index] ?? unavailableResult(id, query, SEARCH_TIMEOUT_REASON));

  const platforms: PlatformReport[] = settled.map((result) => {
    const report: PlatformReport = {
      id: result.id,
      status: result.status === "ok" && result.products.length === 0 ? "empty" : result.status,
      count: result.status === "ok" ? result.products.length : 0,
      searchUrl: result.searchUrl,
    };
    if (result.reason) report.reason = result.reason;
    if (result.fetchColo) report.fetchColo = result.fetchColo;
    return report;
  });

  return {
    query,
    fetchedAt: now().toISOString(),
    results: settled.flatMap((result) => (result.status === "ok" ? result.products : [])),
    platforms,
    meta: { colo, fetchColo: "" },
  };
}
