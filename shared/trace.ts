import { normalizeColo } from "./reliability";

/** Probe for the colo that actually performs outbound fetches from this invocation. */
export const FETCH_COLO_TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const FETCH_COLO_TIMEOUT_MS = 1_500;

/** Read only the colo line. The trace also contains an IP, which must not be kept. */
export function parseTraceColo(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("colo=")) continue;
    return normalizeColo(trimmed.slice("colo=".length));
  }
  return "";
}

export async function readFetchColo(
  doFetch: typeof fetch = fetch,
  timeoutMs = FETCH_COLO_TIMEOUT_MS,
): Promise<string> {
  try {
    const response = await doFetch(FETCH_COLO_TRACE_URL, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return "";
    return parseTraceColo(await response.text());
  } catch {
    return "";
  }
}
