/**
 * SentinelFraud MCP — fixed-window in-memory rate limiter.
 *
 * Pure and testable: the caller injects `now` (epoch ms) so behavior is
 * deterministic under test. Keyed by an arbitrary client identifier (bearer
 * token or remote address). Not a distributed limiter — sufficient for a demo
 * and easily swapped for Redis/Upstash in production.
 */

export interface RateLimiter {
  /** Returns true when this request should be REJECTED (limit exceeded). */
  check(key: string, now: number): boolean;
}

export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string, now: number): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      bucket.count += 1;
      return bucket.count > maxRequests;
    },
  };
}
