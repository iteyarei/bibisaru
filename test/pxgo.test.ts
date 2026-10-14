import { describe, expect, it } from "vitest";
import { PXGO_HEADERS, PXGO_SEARCH_URL, pxgoAttempt, pxgoSearchBody, randomVisitorId } from "../shared/pxgo";

describe("pxgo search request", () => {
  it("uses a new visitor id on every attempt", () => {
    const first = pxgoAttempt("牛奶", false, randomVisitorId());
    const second = pxgoAttempt("牛奶", true, randomVisitorId());
    const firstBody = JSON.parse(first.body) as { visitor_id: string; keyword: string };
    const secondBody = JSON.parse(second.body) as { visitor_id: string };
    expect(firstBody.keyword).toBe("牛奶");
    expect(firstBody.visitor_id).not.toBe("bibisaru");
    expect(firstBody.visitor_id).not.toBe(secondBody.visitor_id);
    expect(first.visitorId).not.toBe(second.visitorId);
    expect(pxgoSearchBody("牛奶", "visitor-a")).toContain('"visitor_id":"visitor-a"');
  });

  it("sends desktop browser headers, a 10s timeout, and an 800ms retry", () => {
    const attempt = pxgoAttempt("牛奶", false, "visitor-a");
    expect(attempt.url).toBe(PXGO_SEARCH_URL);
    expect(attempt.timeoutMs).toBe(10_000);
    expect(attempt.retryDelayMs).toBe(800);
    expect(attempt.fresh).toBe(false);
    expect(attempt.headers.accept).toContain("application/json");
    expect(attempt.headers["content-type"]).toBe("application/json");
    expect(attempt.headers.origin).toBe("https://pxbox.es.pxmart.com.tw");
    expect(attempt.headers.referer).toBe("https://pxbox.es.pxmart.com.tw/");
    expect(attempt.headers["sec-ch-ua"]).toContain("Google Chrome");
    expect(attempt.headers["sec-ch-ua-mobile"]).toBe("?0");
    expect(attempt.headers["sec-ch-ua-platform"]).toBe('"Windows"');
    expect(attempt.headers["sec-fetch-dest"]).toBe("empty");
    expect(attempt.headers["sec-fetch-mode"]).toBe("cors");
    expect(attempt.headers["sec-fetch-site"]).toBe("same-site");
    expect(PXGO_HEADERS["accept-language"]).toContain("zh-TW");
    expect(pxgoAttempt("牛奶", true, "visitor-b").fresh).toBe(true);
  });
});
