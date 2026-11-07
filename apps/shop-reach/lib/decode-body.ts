import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const MAX_BYTES = 2_000_000;

/**
 * Rakuten's edge closes the connection unless the request names an encoding.
 * Node leaves that body compressed when the header is set by us, so decode it
 * here. Plain text, or a runtime that already decoded it, is returned as text.
 */
export function decodeBody(bytes: Uint8Array, encoding: string): string {
  const capped = bytes.byteLength > MAX_BYTES ? bytes.slice(0, MAX_BYTES) : bytes;
  const label = encoding.toLowerCase();
  const asText = () => new TextDecoder().decode(capped);
  try {
    if (label.includes("br")) return clip(brotliDecompressSync(capped));
    if (label.includes("gzip") || (capped[0] === 0x1f && capped[1] === 0x8b)) return clip(gunzipSync(capped));
    if (label.includes("deflate")) return clip(inflateSync(capped));
  } catch {
    return asText();
  }
  return asText();
}

function clip(value: Uint8Array): string {
  const capped = value.byteLength > MAX_BYTES ? value.slice(0, MAX_BYTES) : value;
  return new TextDecoder().decode(capped);
}

export async function readResponseBody(response: Response): Promise<string> {
  const encoding = response.headers.get("content-encoding") ?? "";
  return decodeBody(new Uint8Array(await response.arrayBuffer()), encoding);
}
