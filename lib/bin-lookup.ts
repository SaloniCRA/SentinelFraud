/**
 * SentinelFraud — BIN lookup compatibility shim.
 *
 * The implementation moved to `lib/enrichment/bin.ts` as part of the v2
 * multi-signal enrichment layer. This module re-exports it so existing
 * imports (`../lib/bin-lookup`) and their tests keep working unchanged.
 */

export { lookupBin, clearBinCache, BIN_FALLBACK, type BinInfo } from './enrichment/bin';
