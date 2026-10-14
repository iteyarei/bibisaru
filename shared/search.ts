import { platformSearchUrl } from "./platforms";
import { failureReason } from "./reliability";
import type { PlatformFetcher, PlatformId, PlatformReport, PlatformResult, SearchResponse } from "./types";

export function unavailableResult(id: PlatformId, query: string, reason?: string): PlatformResult {
  const result: PlatformResult = { id, status: "unavailable", products: [], searchUrl: platformSearchUrl(id, query) };
  if (reason) result.reason = reason;
  return result;
}

export async function searchPlatforms(
  query: string,
  ids: readonly PlatformId[],
  fetchers: Partial<Record<PlatformId, PlatformFetcher>>,
  now: () => Date = () => new Date(),
): Promise<SearchResponse> {
  const settled = await Promise.all(
    ids.map(async (id) => {
      const fetcher = fetchers[id];
      if (!fetcher) return unavailableResult(id, query, "exception: no fetcher");
      try {
        return await fetcher(query);
      } catch (error) {
        return unavailableResult(id, query, failureReason(error));
      }
    }),
  );

  const platforms: PlatformReport[] = settled.map((result) => {
    const report: PlatformReport = {
      id: result.id,
      status: result.status === "ok" && result.products.length === 0 ? "empty" : result.status,
      count: result.status === "ok" ? result.products.length : 0,
      searchUrl: result.searchUrl,
    };
    if (result.reason) report.reason = result.reason;
    return report;
  });

  return {
    query,
    fetchedAt: now().toISOString(),
    results: settled.flatMap((result) => (result.status === "ok" ? result.products : [])),
    platforms,
  };
}
