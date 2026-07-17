import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_FALLBACK, clearBinCache, lookupBin } from '../lib/bin-lookup';

const okResponse = (payload: unknown) =>
  ({ ok: true, json: async () => payload }) as unknown as Response;

const errorResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe('lookupBin', () => {
  beforeEach(() => clearBinCache());
  afterEach(() => vi.unstubAllGlobals());

  it('returns bank and country from the API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ bank: { name: 'Test Bank' }, country: { alpha2: 'GB' } })),
    );
    await expect(lookupBin('999901')).resolves.toEqual({ bank: 'Test Bank', country: 'GB' });
  });

  it('caches results by BIN', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ bank: { name: 'Cache Bank' }, country: { alpha2: 'US' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await lookupBin('999902');
    await lookupBin('999902');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back safely on network failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network down'))),
    );
    await expect(lookupBin('999903')).resolves.toEqual(BIN_FALLBACK);
  });

  it('falls back safely on rate limiting (HTTP 429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(429)),
    );
    await expect(lookupBin('999904')).resolves.toEqual(BIN_FALLBACK);
  });

  it('falls back safely on malformed payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ unexpected: true })),
    );
    await expect(lookupBin('999905')).resolves.toEqual({ bank: 'Unknown', country: null });
  });

  it('rejects invalid BINs without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupBin('12')).resolves.toEqual(BIN_FALLBACK);
    await expect(lookupBin('')).resolves.toEqual(BIN_FALLBACK);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
