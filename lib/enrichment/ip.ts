/**
 * SentinelFraud — IP geolocation + reputation enrichment.
 *
 * Resolves an IPv4 to { country, lat, lon, anonymized, isp } using the free,
 * keyless ip-api.com endpoint. Two design goals shape this module:
 *
 *  1. DETERMINISTIC + OFFLINE for the demo stream. Synthetic transactions use
 *     IPs from a bundled `DEMO_IP_MAP`, resolved with zero network calls so
 *     tests and the seeded generator are fully reproducible and the app works
 *     with no connectivity.
 *  2. REAL integration for arbitrary IPs. Unknown IPs fall through to
 *     ip-api.com with an in-memory cache, a request timeout, and a safe
 *     neutral fallback. Any failure/rate-limit degrades to IP_FALLBACK
 *     (country null, not anonymized) — never fraud-biasing, never throws.
 */

export interface IpInfo {
  /** ISO 3166-1 alpha-2 country of the IP, or null when unknown. */
  country: string | null;
  lat: number | null;
  lon: number | null;
  /** True when the IP is a known proxy, VPN, or hosting/datacenter address. */
  anonymized: boolean;
  isp: string | null;
}

/** Neutral fallback: unknown location, NOT flagged as anonymized. */
export const IP_FALLBACK: IpInfo = {
  country: null,
  lat: null,
  lon: null,
  anonymized: false,
  isp: null,
};

/**
 * Bundled offline geolocation for the synthetic demo IP pool. Keyed by the
 * full synthetic IP the generator emits. Coordinates are approximate country
 * centroids — enough for the impossible-travel haversine signal.
 */
export const DEMO_IP_MAP: Record<string, IpInfo> = {
  // Legitimate "home" IPs, one per demo user country.
  '198.51.100.11': { country: 'US', lat: 38.0, lon: -97.0, anonymized: false, isp: 'Comcast' },
  '198.51.100.24': { country: 'GB', lat: 54.0, lon: -2.0, anonymized: false, isp: 'BT' },
  '198.51.100.37': {
    country: 'DE',
    lat: 51.0,
    lon: 9.0,
    anonymized: false,
    isp: 'Deutsche Telekom',
  },
  '198.51.100.48': { country: 'IN', lat: 22.0, lon: 79.0, anonymized: false, isp: 'Jio' },
  '198.51.100.53': { country: 'CA', lat: 56.0, lon: -106.0, anonymized: false, isp: 'Rogers' },
  '198.51.100.66': { country: 'AU', lat: -25.0, lon: 133.0, anonymized: false, isp: 'Telstra' },
  // Fraudulent origins — foreign, several flagged as anonymizing networks.
  '203.0.113.9': { country: 'RO', lat: 46.0, lon: 25.0, anonymized: true, isp: 'M247 (VPN)' },
  '203.0.113.22': { country: 'NG', lat: 9.0, lon: 8.0, anonymized: false, isp: 'MTN Nigeria' },
  '203.0.113.41': {
    country: 'VN',
    lat: 16.0,
    lon: 108.0,
    anonymized: true,
    isp: 'DigitalOcean (hosting)',
  },
  '203.0.113.58': { country: 'BR', lat: -14.0, lon: -51.0, anonymized: false, isp: 'Vivo' },
  '203.0.113.77': { country: 'UA', lat: 49.0, lon: 32.0, anonymized: true, isp: 'Tor exit' },
  '203.0.113.90': { country: 'PH', lat: 13.0, lon: 122.0, anonymized: true, isp: 'Nord (VPN)' },
};

const IPAPI_URL = 'http://ip-api.com/json';
const REQUEST_TIMEOUT_MS = 4_000;

const cache = new Map<string, IpInfo>();
const inflight = new Map<string, Promise<IpInfo>>();

/** Test hook — clears the module-level caches. */
export function clearIpCache(): void {
  cache.clear();
  inflight.clear();
}

const isValidIpv4 = (ip: string): boolean =>
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) &&
  ip.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);

async function fetchIpInfo(ip: string): Promise<IpInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${IPAPI_URL}/${ip}?fields=status,countryCode,lat,lon,isp,proxy,hosting`,
      { signal: controller.signal },
    );
    if (!res.ok) return IP_FALLBACK;
    const data = (await res.json()) as {
      status?: unknown;
      countryCode?: unknown;
      lat?: unknown;
      lon?: unknown;
      isp?: unknown;
      proxy?: unknown;
      hosting?: unknown;
    };
    if (data?.status !== 'success') return IP_FALLBACK;
    return {
      country: typeof data.countryCode === 'string' ? data.countryCode : null,
      lat: typeof data.lat === 'number' ? data.lat : null,
      lon: typeof data.lon === 'number' ? data.lon : null,
      anonymized: data.proxy === true || data.hosting === true,
      isp: typeof data.isp === 'string' ? data.isp : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up an IP. Always resolves; never rejects.
 * Bundled demo IPs resolve offline; other valid IPs hit ip-api.com (cached).
 */
export async function lookupIp(ip: string): Promise<IpInfo> {
  const clean = (ip ?? '').trim();
  if (!isValidIpv4(clean)) return IP_FALLBACK;

  const demo = DEMO_IP_MAP[clean];
  if (demo) return demo;

  const cached = cache.get(clean);
  if (cached) return cached;

  const pending = inflight.get(clean);
  if (pending) return pending;

  const request = fetchIpInfo(clean)
    .catch(() => IP_FALLBACK)
    .then((info) => {
      cache.set(clean, info);
      inflight.delete(clean);
      return info;
    });

  inflight.set(clean, request);
  return request;
}
