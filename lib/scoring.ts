/**
 * SentinelFraud — stateful scoring helper.
 *
 * Bridges the enrichment layer to the PURE engine. It owns the small amount
 * of per-user history the engine's context needs (recent timestamps for
 * velocity, last known location for impossible-travel, seen email domains for
 * newly-seen detection) and derives a `ScoreContext` from an `EnrichmentBundle`.
 *
 * The engine itself stays pure and deterministic; all mutable state lives here.
 * Both the live dashboard store and the MCP batch builder use `createScorer`,
 * so the dashboard, HTTP API, and MCP tools score identically (parity).
 */

import {
  scoreTransaction,
  type RiskResult,
  type ScoreContext,
  type Transaction,
  type TravelContext,
  type UserBaseline,
} from './fraud-engine';
import type { EnrichmentBundle } from './enrichment';
import { impliedTravel } from './enrichment/geo';

const MAX_USER_TIMESTAMPS = 100;

export interface ScoreOutcome {
  context: ScoreContext;
  result: RiskResult;
}

/**
 * Baseline for user ids without seeded history. Neutral by design: with no
 * history there is nothing to be anomalous against, so amount/odd-hour cannot
 * fire and only enrichment-driven signals (geo, velocity) can.
 */
export function neutralBaseline(tx: Transaction): UserBaseline {
  return {
    userId: tx.userId,
    avgAmount: Math.max(tx.amount, 1),
    stdevAmount: Math.max(tx.amount * 0.5, 1),
    usualCountry: tx.country,
    activeHours: { start: 0, end: 23 },
  };
}

export interface Scorer {
  score(tx: Transaction, enrichment: EnrichmentBundle): ScoreOutcome;
}

/**
 * Create a scorer bound to a set of user baselines. The returned scorer is
 * stateful across calls (it accumulates per-user history), so create one per
 * logical stream/session.
 */
export function createScorer(baselines: Map<string, UserBaseline>): Scorer {
  const userTimestamps = new Map<string, number[]>();
  const userLastLocation = new Map<string, { lat: number; lon: number; timestamp: number }>();
  const userEmailDomains = new Map<string, Set<string>>();

  function score(tx: Transaction, enrichment: EnrichmentBundle): ScoreOutcome {
    const baseline = baselines.get(tx.userId) ?? neutralBaseline(tx);
    const recent = userTimestamps.get(tx.userId) ?? [];

    // Impossible-travel: implied speed vs the user's previous known location.
    let travel: TravelContext | null = null;
    const { lat, lon } = enrichment.ip;
    if (lat != null && lon != null) {
      travel = impliedTravel(userLastLocation.get(tx.userId) ?? null, {
        lat,
        lon,
        timestamp: tx.timestamp,
      });
    }

    // Newly-seen email domain: only after the user has prior history, so a
    // user's very first transaction never fires the signal.
    const domain = enrichment.email.domain;
    const seen = userEmailDomains.get(tx.userId) ?? new Set<string>();
    const emailNewDomain = domain != null && seen.size > 0 && !seen.has(domain);

    const context: ScoreContext = {
      recentUserTimestamps: recent,
      binCountry: enrichment.bin.country,
      ipCountry: enrichment.ip.country,
      ipAnonymized: enrichment.ip.anonymized,
      emailDisposable: enrichment.email.disposable,
      emailNewDomain,
      travel,
    };

    const result = scoreTransaction(tx, baseline, context);

    // Update history AFTER scoring so a transaction is never compared to itself.
    recent.push(tx.timestamp);
    if (recent.length > MAX_USER_TIMESTAMPS) {
      recent.splice(0, recent.length - MAX_USER_TIMESTAMPS);
    }
    userTimestamps.set(tx.userId, recent);
    if (lat != null && lon != null) {
      userLastLocation.set(tx.userId, { lat, lon, timestamp: tx.timestamp });
    }
    if (domain != null) {
      seen.add(domain);
      userEmailDomains.set(tx.userId, seen);
    }

    return { context, result };
  }

  return { score };
}
