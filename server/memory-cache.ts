interface Cached {
  status: number;
  body: string;
  cacheControl: string;
  contentType: string;
  expiresAt: number;
}

const entries = new Map<string, Cached>();

/** Same job as the Pages edge cache: one process remembers a response until s-maxage. */
export function readMemoryCache(key: string, now = Date.now()): Cached | null {
  const found = entries.get(key);
  if (!found) return null;
  if (found.expiresAt <= now) {
    entries.delete(key);
    return null;
  }
  return found;
}

export function writeMemoryCache(
  key: string,
  value: { status: number; body: string; cacheControl: string; contentType: string },
  now = Date.now(),
): void {
  const ttl = sharedMaxAge(value.cacheControl);
  if (ttl === null || value.status !== 200) return;
  if (entries.size > 400) {
    for (const [id, cached] of entries) if (cached.expiresAt <= now) entries.delete(id);
    if (entries.size > 400) entries.clear();
  }
  entries.set(key, { ...value, expiresAt: now + ttl * 1000 });
}

export function resetMemoryCache(): void {
  entries.clear();
}

function sharedMaxAge(cacheControl: string): number | null {
  if (/(^|,)\s*no-store\b/i.test(cacheControl)) return null;
  const match = /s-maxage=(\d+)/i.exec(cacheControl);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
