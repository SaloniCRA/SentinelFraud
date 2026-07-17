import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  bandForScore,
  buildBaseline,
  categorizeReason,
  hoursOutsideActiveRange,
  isFlagged,
  scoreTransaction,
  type Transaction,
  type UserBaseline,
} from '../lib/fraud-engine';

const baseline: UserBaseline = {
  userId: 'u-test',
  avgAmount: 100,
  stdevAmount: 25,
  usualCountry: 'US',
  activeHours: { start: 8, end: 22 },
};

/** 15:30 UTC on a weekday — comfortably inside active hours. */
const MIDDAY = Date.UTC(2026, 0, 5, 15, 30, 0);

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'txn-test-1',
  userId: 'u-test',
  amount: 104,
  currency: 'USD',
  timestamp: MIDDAY,
  merchant: 'Coffee Co',
  category: 'dining',
  country: 'US',
  cardBin: '411111',
  ...overrides,
});

describe('scoreTransaction', () => {
  it('scores a normal transaction low with no reasons', () => {
    const result = scoreTransaction(makeTx(), baseline, { binCountry: 'US' });
    expect(result.band).toBe('low');
    expect(result.score).toBeLessThan(CONFIG.bands.medium);
    expect(result.reasons).toEqual([]);
    expect(isFlagged(result)).toBe(false);
  });

  it('scores a huge amount high', () => {
    // 15x the user average → z-score of 56, far past saturation.
    const result = scoreTransaction(makeTx({ amount: 1500 }), baseline, { binCountry: 'US' });
    expect(result.band).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(CONFIG.bands.high);
    expect(result.reasons).toContain('amount 15.0x user average');
  });

  it('ramps amount points between the z-score start and saturation', () => {
    // z = 2 → points just start; z = 5 → half-ish; both below saturation.
    const atStart = scoreTransaction(makeTx({ amount: 150 }), baseline, {});
    const midway = scoreTransaction(makeTx({ amount: 225 }), baseline, {});
    expect(atStart.score).toBe(0);
    expect(midway.score).toBeGreaterThan(atStart.score);
    expect(midway.score).toBeLessThan(CONFIG.weights.amountAnomaly);
  });

  it('adds the new-country signal for a foreign transaction', () => {
    const result = scoreTransaction(makeTx({ country: 'RO' }), baseline, {});
    expect(result.reasons).toContain('new country RO (usual US)');
    expect(result.score).toBe(CONFIG.weights.newCountry);
  });

  it('flags velocity bursts', () => {
    const recent = [MIDDAY - 10_000, MIDDAY - 25_000, MIDDAY - 40_000];
    const result = scoreTransaction(makeTx(), baseline, { recentUserTimestamps: recent });
    expect(result.reasons).toContain(`velocity 4 txns in ${CONFIG.velocity.windowMs / 1000}s`);
    expect(result.score).toBe(CONFIG.weights.velocity);
    expect(result.band).toBe('medium');
    expect(isFlagged(result)).toBe(true);
  });

  it('ignores prior transactions outside the velocity window', () => {
    const recent = [
      MIDDAY - CONFIG.velocity.windowMs - 1_000,
      MIDDAY - CONFIG.velocity.windowMs - 60_000,
      MIDDAY - CONFIG.velocity.windowMs - 120_000,
    ];
    const result = scoreTransaction(makeTx(), baseline, { recentUserTimestamps: recent });
    expect(result.reasons).toEqual([]);
  });

  it('adds the odd-hour signal for a 3am transaction', () => {
    const threeAm = Date.UTC(2026, 0, 5, 3, 12, 0);
    const result = scoreTransaction(makeTx({ timestamp: threeAm }), baseline, {});
    expect(result.reasons).toContain('odd hour 03:00 UTC (usual 08:00-22:00)');
    expect(result.score).toBe(CONFIG.weights.oddHour);
  });

  it('handles midnight-wrapping active hours', () => {
    const nightOwl: UserBaseline = { ...baseline, activeHours: { start: 21, end: 11 } };
    const threeAm = Date.UTC(2026, 0, 5, 3, 0, 0); // inside 21→11 window
    const threePm = Date.UTC(2026, 0, 5, 15, 0, 0); // 4h outside it
    expect(scoreTransaction(makeTx({ timestamp: threeAm }), nightOwl, {}).reasons).toEqual([]);
    expect(scoreTransaction(makeTx({ timestamp: threePm }), nightOwl, {}).reasons).toContain(
      'odd hour 15:00 UTC (usual 21:00-11:00)',
    );
  });

  it('adds the BIN/geo mismatch signal when issuing country differs', () => {
    const result = scoreTransaction(makeTx(), baseline, { binCountry: 'GB' });
    expect(result.reasons).toContain('card issued GB, txn in US');
    expect(result.score).toBe(CONFIG.weights.binGeoMismatch);
  });

  it('adds no BIN signal when enrichment is unavailable', () => {
    const result = scoreTransaction(makeTx(), baseline, { binCountry: null });
    expect(result.reasons).toEqual([]);
  });

  it('keeps the score within 0-100 even when every signal fires', () => {
    const threeAm = Date.UTC(2026, 0, 5, 3, 0, 0);
    const result = scoreTransaction(
      makeTx({ amount: 5000, country: 'RO', timestamp: threeAm }),
      baseline,
      {
        recentUserTimestamps: [threeAm - 5_000, threeAm - 15_000, threeAm - 30_000],
        binCountry: 'GB',
      },
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.band).toBe('high');
    expect(result.reasons).toHaveLength(5);
  });

  it('is deterministic for identical inputs', () => {
    const tx = makeTx({ amount: 900, country: 'BR' });
    const a = scoreTransaction(tx, baseline, { binCountry: 'GB' });
    const b = scoreTransaction(tx, baseline, { binCountry: 'GB' });
    expect(a).toEqual(b);
  });
});

describe('bandForScore', () => {
  it('maps scores to bands at the configured thresholds', () => {
    expect(bandForScore(0)).toBe('low');
    expect(bandForScore(CONFIG.bands.medium - 1)).toBe('low');
    expect(bandForScore(CONFIG.bands.medium)).toBe('medium');
    expect(bandForScore(CONFIG.bands.high - 1)).toBe('medium');
    expect(bandForScore(CONFIG.bands.high)).toBe('high');
    expect(bandForScore(100)).toBe('high');
  });
});

describe('hoursOutsideActiveRange', () => {
  it('returns 0 inside the range and distance outside it', () => {
    expect(hoursOutsideActiveRange(12, 8, 22)).toBe(0);
    expect(hoursOutsideActiveRange(3, 8, 22)).toBe(5); // 5h below start, 5h past end (circular)
  });
});

describe('categorizeReason', () => {
  it('maps engine reasons to signal keys', () => {
    expect(categorizeReason('amount 12.4x user average')).toBe('amount-anomaly');
    expect(categorizeReason('new country RO (usual US)')).toBe('new-country');
    expect(categorizeReason('velocity 4 txns in 90s')).toBe('velocity');
    expect(categorizeReason('odd hour 03:00 UTC (usual 08:00-22:00)')).toBe('odd-hour');
    expect(categorizeReason('card issued GB, txn in US')).toBe('bin-geo-mismatch');
    expect(categorizeReason('something else')).toBe('unknown');
  });
});

describe('buildBaseline', () => {
  it('derives mean, stdev, usual country, and active hours from history', () => {
    const history: Transaction[] = [
      makeTx({ id: 'h1', amount: 90, timestamp: Date.UTC(2026, 0, 1, 9, 0) }),
      makeTx({ id: 'h2', amount: 110, timestamp: Date.UTC(2026, 0, 2, 14, 0) }),
      makeTx({ id: 'h3', amount: 100, timestamp: Date.UTC(2026, 0, 3, 20, 0), country: 'CA' }),
    ];
    const built = buildBaseline('u-test', history);
    expect(built.avgAmount).toBeCloseTo(100);
    expect(built.usualCountry).toBe('US');
    expect(built.activeHours).toEqual({ start: 9, end: 20 });
  });

  it('throws on empty history', () => {
    expect(() => buildBaseline('u-test', [])).toThrow();
  });
});
