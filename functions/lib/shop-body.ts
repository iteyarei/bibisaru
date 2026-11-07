const MAX_BYTES = 2_000_000;

/**
 * Read at most 2 MB, then undo gzip, brotli, or deflate when the bytes are
 * still compressed. Node leaves the body compressed if the request set
 * `accept-encoding` itself. A runtime that already decoded it has no encoding
 * header, so the bytes are returned as text.
 */
export async function readShopBody(response: Response): Promise<string> {
  const bytes = await readCapped(response);
  return decodeShopBody(bytes, response.headers.get("content-encoding") ?? "");
}

export async function decodeShopBody(bytes: Uint8Array, encoding: string): Promise<string> {
  const source = bytes.byteLength > MAX_BYTES ? bytes.subarray(0, MAX_BYTES) : bytes;
  const format = compressionFormat(source, encoding);
  if (!format) return new TextDecoder().decode(source);
  try {
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format as "gzip"));
    const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
    const capped = inflated.byteLength > MAX_BYTES ? inflated.subarray(0, MAX_BYTES) : inflated;
    return new TextDecoder().decode(capped);
  } catch {
    return new TextDecoder().decode(source);
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = MAX_BYTES - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (value.byteLength > room) break;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function compressionFormat(bytes: Uint8Array, encoding: string): "gzip" | "deflate" | "brotli" | "" {
  const label = encoding.toLowerCase();
  if (label.includes("br")) return "brotli";
  if (label.includes("gzip") || (bytes[0] === 0x1f && bytes[1] === 0x8b)) return "gzip";
  if (label.includes("deflate")) return "deflate";
  return "";
}
