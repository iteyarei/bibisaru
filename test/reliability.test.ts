import { describe, expect, it } from "vitest";
import {
  EXPECTED_UNAVAILABLE,
  failureReason,
  PAGES_REQUEST_LIMIT_MS,
  PLATFORM_RETRY_DELAY_MS,
  retriesPlatform,
  retryPlatform,
  searchCacheControl,
  searchCacheSeconds,
  worstScrapedWaitMs,
} from "../shared/reliability";
import { searchPlatforms } from "../shared/search";
import type { PlatformId, PlatformResult } from "../shared/types";

function missed(id: PlatformId, reason: string): PlatformResult {
  return { id, status: "unavailable", products: [], searchUrl: "https://example.com", reason };
}

describe("scraped platform retry", () => {
  it("tries once more after a failure, then keeps a success", async () => {
    const waits: number[] = [];
    const attempts: boolean[] = [];
    const result = await retryPlatform(
      async ({ fresh }) => {
        attempts.push(fresh);
        if (attempts.length === 1) return missed("momo", "http_503");
        return { id: "momo", status: "ok", products: [], searchUrl: "https://example.com" };
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(attempts).toEqual([false, true]);
    expect(waits).toEqual([PLATFORM_RETRY_DELAY_MS]);
    expect(result.status).toBe("ok");
  });

  it("does not retry a shop that already answered", async () => {
    let calls = 0;
    const result = await retryPlatform(async () => {
      calls += 1;
      return { id: "yahoo", status: "ok", products: [], searchUrl: "https://example.com" };
    }, async () => {
      throw new Error("should not wait");
    });
    expect(calls).toBe(1);
    expect(result.status).toBe("ok");
  });

  it("retries scraped shops except coupang, and stays inside the pages limit", () => {
    expect(retriesPlatform("momo")).toBe(true);
    expect(retriesPlatform("pxgo")).toBe(true);
    expect(retriesPlatform("coupang")).toBe(false);
    expect(worstScrapedWaitMs()).toBeLessThan(PAGES_REQUEST_LIMIT_MS);
  });
});

describe("unavailable reasons and cache", () => {
  it("names timeout, http status, parse errors, and exceptions", () => {
    expect(failureReason(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(
      "timeout",
    );
    expect(failureReason(new SyntaxError("Unexpected token"))).toBe("parse_error");
    expect(failureReason(new Error("upstream\nboom"))).toBe("exception: upstream boom");
    expect(failureReason(new Error("x".repeat(200))).length).toBe("exception: ".length + 120);
  });

  it("keeps the long cache when only the link-only shops failed", () => {
    const platforms = [
      { id: "momo" as const, status: "ok" as const },
      { id: "coupang" as const, status: "unavailable" as const },
      { id: "shopee" as const, status: "unavailable" as const },
    ];
    expect(EXPECTED_UNAVAILABLE).toEqual(["coupang", "shopee"]);
    expect(searchCacheSeconds(platforms)).toBe(180);
    expect(searchCacheControl(platforms)).toBe("public, max-age=30, s-maxage=180");
  });

  it("uses a short cache when a scraped shop failed", () => {
    const platforms = [
      { id: "momo" as const, status: "unavailable" as const },
      { id: "yahoo" as const, status: "ok" as const },
      { id: "coupang" as const, status: "unavailable" as const },
    ];
    expect(searchCacheSeconds(platforms)).toBe(20);
    expect(searchCacheControl(platforms)).toBe("public, max-age=20, s-maxage=20");
    expect(searchCacheSeconds([{ id: "pxgo", status: "empty" }])).toBe(180);
  });

  it("puts the reason on the platform entry when a fetch throws", async () => {
    const response = await searchPlatforms("s26 ultra", ["momo", "pchome"], {
      momo: async () => missed("momo", "http_502"),
      pchome: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    expect(response.platforms.map((platform) => [platform.id, platform.status, platform.reason])).toEqual([
      ["momo", "unavailable", "http_502"],
      ["pchome", "unavailable", "timeout"],
    ]);
  });
});
