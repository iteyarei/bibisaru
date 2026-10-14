import { retryDelayFor, timeoutFor } from "./reliability";

/** 全聯全電商 search. Each call gets a new visitor id so a flagged id is not reused. */
export const PXGO_SEARCH_URL = "https://api-pxbox.es.pxmart.com.tw/app/3.0/spu/single_search";

export function randomVisitorId(random: () => string = () => crypto.randomUUID()): string {
  return random();
}

export function pxgoSearchBody(query: string, visitorId: string): string {
  return JSON.stringify({
    search_setting_type: 1,
    keyword: query,
    sort_type: 0,
    page_index: 1,
    page_size: 24,
    filters: [],
    visitor_id: visitorId,
    user_info_id: "",
    is_using_prod_es: false,
    skip_brand_detection: false,
  });
}

export function pxgoAttempt(query: string, fresh: boolean, visitorId = randomVisitorId()) {
  return {
    url: PXGO_SEARCH_URL,
    headers: PXGO_HEADERS,
    body: pxgoSearchBody(query, visitorId),
    fresh,
    timeoutMs: timeoutFor("pxgo"),
    retryDelayMs: retryDelayFor("pxgo"),
    visitorId,
  };
}

/**
 * Headers a desktop Chrome page would send from pxbox to the search API.
 * The shared request helper still adds the matching Windows Chrome user-agent.
 */
export const PXGO_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  "content-type": "application/json",
  origin: "https://pxbox.es.pxmart.com.tw",
  referer: "https://pxbox.es.pxmart.com.tw/",
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};
