/**
 * SentinelFraud — server-side in-memory store.
 *
 * Owns the live transaction stream for the Next.js app: generates the next
 * transaction, enriches it across all sources, scores it with the pure engine
 * (via the shared stateful scorer), and keeps bounded history plus cumulative
 * stats.
 *
 * Cached on globalThis so Next.js dev-mode hot reloads and per-route module
 * instances all share one store.
 */

import {
  CONFIG,
  categorizeReason,
  isFlagged,
  type RiskResult,
  type Transaction,
} from './fraud-engine';
import { createTransactionStream, DEFAULT_SEED, type TransactionStream } from './generator';
import { enrichTransaction, type EnrichmentBundle } from './enrichment';
import { createScorer, type Scorer } from './scoring';

export interface ScoredRecord {
  transaction: Transaction;
  enrichment: EnrichmentBundle;
  result: RiskResult;
  /** Epoch ms the server processed the transaction. */
  receivedAt: number;
}

export interface FraudStats {
  total: number;
  flagged: number;
  flaggedRate: number;
  averageScore: number;
  bands: Record<'low' | 'medium' | 'high', number>;
  topSignals: { signal: string; count: number }[];
}

const MAX_RECORDS = 500;

export class FraudStore {
  private stream: TransactionStream;
  private scorer: Scorer;
  private records: ScoredRecord[] = [];
  private byId = new Map<string, ScoredRecord>();
  private totals = {
    count: 0,
    flagged: 0,
    scoreSum: 0,
    bands: { low: 0, medium: 0, high: 0 },
    signals: new Map<string, number>(),
  };

  constructor() {
    // Live app runs the seeded stream anchored to wall-clock "now".
    this.stream = createTransactionStream({ seed: DEFAULT_SEED, startTime: Date.now() });
    this.scorer = createScorer(this.stream.baselines);
  }

  /** Generate, enrich, score, and store the next stream transaction. */
  async ingestNext(): Promise<ScoredRecord> {
    return this.scoreAndStore(this.stream.nextTransaction());
  }

  /** Score an externally supplied (already validated) transaction. */
  async scoreExternal(tx: Transaction): Promise<ScoredRecord> {
    return this.scoreAndStore(tx);
  }

  getRecord(id: string): ScoredRecord | undefined {
    return this.byId.get(id);
  }

  getFlagged(minScore: number = CONFIG.bands.medium): ScoredRecord[] {
    return this.records.filter((r) => r.result.score >= minScore);
  }

  getStats(): FraudStats {
    const { count, flagged, scoreSum, bands, signals } = this.totals;
    return {
      total: count,
      flagged,
      flaggedRate: count === 0 ? 0 : flagged / count,
      averageScore: count === 0 ? 0 : scoreSum / count,
      bands: { ...bands },
      topSignals: [...signals.entries()]
        .map(([signal, n]) => ({ signal, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  private async scoreAndStore(tx: Transaction): Promise<ScoredRecord> {
    const enrichment = await enrichTransaction({ cardBin: tx.cardBin, ip: tx.ip, email: tx.email });
    const { result } = this.scorer.score(tx, enrichment);

    const record: ScoredRecord = { transaction: tx, enrichment, result, receivedAt: Date.now() };
    this.records.push(record);
    this.byId.set(tx.id, record);
    while (this.records.length > MAX_RECORDS) {
      const evicted = this.records.shift();
      if (evicted) this.byId.delete(evicted.transaction.id);
    }

    this.totals.count += 1;
    this.totals.scoreSum += result.score;
    this.totals.bands[result.band] += 1;
    if (isFlagged(result)) this.totals.flagged += 1;
    for (const reason of result.reasons) {
      const key = categorizeReason(reason);
      this.totals.signals.set(key, (this.totals.signals.get(key) ?? 0) + 1);
    }

    return record;
  }
}

/** Singleton accessor, resilient to Next.js dev hot reloads. */
export function getStore(): FraudStore {
  const g = globalThis as typeof globalThis & { __sentinelFraudStore?: FraudStore };
  g.__sentinelFraudStore ??= new FraudStore();
  return g.__sentinelFraudStore;
}
