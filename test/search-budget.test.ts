import { beforeEach, describe, expect, it } from "vitest";
import { handleKPath, K_PARTIAL_REUSE_MS, K_REUSE_MS, resetKReuse } from "../shared/k-route";
import { K_PAGE_FETCH_BUDGET_MS, K_PAGE_FETCH_EXTEND_MS } from "../shared/reliability";
import { searchPlatforms, type SearchLimits, type SearchTimer } from "../shared/search";
import type { PlatformFetcher, PlatformId, PlatformResult, Product } from "../shared/types";

/**
 * The landing page races every shop against one wall clock. These cases drive
 * that clock by hand so the budget is proved, not assumed.
 */

function product(platform: PlatformId, price: number): Product {
  return {
    platform,
    title: `${platform} 除濕機`,
    price,
    image: "",
    url: `https://www.momoshop.com.tw/goods/${platform}`,
    rank: 0,
  };
}

function answered(platform: PlatformId, prices: number[]): PlatformResult {
  return { id: platform, status: "ok", products: prices.map((price) => product(platform, price)), searchUrl: "" };
}

const fast =
  (platform: PlatformId, prices: number[]): PlatformFetcher =>
  async () =>
    answered(platform, prices);

/** Never settles: stands in for 奇摩 answering Cloudflare with an unreadable page. */
const hanging: PlatformFetcher = () => new Promise<PlatformResult>(() => undefined);

interface FakeClock {
  timer: SearchTimer;
  /** Fire every armed timer, as if all of them came due together. */
  fire(): void;
  pending(): number;
  armedWith(): number[];
}

function fakeClock(): FakeClock {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    timer: {
      set(callback: () => void, ms: number) {
        const id = nextId;
        nextId += 1;
        pending.set(id, callback);
        delays.push(ms);
        return id;
      },
      clear(handle: unknown) {
        pending.delete(handle as number);
      },
    },
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback();
    },
    pending: () => pending.size,
    armedWith: () => delays,
  };
}

/** Let every already-resolved promise record its answer. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

const NOW = () => new Date("2026-10-29T04:00:00Z");

describe("searchPlatforms budget", () => {
  it("keeps the shops that answered and marks the rest as timeouts", async () => {
    const clock = fakeClock();
    const run = searchPlatforms(
      "除濕機",
      ["momo", "pchome", "yahoo"],
      { momo: fast("momo", [990]), pchome: fast("pchome", [1_290]), yahoo: hanging },
      NOW,
      "HKG",
      { budgetMs: 1_800, timer: clock.timer },
    );

    await flush();
    clock.fire();
    const response = await run;

    expect(response.platforms.map((platform) => [platform.id, platform.status, platform.count])).toEqual([
      ["momo", "ok", 1],
      ["pchome", "ok", 1],
      ["yahoo", "unavailable", 0],
    ]);
    expect(response.platforms[2]?.reason).toBe("timeout");
    expect(response.results.map((item) => item.price).sort((a, b) => a - b)).toEqual([990, 1_290]);
    expect(response.meta.colo).toBe("HKG");
  });

  it("arms one timer for the whole fan-out and clears it once the shops settle", async () => {
    const clock = fakeClock();
    const response = await searchPlatforms(
      "除濕機",
      ["momo", "pchome"],
      { momo: fast("momo", [1]), pchome: fast("pchome", [2]) },
      NOW,
      "",
      { budgetMs: 1_800, timer: clock.timer },
    );
    expect(response.platforms.every((platform) => platform.status === "ok")).toBe(true);
    // One shared deadline, not one per shop, and nothing is left armed.
    expect(clock.armedWith()).toEqual([1_800]);
    expect(clock.pending()).toBe(0);
  });

  it("grants the extra window when the budget ran out with nothing at all", async () => {
    const clock = fakeClock();
    let released: (result: PlatformResult) => void = () => undefined;
    const slow: PlatformFetcher = () =>
      new Promise<PlatformResult>((resolve) => {
        released = resolve;
      });

    const run = searchPlatforms("除濕機", ["momo"], { momo: slow }, NOW, "", {
      budgetMs: 1_800,
      extendIfEmptyMs: 1_200,
      timer: clock.timer,
    });

    await flush();
    // First budget: an empty page would be worse than a slower one, so wait on.
    clock.fire();
    await flush();
    expect(clock.armedWith()).toEqual([1_800, 1_200]);

    released(answered("momo", [777]));
    const response = await run;
    expect(response.platforms[0]?.status).toBe("ok");
    expect(response.results[0]?.price).toBe(777);
  });

  it("gives up after the extra window instead of waiting forever", async () => {
    const clock = fakeClock();
    const run = searchPlatforms("除濕機", ["momo", "yahoo"], { momo: hanging, yahoo: hanging }, NOW, "", {
      budgetMs: 1_800,
      extendIfEmptyMs: 1_200,
      timer: clock.timer,
    });

    await flush();
    clock.fire();
    await flush();
    clock.fire();
    const response = await run;

    expect(clock.armedWith()).toEqual([1_800, 1_200]);
    expect(response.platforms.map((platform) => platform.reason)).toEqual(["timeout", "timeout"]);
    expect(response.results).toEqual([]);
  });

  it("does not extend when a shop already brought products back", async () => {
    const clock = fakeClock();
    const run = searchPlatforms("除濕機", ["momo", "yahoo"], { momo: fast("momo", [500]), yahoo: hanging }, NOW, "", {
      budgetMs: 1_800,
      extendIfEmptyMs: 1_200,
      timer: clock.timer,
    });

    await flush();
    clock.fire();
    const response = await run;

    // Only the first deadline was ever needed.
    expect(clock.armedWith()).toEqual([1_800]);
    expect(response.results).toHaveLength(1);
  });

  it("still waits for every shop when no budget is given", async () => {
    const clock = fakeClock();
    const response = await searchPlatforms(
      "除濕機",
      ["momo", "yahoo"],
      { momo: fast("momo", [1]), yahoo: fast("yahoo", [2]) },
      NOW,
      "",
      { timer: clock.timer },
    );
    expect(response.platforms.every((platform) => platform.status === "ok")).toBe(true);
    expect(clock.armedWith()).toEqual([]);
  });
});

/**
 * A clock that also schedules the shops' answers, so the measured production
 * latencies can be replayed deterministically instead of waited out.
 */
function virtualClock() {
  interface Entry {
    at: number;
    seq: number;
    cb: () => void;
  }
  let now = 0;
  let seq = 0;
  const entries: Entry[] = [];

  function schedule(at: number, cb: () => void): number {
    seq += 1;
    const id = seq;
    entries.push({ at, seq: id, cb });
    return id;
  }

  const timer: SearchTimer = {
    set: (cb, ms) => schedule(now + ms, cb),
    clear: (handle) => {
      const index = entries.findIndex((entry) => entry.seq === handle);
      if (index >= 0) entries.splice(index, 1);
    },
  };

  /** Fire the next scheduled event, as a real clock eventually would. */
  async function step(): Promise<boolean> {
    const due = [...entries].sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
    if (!due) return false;
    entries.splice(entries.indexOf(due), 1);
    now = due.at;
    due.cb();
    // Let the promise chains the callback started settle before the next event.
    await flush();
    return true;
  }

  return { timer, after: (ms: number, cb: () => void) => schedule(ms, cb), step, now: () => now };
}

/** Live latency of each shop as measured on 2026-10-29, in ms. */
const MEASURED_MS: ReadonlyArray<readonly [PlatformId, number]> = [
  ["momo", 760],
  ["pchome", 1_680],
  ["yahoo", 13_200],
  ["pxgo", 1_510],
  ["etmall", 2_030],
  ["ruten", 400],
  ["shopee", 2_080],
  ["rakuten", 670],
  ["coupang", 260],
];

describe("a replay of the measured production latencies", () => {
  /** Drive the clock until the fan-out settles; the clock then reads its TTFB. */
  async function drive(clock: ReturnType<typeof virtualClock>, run: Promise<unknown>): Promise<void> {
    let settled = false;
    void run.then(() => {
      settled = true;
    });
    while (!settled) {
      if (!(await clock.step())) break;
    }
    await flush();
    expect(settled).toBe(true);
  }

  function runOn(clock: ReturnType<typeof virtualClock>, limits: SearchLimits | undefined) {
    const ids = MEASURED_MS.map(([id]) => id);
    const fetchers: Partial<Record<PlatformId, PlatformFetcher>> = {};
    for (const [id, ms] of MEASURED_MS) {
      fetchers[id] = () =>
        new Promise<PlatformResult>((resolve) => {
          clock.after(ms, () => {
            // 奇摩 answers 200 with a page our parser cannot read, then the proxy fails too.
            const result: PlatformResult =
              id === "yahoo"
                ? {
                    id,
                    status: "unavailable",
                    products: [],
                    reason: "direct: parse_error http_200; proxy: parse_error http_200",
                    searchUrl: "",
                  }
                : answered(id, [1_000]);
            resolve(result);
          });
        });
    }
    return searchPlatforms("除濕機", ids, fetchers, NOW, "HKG", limits);
  }

  it("returns at the budget and keeps every shop that made it", async () => {
    const clock = virtualClock();
    const run = runOn(clock, { budgetMs: 1_800, extendIfEmptyMs: 1_200, timer: clock.timer });
    await drive(clock, run);
    const response = await run;

    // 1.8s, not 13.2s: the slow shop no longer sets the pace.
    expect(clock.now()).toBe(1_800);
    const ok = response.platforms.filter((platform) => platform.status === "ok").map((platform) => platform.id);
    expect(ok.sort()).toEqual(["coupang", "momo", "pchome", "pxgo", "rakuten", "ruten"]);
    expect(response.platforms.filter((platform) => platform.reason === "timeout").map((platform) => platform.id).sort()).toEqual([
      "etmall",
      "shopee",
      "yahoo",
    ]);
  });

  it("would have waited 13.2s before, which is what the budget removes", async () => {
    const clock = virtualClock();
    const run = runOn(clock, {});
    await drive(clock, run);
    await run;
    expect(clock.now()).toBe(13_200);
  });
});

describe("the /k/ page under a hanging shop", () => {
  beforeEach(() => resetKReuse());

  /** A shop that answers at once and one that never does, wired the way the route wires them. */
  async function timePage(budgetMs: number | undefined): Promise<{ ms: number; body: string }> {
    const started = performance.now();
    const result = await handleKPath({
      pathname: "/k/chushiji/",
      now: NOW(),
      limits: budgetMs === undefined ? undefined : { budgetMs, timer: realTimer() },
      search: (keyword, limits) =>
        searchPlatforms(
          keyword,
          ["momo", "yahoo"],
          { momo: fast("momo", [8_990, 12_900]), yahoo: hanging },
          NOW,
          "",
          limits,
        ),
    });
    return { ms: performance.now() - started, body: result.body };
  }

  /** A short real timer, so the case measures a wait rather than pretending one. */
  function realTimer(): SearchTimer {
    return {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  it("returns quickly and still shows the shop that answered", async () => {
    const { ms, body } = await timePage(120);
    expect(ms).toBeLessThan(1_000);
    expect(body).toContain("除濕機 比價");
    // The live prices that did arrive are on the page.
    expect(body).toContain("NT$8,990");
  });

  it("serves a burst from a partial answer, but only briefly", async () => {
    const at = NOW();
    let calls = 0;
    const search = async (query: string, limits: SearchLimits) => {
      calls += 1;
      return searchPlatforms(
        query,
        ["momo", "yahoo"],
        { momo: fast("momo", [100 + calls]), yahoo: hanging },
        NOW,
        "",
        { ...limits, budgetMs: 20 },
      );
    };

    await handleKPath({ pathname: "/k/chushiji/", now: at, search });
    const burst = await handleKPath({ pathname: "/k/chushiji/", now: at, search });
    // One fan-out covers the burst, as before.
    expect(calls).toBe(1);
    expect(burst.body).toContain("NT$101");

    // But a hole from a timeout is not allowed to stand in for two minutes.
    expect(K_PARTIAL_REUSE_MS).toBeLessThan(K_REUSE_MS);
    await handleKPath({
      pathname: "/k/chushiji/",
      now: new Date(at.getTime() + K_PARTIAL_REUSE_MS + 1_000),
      search,
    });
    expect(calls).toBe(2);
  });

  it("keeps the long reuse window when every shop answered", async () => {
    const at = NOW();
    let calls = 0;
    const search = async (query: string) => {
      calls += 1;
      return {
        query,
        fetchedAt: at.toISOString(),
        results: [
          { platform: "momo" as const, title: `${query} 商品`, price: 900, image: "", url: "https://x.test", rank: 0 },
        ],
        platforms: [{ id: "momo" as const, status: "ok" as const, count: 1, searchUrl: "" }],
        meta: { colo: "", fetchColo: "" },
      };
    };
    await handleKPath({ pathname: "/k/chushiji/", now: at, search });
    await handleKPath({ pathname: "/k/chushiji/", now: new Date(at.getTime() + 60_000), search });
    expect(calls).toBe(1);
  });

  it("ships the fetch budget so a caller cannot hang on one shop", async () => {
    let seen: { budgetMs?: number; extendIfEmptyMs?: number } | null = null;
    await handleKPath({
      pathname: "/k/chushiji/",
      now: NOW(),
      search: async (_keyword, limits) => {
        seen = limits;
        return {
          query: "除濕機",
          fetchedAt: "2026-10-29T04:00:00.000Z",
          results: [],
          platforms: [],
          meta: { colo: "", fetchColo: "" },
        };
      },
    });
    expect(seen).not.toBeNull();
    expect(seen!.budgetMs).toBe(K_PAGE_FETCH_BUDGET_MS);
    expect(seen!.extendIfEmptyMs).toBe(K_PAGE_FETCH_EXTEND_MS);
    expect(K_PAGE_FETCH_BUDGET_MS).toBeLessThanOrEqual(2_000);
  });
});
