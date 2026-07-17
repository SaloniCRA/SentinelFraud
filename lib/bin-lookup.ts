/**
 * SentinelFraud — card BIN enrichment via the free binlist.net API.
 *
 * Resolves a card BIN (first 6 digits) to the issuing bank and country.
 * Results are cached in-memory by BIN, in-flight requests are deduplicated,
 * and EVERY failure path (network error, timeout, 404, 429 rate limit,
 * malformed payload) resolves to a safe fallback — this module never throws.
 */

export interface BinInfo {
  bank: string;
  /** ISO 3166-1 alpha-2 issuing country, or null when unknown. */
  country: string | null;
}

const BINLIST_URL = 'https://lookup.binlist.net';
const REQUEST_TIMEOUT_MS = 4_000;

export const BIN_FALLBACK: BinInfo = { bank: 'Unknown', country: null };

// Failures are cached too: binlist.net rate-limits aggressively, so
// re-hammering a failing BIN would only make things worse for a demo.
const cache = new Map<string, BinInfo>();
const inflight = new Map<string, Promise<BinInfo>>();

/** Test hook — clears the module-level caches. */
export function clearBinCache(): void {
  cache.clear();
  inflight.clear();
}

async function fetchBinInfo(bin: string): Promise<BinInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BINLIST_URL}/${bin}`, {
      headers: { 'Accept-Version': '3' },
      signal: controller.signal,
    });
    if (!res.ok) return BIN_FALLBACK;
    const data: unknown = await res.json();
    const record = data as { bank?: { name?: unknown }; country?: { alpha2?: unknown } };
    return {
      bank:
        typeof record?.bank?.name === 'string' && record.bank.name ? record.bank.name : 'Unknown',
      country: typeof record?.country?.alpha2 === 'string' ? record.country.alpha2 : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a BIN. Always resolves; never rejects.
 * Invalid input (fewer than 6 digits) short-circuits to the fallback.
 */
export async function lookupBin(bin: string): Promise<BinInfo> {
  const digits = (bin ?? '').replace(/\D/g, '').slice(0, 8);
  if (digits.length < 6) return BIN_FALLBACK;

  const cached = cache.get(digits);
  if (cached) return cached;

  const pending = inflight.get(digits);
  if (pending) return pending;

  const request = fetchBinInfo(digits)
    .catch(() => BIN_FALLBACK)
    .then((info) => {
      cache.set(digits, info);
      inflight.delete(digits);
      return info;
    });

  inflight.set(digits, request);
  return request;
}
