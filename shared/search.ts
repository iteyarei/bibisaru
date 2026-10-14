import { platformSearchUrl } from "./platforms";
import type { PlatformFetcher, PlatformId, PlatformReport, PlatformResult, SearchResponse } from "./types";

export function unavailableResult(id: PlatformId, query: string): PlatformResult {
  return { id, status: "unavailable", products: [], searchUrl: platformSearchUrl(id, query) };
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
      if (!fetcher) return unavailableResult(id, query);
      try {
        return await fetcher(query);
      } catch {
        return unavailableResult(id, query);
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
