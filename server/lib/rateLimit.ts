// A per-key sliding-window counter in memory. Enough to bound what one user
// can spend on a paid API per request, not a security boundary:
// on Vercel every function instance has its own memory, so the effective
// limit is `limit` × the instances that happen to serve the user, and a cold
// start forgets the count. If that is ever abused, move the counter to the
// database (one row per key and window).
export interface RateLimiter {
  /** Records a hit for `key`; false when the key is over its limit (not recorded). */
  take(key: string, now?: number): boolean;
}

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
      if (recent.length >= limit) { hits.set(key, recent); return false; }
      recent.push(now);
      hits.set(key, recent);
      // Keys whose window passed are dropped as other keys come in.
      if (hits.size > 1000) for (const [k, ts] of hits) if (ts.every(t => now - t >= windowMs)) hits.delete(k);
      return true;
    },
  };
}
