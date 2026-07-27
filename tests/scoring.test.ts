import { describe, expect, it } from 'vitest';
import { createScorer, neutralBaseline } from '../lib/scoring';
import type { UserBaseline, Transaction } from '../lib/fraud-engine';
import type { EnrichmentBundle } from '../lib/enrichment';

const baseline: UserBaseline = {
  userId: 'u-1',
  avgAmount: 100,
  stdevAmount: 25,
  usualCountry: 'US',
  activeHours: { start: 0, end: 23 },
};

const baselines = new Map<string, UserBaseline>([['u-1', baseline]]);

const MIDDAY = Date.UTC(2026, 0, 5, 12, 0, 0);

const makeTx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'txn-1',
  userId: 'u-1',
  amount: 100,
  currency: 'USD',
  timestamp: MIDDAY,
  merchant: 'Shop',
  category: 'retail',
  country: 'US',
  cardBin: '411111',
  ...over,
});

const bundle = (over: Partial<EnrichmentBundle> = {}): EnrichmentBundle => ({
  bin: { bank: 'Bank', country: null },
  ip: { country: null, lat: null, lon: null, anonymized: false, isp: null },
  email: { domain: null, disposable: false, freeProvider: false },
  ...over,
});

describe('createScorer', () => {
  it('derives the impossible-travel signal from consecutive locations', () => {
    const scorer = createScorer(baselines);
    // First transaction from the US — no prior location, so no travel signal.
    const first = scorer.score(
      makeTx({ id: 'a', timestamp: MIDDAY }),
      bundle({ ip: { country: 'US', lat: 38, lon: -97, anonymized: false, isp: 'Comcast' } }),
    );
    expect(first.result.reasons.some((r) => r.startsWith('impossible travel'))).toBe(false);

    // Five minutes later, same user, on the other side of the planet.
    const second = scorer.score(
      makeTx({ id: 'b', country: 'VN', timestamp: MIDDAY + 5 * 60_000 }),
      bundle({ ip: { country: 'VN', lat: 16, lon: 108, anonymized: false, isp: 'x' } }),
    );
    expect(second.result.reasons.some((r) => r.startsWith('impossible travel'))).toBe(true);
  });

  it('suppresses newly-seen-domain on the first sighting, then fires on a change', () => {
    const scorer = createScorer(baselines);
    const first = scorer.score(
      makeTx({ id: 'a' }),
      bundle({ email: { domain: 'acme.example', disposable: false, freeProvider: false } }),
    );
    expect(first.result.reasons).not.toContain('newly-seen email domain');

    const second = scorer.score(
      makeTx({ id: 'b' }),
      bundle({ email: { domain: 'different.example', disposable: false, freeProvider: false } }),
    );
    expect(second.result.reasons).toContain('newly-seen email domain');
  });

  it('flags disposable domains regardless of history', () => {
    const scorer = createScorer(baselines);
    const outcome = scorer.score(
      makeTx(),
      bundle({ email: { domain: 'mailinator.com', disposable: true, freeProvider: false } }),
    );
    expect(outcome.result.reasons).toContain('disposable email domain');
  });

  it('falls back to a neutral baseline for unknown users', () => {
    const scorer = createScorer(new Map());
    const outcome = scorer.score(makeTx({ userId: 'stranger' }), bundle());
    // Neutral baseline → amount is its own average → nothing anomalous.
    expect(outcome.result.band).toBe('low');
  });
});

describe('neutralBaseline', () => {
  it('centers on the transaction so a lone transaction is not anomalous', () => {
    const b = neutralBaseline(makeTx({ amount: 500 }));
    expect(b.avgAmount).toBe(500);
    expect(b.usualCountry).toBe('US');
  });
});
