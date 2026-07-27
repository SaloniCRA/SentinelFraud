import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../mcp-server/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to the limit, then rejects within the window', () => {
    const limiter = createRateLimiter(3, 1_000);
    expect(limiter.check('k', 0)).toBe(false); // 1
    expect(limiter.check('k', 100)).toBe(false); // 2
    expect(limiter.check('k', 200)).toBe(false); // 3
    expect(limiter.check('k', 300)).toBe(true); // 4 → limited
  });

  it('resets after the window elapses', () => {
    const limiter = createRateLimiter(2, 1_000);
    expect(limiter.check('k', 0)).toBe(false);
    expect(limiter.check('k', 10)).toBe(false);
    expect(limiter.check('k', 20)).toBe(true); // limited
    expect(limiter.check('k', 1_000)).toBe(false); // window rolled over
  });

  it('tracks each key independently', () => {
    const limiter = createRateLimiter(1, 1_000);
    expect(limiter.check('a', 0)).toBe(false);
    expect(limiter.check('b', 0)).toBe(false);
    expect(limiter.check('a', 1)).toBe(true);
    expect(limiter.check('b', 1)).toBe(true);
  });
});
