/**
 * SentinelFraud — enrichment orchestrator.
 *
 * Runs every enrichment source for a transaction concurrently and returns a
 * normalized `EnrichmentBundle`. Each source has its own cache, timeout, and
 * safe fallback and NEVER throws, so this orchestrator never throws either.
 * The deterministic engine consumes the derived signal context (see
 * `enrichmentToContext` in lib/store.ts) — a missing enrichment degrades to a
 * neutral, non-fraud-biasing value.
 */

import { lookupBin, type BinInfo } from './bin';
import { lookupIp, IP_FALLBACK, type IpInfo } from './ip';
import { analyzeEmail, EMAIL_FALLBACK, type EmailInfo } from './email';

export interface EnrichmentBundle {
  bin: BinInfo;
  ip: IpInfo;
  email: EmailInfo;
}

export interface EnrichmentInput {
  cardBin: string;
  ip?: string;
  email?: string;
}

/** Enrich a transaction across all sources concurrently. Never throws. */
export async function enrichTransaction(input: EnrichmentInput): Promise<EnrichmentBundle> {
  const [bin, ip] = await Promise.all([
    lookupBin(input.cardBin),
    input.ip ? lookupIp(input.ip) : Promise.resolve(IP_FALLBACK),
  ]);
  return {
    bin,
    ip,
    email: input.email ? analyzeEmail(input.email) : EMAIL_FALLBACK,
  };
}

export type { BinInfo } from './bin';
export type { IpInfo } from './ip';
export type { EmailInfo } from './email';
