interface Bucket {
  count: number;
  resetAt: number;
}

/** Best-effort fixed window. Each Worker isolate keeps its own map. */
export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  return function allow(key: string, now: number): boolean {
    if (buckets.size > 2000) {
      for (const [id, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(id);
      }
    }
    const current = buckets.get(key);
    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}
