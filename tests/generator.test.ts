import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { categorizeReason, scoreTransaction, isFlagged } from '../lib/fraud-engine';
import { createTransactionStream, DEFAULT_SEED, GENESIS_TIME, USERS } from '../lib/generator';
import { enrichTransaction } from '../lib/enrichment';
import { clearBinCache } from '../lib/enrichment/bin';
import { clearIpCache } from '../lib/enrichment/ip';
import { createScorer } from '../lib/scoring';

describe('createTransactionStream', () => {
  it('is reproducible: identical seed and start time produce identical batches', () => {
    const a = createTransactionStream({ seed: 42 }).generateBatch(120);
    const b = createTransactionStream({ seed: 42 }).generateBatch(120);
    expect(a).toEqual(b);
  });

  it('produces different streams for different seeds', () => {
    const a = createTransactionStream({ seed: 1 }).generateBatch(50);
    const b = createTransactionStream({ seed: 2 }).generateBatch(50);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('generates structurally valid transactions', () => {
    const batch = createTransactionStream({ seed: DEFAULT_SEED }).generateBatch(200);
    expect(batch).toHaveLength(200);

    const userIds = new Set(USERS.map((u) => u.baseline.userId));
    const ids = new Set<string>();
    for (const tx of batch) {
      ids.add(tx.id);
      expect(userIds.has(tx.userId)).toBe(true);
      expect(tx.amount).toBeGreaterThan(0);
      expect(tx.currency).toMatch(/^[A-Z]{3}$/);
      expect(tx.country).toMatch(/^[A-Z]{2}$/);
      expect(tx.cardBin).toMatch(/^\d{6}$/);
      expect(tx.timestamp).toBeGreaterThan(GENESIS_TIME - 24 * 3_600_000);
      expect(tx.merchant.length).toBeGreaterThan(0);
      expect(tx.category.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(200); // ids are unique
  });

  it('produces a realistic share of flagged transactions (~10% fraud)', () => {
    const stream = createTransactionStream({ seed: DEFAULT_SEED });
    const batch = stream.generateBatch(400);
    const perUser = new Map<string, number[]>();
    let flagged = 0;

    for (const tx of batch) {
      const recent = perUser.get(tx.userId) ?? [];
      const result = scoreTransaction(tx, stream.baselines.get(tx.userId)!, {
        recentUserTimestamps: recent,
      });
      if (isFlagged(result)) flagged += 1;
      recent.push(tx.timestamp);
      perUser.set(tx.userId, recent);
    }

    const rate = flagged / batch.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.35);
  });

  it('supports the iterator protocol', () => {
    const stream = createTransactionStream({ seed: 7 });
    const viaIterator: string[] = [];
    for (const tx of stream) {
      viaIterator.push(tx.id);
      if (viaIterator.length === 5) break;
    }
    expect(viaIterator).toHaveLength(5);
    expect(new Set(viaIterator).size).toBe(5);
  });

  it('emits card-testing bursts that trip the velocity signal', () => {
    const stream = createTransactionStream({ seed: DEFAULT_SEED });
    const batch = stream.generateBatch(400);
    const perUser = new Map<string, number[]>();
    const velocityHits = batch.filter((tx) => {
      const recent = perUser.get(tx.userId) ?? [];
      const result = scoreTransaction(tx, stream.baselines.get(tx.userId)!, {
        recentUserTimestamps: recent,
      });
      recent.push(tx.timestamp);
      perUser.set(tx.userId, recent);
      return result.reasons.some((r) => r.startsWith('velocity '));
    });
    expect(velocityHits.length).toBeGreaterThan(0);
  });
});

describe('generator + enrichment integration', () => {
  // Stub fetch so BIN/IP lookups never touch the network: demo IPs resolve
  // offline from DEMO_IP_MAP and BIN lookups degrade to the safe fallback.
  beforeAll(() => {
    clearBinCache();
    clearIpCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network disabled in tests');
      }),
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  it('produces transactions that trigger every v2 enrichment signal', async () => {
    const stream = createTransactionStream({ seed: DEFAULT_SEED });
    const batch = stream.generateBatch(400);
    const scorer = createScorer(stream.baselines);
    const seen = new Set<string>();

    for (const tx of batch) {
      const enrichment = await enrichTransaction({
        cardBin: tx.cardBin,
        ip: tx.ip,
        email: tx.email,
      });
      const { result } = scorer.score(tx, enrichment);
      for (const reason of result.reasons) seen.add(categorizeReason(reason));
    }

    expect(seen.has('ip-geo-mismatch')).toBe(true);
    expect(seen.has('ip-anonymizer')).toBe(true);
    expect(seen.has('email-risk')).toBe(true);
    expect(seen.has('impossible-travel')).toBe(true);
  });

  it('populates ip and email on generated transactions', () => {
    const [tx] = createTransactionStream({ seed: 5 }).generateBatch(1);
    expect(tx.ip).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/);
    expect(tx.email).toContain('@');
  });
});
