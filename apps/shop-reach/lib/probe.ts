import {
  COUPANG_API_ORIGIN,
  COUPANG_API_PATH,
  cleanCoupangKey,
  coupangAuthorization,
  coupangHmacHex,
  coupangSearchQuery,
  coupangSignedDate,
  coupangSignMessage,
  productsFromCoupangSearch,
} from "../vendor/shared/coupang-api";
import { rakutenProducts } from "../vendor/shared/normalize";
import { rawSearchUrl } from "../vendor/shared/platforms";
import { challengePage } from "./challenge";
import { decodeBody } from "./decode-body";
import type { ShopName } from "./gate";
import { KEYWORD_MAX } from "./gate";
import { publicText } from "./redact";

export interface ProbeReport {
  platform: ShopName;
  testedAt: string;
  sent: boolean;
  httpStatus: number | null;
  parsed: boolean;
  count: number | null;
  ok: boolean;
  reason: string | null;
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  accessKey?: string | null;
  secretKey?: string | null;
}

const COUPANG_HOST = "api-gateway.tw.coupang.com";
const RAKUTEN_HOST = "www.rakuten.com.tw";
const TIMEOUT_MS = 8_000;

const RAKUTEN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function envOf(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function report(platform: ShopName, fields: Omit<ProbeReport, "platform" | "testedAt">, testedAt = new Date()): ProbeReport {
  return { platform, testedAt: testedAt.toISOString(), ...fields };
}

function held(platform: ShopName, reason: string, testedAt?: Date): ProbeReport {
  return report(platform, { sent: false, httpStatus: null, parsed: false, count: null, ok: false, reason }, testedAt);
}

function fixedHttps(url: string, host: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== host) {
    throw new Error("refusing unexpected host");
  }
  return parsed.toString();
}

async function once(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, init);
}

export async function probeShop(platform: ShopName, keyword: string, options: ProbeOptions = {}): Promise<ProbeReport> {
  const testedAt = options.now ?? new Date();
  const trimmed = keyword.trim();
  if (!trimmed) return held(platform, "empty_keyword", testedAt);
  if (trimmed.length > KEYWORD_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return held(platform, "bad_request", testedAt);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  if (platform === "coupang") return probeCoupang(trimmed, options, fetchImpl, testedAt);
  return probeRakuten(trimmed, fetchImpl, testedAt);
}

async function probeCoupang(
  keyword: string,
  options: ProbeOptions,
  fetchImpl: typeof fetch,
  testedAt: Date,
): Promise<ProbeReport> {
  const env = envOf();
  const accessKey = cleanCoupangKey(options.accessKey === undefined ? env.COUPANG_ACCESS_KEY : options.accessKey);
  const secretKey = cleanCoupangKey(options.secretKey === undefined ? env.COUPANG_SECRET_KEY : options.secretKey);
  if (!accessKey || !secretKey) {
    return held(
      "coupang",
      `missing_keys COUPANG_ACCESS_KEY=${accessKey.length > 0} COUPANG_SECRET_KEY=${secretKey.length > 0}`,
      testedAt,
    );
  }
  const secrets = [accessKey, secretKey];
  const query = coupangSearchQuery(keyword);
  try {
    const signedDate = coupangSignedDate(testedAt);
    const signature = await coupangHmacHex(secretKey, coupangSignMessage(signedDate, query));
    const url = fixedHttps(`${COUPANG_API_ORIGIN}${COUPANG_API_PATH}?${query}`, COUPANG_HOST);
    const response = await once(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
          "User-Agent": "bibisaru/1.0",
          Authorization: coupangAuthorization(accessKey, signedDate, signature),
        },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      fetchImpl,
    );
    return await coupangResult(response, secrets, testedAt);
  } catch (error) {
    return report("coupang", {
      sent: true,
      httpStatus: null,
      parsed: false,
      count: null,
      ok: false,
      reason: `exception: ${publicText(error instanceof Error ? error.message : "unknown", secrets) || "unknown"}`,
    }, testedAt);
  }
}

async function coupangResult(response: Response, secrets: readonly string[], testedAt: Date): Promise<ProbeReport> {
  const text = await readBody(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    const reason = challengePage(text) ? "challenge" : htmlReason(response.status, text, secrets);
    return upstream("coupang", response.status, false, null, reason, testedAt);
  }
  if (!response.ok) return upstream("coupang", response.status, false, null, `http_${response.status}`, testedAt);
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  if (!root || String(root.rCode) !== "0") {
    const code = root ? String(root.rCode) : "missing";
    const message = typeof root?.rMessage === "string" ? root.rMessage : "";
    return upstream("coupang", response.status, false, null, `rcode_${code}: ${publicText(message, secrets)}`, testedAt);
  }
  const products = productsFromCoupangSearch(payload);
  if (!products) return upstream("coupang", response.status, false, null, "parse_error", testedAt);
  return upstream("coupang", response.status, true, products.length, null, testedAt);
}

async function probeRakuten(keyword: string, fetchImpl: typeof fetch, testedAt: Date): Promise<ProbeReport> {
  try {
    const url = fixedHttps(rawSearchUrl("rakuten", keyword), RAKUTEN_HOST);
    const response = await once(
      url,
      {
        method: "GET",
        headers: {
          "user-agent": RAKUTEN_USER_AGENT,
          "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "upgrade-insecure-requests": "1",
          "accept-encoding": "gzip, deflate, br",
          referer: "https://www.rakuten.com.tw/",
          "sec-fetch-site": "same-origin",
        },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      fetchImpl,
    );
    const text = await readBody(response);
    if (!response.ok) return upstream("rakuten", response.status, false, null, `http_${response.status}`, testedAt);
    if (challengePage(text)) return upstream("rakuten", response.status, false, null, "challenge", testedAt);
    const products = rakutenProducts(text);
    if (!products) return upstream("rakuten", response.status, false, null, "parse_error", testedAt);
    return upstream("rakuten", response.status, true, products.length, null, testedAt);
  } catch (error) {
    return report("rakuten", {
      sent: true,
      httpStatus: null,
      parsed: false,
      count: null,
      ok: false,
      reason: `exception: ${publicText(error instanceof Error ? error.message : "unknown", []) || "unknown"}`,
    }, testedAt);
  }
}

function upstream(
  platform: ShopName,
  httpStatus: number,
  parsed: boolean,
  count: number | null,
  reason: string | null,
  testedAt: Date,
): ProbeReport {
  const ok = parsed && httpStatus >= 200 && httpStatus < 300;
  return report(platform, { sent: true, httpStatus, parsed, count, ok, reason }, testedAt);
}

async function readBody(response: Response): Promise<string> {
  return decodeBody(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-encoding") ?? "");
}

function htmlReason(status: number, text: string, secrets: readonly string[]): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const source = title?.[1]?.trim() ? title[1] : text;
  const stripped = source.replace(/<[^>]*>/g, " ");
  return `html_${status}: ${publicText(stripped, secrets, 80)}`;
}
