/**
 * SentinelFraud — core fraud scoring engine.
 *
 * This module is intentionally PURE and DETERMINISTIC: given the same
 * transaction, baseline, and context it always returns the same result.
 * It performs no I/O — BIN enrichment is resolved by the caller and passed
 * in via `ScoreContext.binCountry` (see lib/bin-lookup.ts).
 */

/**
 * All tunable thresholds and weights live here.
 * Each signal contributes up to `weights.<signal>` points; the total is
 * clamped to the 0–100 range before banding.
 */
export const CONFIG = {
  /** Maximum points each signal can contribute to the score. */
  weights: {
    amountAnomaly: 70,
    newCountry: 30,
    velocity: 35,
    oddHour: 20,
    binGeoMismatch: 25,
  },
  /**
   * Amount anomaly: points ramp linearly from 0 at `zScoreStart` to the
   * full weight at `zScoreFull`. The stdev is floored to avoid division
   * blow-ups for users with near-constant spending.
   */
  amount: {
    zScoreStart: 2,
    zScoreFull: 8,
    minStdevFloor: 1,
    stdevFloorPctOfMean: 0.05,
  },
  /** Velocity: fires when MORE than `maxTxns` land inside `windowMs`. */
  velocity: {
    windowMs: 60_000,
    maxTxns: 3,
  },
  /**
   * Odd hour: fires when the transaction's UTC hour is at least
   * `minHoursOutside` hours outside the user's usual active range.
   */
  oddHour: {
    minHoursOutside: 2,
  },
  /**
   * v2 additive enrichment signals (Phase 1). Each is gated by `enabled` and
   * fires ONLY when its enrichment context is supplied, so the original
   * behavior and tests are unchanged. Each contributes `weight * intensity`
   * with intensity in [0,1] (binary signals use intensity 1). Keeping every
   * signal as one bounded [0,1] term is what lets Phase 4 learn the weights
   * while the score stays an additive, per-signal-auditable sum.
   */
  signals: {
    /** Origin IP's country differs from the card's (issuing) country. */
    ipGeoMismatch: { enabled: true, weight: 25 },
    /** Origin IP is a proxy / VPN / hosting / anonymizing network. */
    ipAnonymizer: { enabled: true, weight: 20 },
    /** Disposable email domain (full weight) or newly-seen domain (half). */
    emailRisk: { enabled: true, weight: 20 },
    /**
     * Impossible travel: implied km/h between a user's consecutive
     * transactions ramps points from `warnKmh` (0 pts) to `fullKmh` (full).
     */
    impossibleTravel: { enabled: true, weight: 30, warnKmh: 900, fullKmh: 5000 },
  },
  /** Band thresholds (inclusive lower bounds on the final score). */
  bands: {
    medium: 35,
    high: 70,
  },
} as const;

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  /** Epoch milliseconds (UTC). */
  timestamp: number;
  merchant: string;
  category: string;
  /** ISO 3166-1 alpha-2 country code of the transaction. */
  country: string;
  /** First 6 digits of the card number. */
  cardBin: string;
  /** Origin IPv4 address (v2 enrichment). Optional for backward compatibility. */
  ip?: string;
  /** Account email address (v2 enrichment). Optional for backward compatibility. */
  email?: string;
}

/** Per-user spending baseline: average amount, usual country, usual active hours. */
export interface UserBaseline {
  userId: string;
  avgAmount: number;
  stdevAmount: number;
  usualCountry: string;
  /** Usual active hours in UTC. May wrap midnight (e.g. start 21, end 11). */
  activeHours: { start: number; end: number };
}

/** Implied travel between a user's previous and current transaction. */
export interface TravelContext {
  distanceKm: number;
  elapsedMinutes: number;
  impliedKmh: number;
}

/** Caller-supplied context the pure engine cannot derive on its own. */
export interface ScoreContext {
  /** Timestamps (epoch ms) of this user's PRIOR transactions, for velocity. */
  recentUserTimestamps?: number[];
  /** Card-issuing country from BIN enrichment, or null when unknown. */
  binCountry?: string | null;
  /** Resolved country of the transaction's origin IP (v2), or null. */
  ipCountry?: string | null;
  /** Origin IP is a proxy / VPN / hosting / anonymizing network (v2). */
  ipAnonymized?: boolean;
  /** Email domain is a known disposable/throwaway service (v2). */
  emailDisposable?: boolean;
  /** Email domain has not been seen before for this user (v2). */
  emailNewDomain?: boolean;
  /** Implied travel vs the user's previous transaction (v2), or null. */
  travel?: TravelContext | null;
}

export type RiskBand = 'low' | 'medium' | 'high';

export interface RiskResult {
  /** Integer risk score, 0–100. */
  score: number;
  band: RiskBand;
  /** Short machine strings, e.g. "amount 12.4x user average". */
  reasons: string[];
}

export type SignalKey =
  | 'amount-anomaly'
  | 'new-country'
  | 'velocity'
  | 'odd-hour'
  | 'bin-geo-mismatch'
  | 'ip-geo-mismatch'
  | 'ip-anonymizer'
  | 'email-risk'
  | 'impossible-travel';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Hours a given UTC hour sits outside an (optionally midnight-wrapping) range. */
export function hoursOutsideActiveRange(hour: number, start: number, end: number): number {
  const inRange = start <= end ? hour >= start && hour <= end : hour >= start || hour <= end;
  if (inRange) return 0;
  const circularDistance = (a: number, b: number) => Math.min((a - b + 24) % 24, (b - a + 24) % 24);
  return Math.min(circularDistance(hour, start), circularDistance(hour, end));
}

export function bandForScore(score: number): RiskBand {
  if (score >= CONFIG.bands.high) return 'high';
  if (score >= CONFIG.bands.medium) return 'medium';
  return 'low';
}

/** A transaction is "flagged" when it lands in the medium or high band. */
export function isFlagged(result: RiskResult): boolean {
  return result.band !== 'low';
}

/** Map an engine reason string back to its signal, for aggregation/stats. */
export function categorizeReason(reason: string): SignalKey | 'unknown' {
  if (reason.startsWith('amount ')) return 'amount-anomaly';
  if (reason.startsWith('new country ')) return 'new-country';
  if (reason.startsWith('velocity ')) return 'velocity';
  if (reason.startsWith('odd hour ')) return 'odd-hour';
  if (reason.startsWith('card issued ')) return 'bin-geo-mismatch';
  if (reason.startsWith('ip country ')) return 'ip-geo-mismatch';
  if (reason.startsWith('anonymizing network')) return 'ip-anonymizer';
  if (reason.startsWith('disposable email') || reason.startsWith('newly-seen email')) {
    return 'email-risk';
  }
  if (reason.startsWith('impossible travel ')) return 'impossible-travel';
  return 'unknown';
}

/**
 * Score a single transaction against the user's baseline.
 *
 * Signals:
 *  1. Amount anomaly   — z-score of amount vs the user's mean/stdev.
 *  2. New country      — transaction country differs from the usual country.
 *  3. Velocity         — more than N user transactions inside a short window.
 *  4. Odd hour         — far outside the user's usual active hours (UTC).
 *  5. BIN/geo mismatch — card-issuing country differs from transaction country.
 *  6. IP/geo mismatch  — origin IP country differs from the card country (v2).
 *  7. Anonymizer       — origin IP is a proxy/VPN/hosting network (v2).
 *  8. Email risk       — disposable or newly-seen email domain (v2).
 *  9. Impossible travel — implied km/h between consecutive txns is too high (v2).
 *
 * Signals 6-9 are additive and fire only when their enrichment context is
 * supplied, so callers using the original context see identical results.
 */
export function scoreTransaction(
  tx: Transaction,
  baseline: UserBaseline,
  context: ScoreContext = {},
): RiskResult {
  const reasons: string[] = [];
  let points = 0;

  // 1. Amount anomaly
  const sigma = Math.max(
    baseline.stdevAmount,
    baseline.avgAmount * CONFIG.amount.stdevFloorPctOfMean,
    CONFIG.amount.minStdevFloor,
  );
  const zScore = (tx.amount - baseline.avgAmount) / sigma;
  if (zScore >= CONFIG.amount.zScoreStart) {
    const ramp = clamp(
      (zScore - CONFIG.amount.zScoreStart) / (CONFIG.amount.zScoreFull - CONFIG.amount.zScoreStart),
      0,
      1,
    );
    const amountPoints = Math.round(CONFIG.weights.amountAnomaly * ramp);
    if (amountPoints > 0) {
      points += amountPoints;
      const ratio = tx.amount / Math.max(baseline.avgAmount, 0.01);
      reasons.push(`amount ${ratio.toFixed(1)}x user average`);
    }
  }

  // 2. New country
  if (tx.country !== baseline.usualCountry) {
    points += CONFIG.weights.newCountry;
    reasons.push(`new country ${tx.country} (usual ${baseline.usualCountry})`);
  }

  // 3. Velocity
  const priorInWindow = (context.recentUserTimestamps ?? []).filter(
    (ts) => tx.timestamp - ts >= 0 && tx.timestamp - ts <= CONFIG.velocity.windowMs,
  ).length;
  const countInWindow = priorInWindow + 1;
  if (countInWindow > CONFIG.velocity.maxTxns) {
    points += CONFIG.weights.velocity;
    reasons.push(`velocity ${countInWindow} txns in ${CONFIG.velocity.windowMs / 1000}s`);
  }

  // 4. Odd hour
  const hour = new Date(tx.timestamp).getUTCHours();
  const { start, end } = baseline.activeHours;
  if (hoursOutsideActiveRange(hour, start, end) >= CONFIG.oddHour.minHoursOutside) {
    points += CONFIG.weights.oddHour;
    reasons.push(`odd hour ${pad2(hour)}:00 UTC (usual ${pad2(start)}:00-${pad2(end)}:00)`);
  }

  // 5. BIN/geo mismatch
  if (context.binCountry && context.binCountry !== tx.country) {
    points += CONFIG.weights.binGeoMismatch;
    reasons.push(`card issued ${context.binCountry}, txn in ${tx.country}`);
  }

  // The card's country of record: the BIN-issuing country when known, else
  // the transaction country. Used by the IP/geo signal below.
  const cardCountry = context.binCountry ?? tx.country;

  // 6. IP / card-country mismatch (v2)
  if (
    CONFIG.signals.ipGeoMismatch.enabled &&
    context.ipCountry &&
    context.ipCountry !== cardCountry
  ) {
    points += CONFIG.signals.ipGeoMismatch.weight;
    reasons.push(`ip country ${context.ipCountry} != card country ${cardCountry}`);
  }

  // 7. Anonymizing network (v2)
  if (CONFIG.signals.ipAnonymizer.enabled && context.ipAnonymized) {
    points += CONFIG.signals.ipAnonymizer.weight;
    reasons.push('anonymizing network (proxy/vpn/hosting)');
  }

  // 8. Email domain risk (v2): disposable is the strong case; a newly-seen
  // domain for the user is a weaker half-weight signal.
  if (CONFIG.signals.emailRisk.enabled) {
    if (context.emailDisposable) {
      points += CONFIG.signals.emailRisk.weight;
      reasons.push('disposable email domain');
    } else if (context.emailNewDomain) {
      points += Math.round(CONFIG.signals.emailRisk.weight * 0.5);
      reasons.push('newly-seen email domain');
    }
  }

  // 9. Impossible travel (v2): points ramp from warnKmh (0) to fullKmh (full).
  if (CONFIG.signals.impossibleTravel.enabled && context.travel) {
    const { warnKmh, fullKmh, weight } = CONFIG.signals.impossibleTravel;
    const t = context.travel;
    if (t.impliedKmh > warnKmh) {
      const ramp = clamp((t.impliedKmh - warnKmh) / (fullKmh - warnKmh), 0, 1);
      const travelPoints = Math.round(weight * ramp);
      if (travelPoints > 0) {
        points += travelPoints;
        reasons.push(
          `impossible travel ${t.distanceKm}km in ${t.elapsedMinutes}min (${t.impliedKmh} km/h)`,
        );
      }
    }
  }

  const score = Math.round(clamp(points, 0, 100));
  return { score, band: bandForScore(score), reasons };
}

/**
 * Build a baseline from a user's transaction history.
 * Utility for callers that track history; the synthetic generator seeds
 * baselines directly.
 */
export function buildBaseline(userId: string, history: Transaction[]): UserBaseline {
  if (history.length === 0) {
    throw new Error('cannot build a baseline from an empty history');
  }
  const amounts = history.map((tx) => tx.amount);
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((acc, a) => acc + (a - avgAmount) ** 2, 0) / amounts.length;

  const countryCounts = new Map<string, number>();
  for (const tx of history) {
    countryCounts.set(tx.country, (countryCounts.get(tx.country) ?? 0) + 1);
  }
  const usualCountry = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const hours = history.map((tx) => new Date(tx.timestamp).getUTCHours());
  return {
    userId,
    avgAmount,
    stdevAmount: Math.sqrt(variance),
    usualCountry,
    activeHours: { start: Math.min(...hours), end: Math.max(...hours) },
  };
}
