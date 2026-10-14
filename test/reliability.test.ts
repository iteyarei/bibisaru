import { describe, expect, it } from "vitest";
import { unavailableNote } from "../shared/i18n";
import {
  EXPECTED_UNAVAILABLE,
  failureReason,
  logUnavailableShops,
  normalizeColo,
  PAGES_REQUEST_LIMIT_MS,
  PLATFORM_RETRY_DELAY_MS,
  PXGO_RETRY_DELAY_MS,
  PXGO_TIMEOUT_MS,
  retriesPlatform,
  retryDelayFor,
  retryPlatform,
  searchCacheControl,
  searchCacheKeyFromRequest,
  searchCacheVersion,
  timeoutFor,
  unavailableLogLine,
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

  it("waits longer before the 全聯 retry", async () => {
    const waits: number[] = [];
    await retryPlatform(
      async ({ fresh }) => {
        if (!fresh) return missed("pxgo", "timeout");
        return { id: "pxgo", status: "ok", products: [], searchUrl: "https://example.com" };
      },
      async (ms) => {
        waits.push(ms);
      },
      PXGO_RETRY_DELAY_MS,
    );
    expect(waits).toEqual([800]);
    expect(timeoutFor("pxgo")).toBe(PXGO_TIMEOUT_MS);
    expect(timeoutFor("pxgo")).toBe(10_000);
    expect(retryDelayFor("pxgo")).toBe(800);
    expect(timeoutFor("momo")).toBe(8_000);
    expect(retryDelayFor("momo")).toBe(PLATFORM_RETRY_DELAY_MS);
  });

  it("retries scraped shops except coupang, and stays inside the pages limit", () => {
    expect(retriesPlatform("momo")).toBe(true);
    expect(retriesPlatform("pxgo")).toBe(true);
    expect(retriesPlatform("coupang")).toBe(false);
    expect(worstScrapedWaitMs()).toBe(PXGO_TIMEOUT_MS * 2 + PXGO_RETRY_DELAY_MS);
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
    expect(searchCacheControl(platforms)).toBe("public, max-age=30, s-maxage=180");
  });

  it("does not cache a response when a scraped shop failed", () => {
    const platforms = [
      { id: "momo" as const, status: "unavailable" as const },
      { id: "yahoo" as const, status: "ok" as const },
      { id: "coupang" as const, status: "unavailable" as const },
    ];
    expect(searchCacheControl(platforms)).toBe("no-store");
    expect(searchCacheControl([{ id: "pxgo", status: "unavailable" }])).toBe("no-store");
    expect(searchCacheControl([{ id: "pxgo", status: "empty" }])).toBe("public, max-age=30, s-maxage=180");
  });

  it("puts the deploy version on the cache key and ignores a visitor version", () => {
    const sha = "abc1234def567890";
    expect(searchCacheVersion(`  ${sha.toUpperCase()}  `)).toBe(sha);
    expect(searchCacheVersion("")).toBe("dev");
    expect(searchCacheVersion("not a sha")).toBe("dev");
    const request = "https://bibisaru.pages.dev/api/search?q=%E8%80%B3%E6%A9%9F&platforms=pxgo,momo&v=old-bundle";
    const key = searchCacheKeyFromRequest(request, sha);
    expect(key).toBe(
      `https://bibisaru.pages.dev/api/search?q=${encodeURIComponent("耳機")}&platforms=momo%2Cpxgo&v=${sha}`,
    );
    expect(key).not.toContain("old-bundle");
    expect(searchCacheKeyFromRequest(request, "ffff000")).not.toBe(key);
  });

  it("keeps colo to an airport code and logs reason with colo", () => {
    expect(normalizeColo(" tpe ")).toBe("TPE");
    expect(normalizeColo("TPE1")).toBe("");
    expect(normalizeColo(undefined)).toBe("");
    expect(unavailableNote("timeout", "TPE")).toBe("原因：timeout · TPE");
    expect(unavailableNote("http_403", "")).toBe("原因：http_403");
    expect(unavailableNote(undefined, "TPE")).toBe("TPE");
    expect(unavailableNote("http_403", "HKG", "IAD")).toBe("原因：http_403 · HKG · fetchColo IAD");
    expect(unavailableLogLine("pxgo", "timeout", "TPE")).toBe("reason=timeout colo=TPE platform=pxgo");
    expect(unavailableLogLine("pxgo", "http_403", "HKG", "IAD")).toBe(
      "reason=http_403 colo=HKG fetchColo=IAD platform=pxgo",
    );
    const lines: string[] = [];
    logUnavailableShops(
      [
        { id: "pxgo", status: "unavailable", reason: "timeout" },
        { id: "momo", status: "ok" },
        { id: "shopee", status: "unavailable" },
      ],
      "TPE",
      (line) => lines.push(line),
    );
    expect(lines).toEqual([
      "reason=timeout colo=TPE platform=pxgo",
      "reason=unknown colo=TPE platform=shopee",
    ]);
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
