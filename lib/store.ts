/**
 * SentinelFraud — server-side in-memory store.
 *
 * Owns the live transaction stream for the Next.js app: generates the next
 * transaction, enriches it via BIN lookup, scores it with the pure engine,
 * and keeps bounded history plus cumulative stats.
 *
 * Cached on globalThis so Next.js dev-mode hot reloads and per-route module
 * instances all share one store.
 */

import {
  CONFIG,
  categorizeReason,
  isFlagged,
  scoreTransaction,
  type RiskResult,
  type Transaction,
  type UserBaseline,
} from './fraud-engine';
import { createTransactionStream, DEFAULT_SEED, type TransactionStream } from './generator';
import { lookupBin, type BinInfo } from './bin-lookup';

export interface ScoredRecord {
  transaction: Transaction;
  enrichment: BinInfo;
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
const MAX_USER_TIMESTAMPS = 100;

/**
 * Baseline for user ids the seeded stream doesn't know. Neutral by design:
 * with no history there is nothing to be anomalous against, so only
 * velocity and BIN/geo signals can fire.
 */
function neutralBaseline(tx: Transaction): UserBaseline {
  return {
    userId: tx.userId,
    avgAmount: Math.max(tx.amount, 1),
    stdevAmount: Math.max(tx.amount * 0.5, 1),
    usualCountry: tx.country,
    activeHours: { start: 0, end: 23 },
  };
}

export class FraudStore {
  private stream: TransactionStream;
  private records: ScoredRecord[] = [];
  private byId = new Map<string, ScoredRecord>();
  private userTimestamps = new Map<string, number[]>();
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
    const enrichment = await lookupBin(tx.cardBin);
    const baseline = this.stream.baselines.get(tx.userId) ?? neutralBaseline(tx);
    const recent = this.userTimestamps.get(tx.userId) ?? [];

    const result = scoreTransaction(tx, baseline, {
      recentUserTimestamps: recent,
      binCountry: enrichment.country,
    });

    recent.push(tx.timestamp);
    if (recent.length > MAX_USER_TIMESTAMPS) recent.splice(0, recent.length - MAX_USER_TIMESTAMPS);
    this.userTimestamps.set(tx.userId, recent);

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
