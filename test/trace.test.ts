import { describe, expect, it } from "vitest";
import { FETCH_COLO_TRACE_URL, parseTraceColo, readFetchColo } from "../shared/trace";

const sample = ["fl=abc", "h=www.cloudflare.com", "ip=1.2.3.4", "colo=iad", "loc=US", "tls=TLSv1.3"].join("\n");

describe("outbound fetch colo", () => {
  it("reads the colo line and drops the ip", () => {
    expect(parseTraceColo(sample)).toBe("IAD");
    expect(parseTraceColo("loc=HK\ncolo=HKG\n")).toBe("HKG");
    expect(parseTraceColo("loc=HK\ncolo=NOPE\n")).toBe("");
    expect(parseTraceColo("")).toBe("");
  });

  it("requests the trace endpoint and returns an empty colo on failure", async () => {
    const calls: Array<{ url: string; cache: RequestCache | undefined }> = [];
    const colo = await readFetchColo(async (input, init) => {
      calls.push({ url: String(input), cache: init?.cache });
      return new Response(sample, { status: 200 });
    });
    expect(colo).toBe("IAD");
    expect(calls).toEqual([{ url: FETCH_COLO_TRACE_URL, cache: "no-store" }]);
    expect(await readFetchColo(async () => new Response("colo=HKG", { status: 500 }))).toBe("");
    expect(
      await readFetchColo(async () => {
        throw new Error("network");
      }),
    ).toBe("");
  });
});
