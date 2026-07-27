import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIpCache, lookupIp, IP_FALLBACK } from '../lib/enrichment/ip';
import { analyzeEmail, emailDomain, EMAIL_FALLBACK } from '../lib/enrichment/email';
import { haversineKm, impliedTravel } from '../lib/enrichment/geo';

const okResponse = (payload: unknown) =>
  ({ ok: true, json: async () => payload }) as unknown as Response;

describe('lookupIp', () => {
  beforeEach(() => clearIpCache());
  afterEach(() => vi.unstubAllGlobals());

  it('resolves bundled demo IPs offline with no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const home = await lookupIp('198.51.100.11');
    expect(home.country).toBe('US');
    expect(home.anonymized).toBe(false);
    expect(home.lat).not.toBeNull();

    const proxy = await lookupIp('203.0.113.9');
    expect(proxy.country).toBe('RO');
    expect(proxy.anonymized).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls ip-api.com for unknown IPs and parses the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          status: 'success',
          countryCode: 'JP',
          lat: 35.6,
          lon: 139.7,
          isp: 'NTT',
          proxy: false,
          hosting: true,
        }),
      ),
    );
    const info = await lookupIp('133.0.0.1');
    expect(info.country).toBe('JP');
    expect(info.anonymized).toBe(true); // hosting flag
    expect(info.isp).toBe('NTT');
  });

  it('falls back safely on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    await expect(lookupIp('133.0.0.2')).resolves.toEqual(IP_FALLBACK);
  });

  it('falls back when ip-api reports a non-success status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ status: 'fail', message: 'reserved' })),
    );
    await expect(lookupIp('10.0.0.1')).resolves.toEqual(IP_FALLBACK);
  });

  it('rejects malformed IPs without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupIp('not-an-ip')).resolves.toEqual(IP_FALLBACK);
    await expect(lookupIp('999.1.1.1')).resolves.toEqual(IP_FALLBACK);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('analyzeEmail', () => {
  it('flags disposable domains', () => {
    const info = analyzeEmail('victim@mailinator.com');
    expect(info.disposable).toBe(true);
    expect(info.domain).toBe('mailinator.com');
  });

  it('marks free providers without flagging them disposable', () => {
    const info = analyzeEmail('Person@Gmail.com');
    expect(info.freeProvider).toBe(true);
    expect(info.disposable).toBe(false);
    expect(info.domain).toBe('gmail.com');
  });

  it('treats a normal corporate domain as neither', () => {
    const info = analyzeEmail('ops@acme-corp.example');
    expect(info.disposable).toBe(false);
    expect(info.freeProvider).toBe(false);
  });

  it('returns the fallback for malformed addresses', () => {
    expect(analyzeEmail('no-at-sign')).toEqual(EMAIL_FALLBACK);
    expect(analyzeEmail('trailing@')).toEqual(EMAIL_FALLBACK);
    expect(emailDomain('a@b')).toBeNull();
  });
});

describe('geo helpers', () => {
  it('computes great-circle distance within tolerance', () => {
    // London ↔ New York is ~5570 km.
    const km = haversineKm({ lat: 51.5, lon: -0.13 }, { lat: 40.7, lon: -74.0 });
    expect(km).toBeGreaterThan(5400);
    expect(km).toBeLessThan(5750);
  });

  it('returns null implied travel when there is no previous location', () => {
    expect(impliedTravel(null, { lat: 40, lon: -74, timestamp: 1000 })).toBeNull();
  });

  it('returns null when time did not advance', () => {
    const prev = { lat: 51.5, lon: -0.13, timestamp: 2000 };
    expect(impliedTravel(prev, { lat: 40.7, lon: -74, timestamp: 2000 })).toBeNull();
  });

  it('computes a very high implied speed for a continent hop in minutes', () => {
    const prev = { lat: 38, lon: -97, timestamp: 0 }; // US
    const est = impliedTravel(prev, { lat: 16, lon: 108, timestamp: 5 * 60_000 }); // VN, 5 min later
    expect(est).not.toBeNull();
    expect(est!.impliedKmh).toBeGreaterThan(50_000);
    expect(est!.distanceKm).toBeGreaterThan(10_000);
  });
});
