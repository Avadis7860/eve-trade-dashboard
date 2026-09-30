// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EsiCache } from './cache.ts';
import { EsiRateLimiter } from './rateLimiter.ts';
import { EsiClient } from './client.ts';
import { fetchXPages, fetchFromId } from './pagination.ts';

describe('ESI Gateway — Cache & 304 Not Modified', () => {
  let cache: EsiCache;

  beforeEach(() => {
    cache = new EsiCache();
  });

  it('generates stable distinct keys for routes, params and character contexts', () => {
    const key1 = cache.generateKey('/markets/10000002/orders/', { type_id: 34, page: 1 });
    const key2 = cache.generateKey('/markets/10000002/orders/', { page: 1, type_id: 34 });
    const charKey = cache.generateKey('/characters/123/orders/', undefined, 123);

    expect(key1).toBe(key2); // Parameter ordering normalized
    expect(key1).toContain('pub:');
    expect(charKey).toContain('char:123:');
  });

  it('stores and retrieves fresh cache entries before expiration', () => {
    const key = 'test_key';
    const data = [{ order_id: 1001, price: 10.5 }];
    const futureExpires = new Date(Date.now() + 60000).toUTCString();

    cache.set(key, data, {
      etag: '"abc-123"',
      expiresHeader: futureExpires,
    });

    const fresh = cache.getFresh<typeof data>(key);
    expect(fresh).not.toBeNull();
    expect(fresh?.data).toEqual(data);
    expect(fresh?.etag).toBe('"abc-123"');
  });

  it('returns null for expired entries on getFresh but retains stale data for 304 conditional request', () => {
    const key = 'test_key_expired';
    const data = [{ order_id: 2002 }];
    const pastExpires = new Date(Date.now() - 5000).toUTCString();

    cache.set(key, data, {
      etag: '"xyz-789"',
      expiresHeader: pastExpires,
    });

    expect(cache.getFresh(key)).toBeNull();
    const stale = cache.getStale<typeof data>(key);
    expect(stale).not.toBeNull();
    expect(stale?.etag).toBe('"xyz-789"');
    expect(stale?.data).toEqual(data);
  });

  it('updates expiration metadata on touch304 without wiping data', () => {
    const key = 'test_304';
    const originalData = [{ id: 1 }];

    cache.set(key, originalData, {
      etag: '"v1"',
      expiresHeader: new Date(Date.now() - 1000).toUTCString(),
    });

    const newExpires = new Date(Date.now() + 120000).toUTCString();
    cache.touch304(key, { expiresHeader: newExpires });

    const fresh = cache.getFresh<typeof originalData>(key);
    expect(fresh).not.toBeNull();
    expect(fresh?.data).toEqual(originalData);
  });
});

describe('ESI Gateway — Rate Limiting, Error Budget & Suspension', () => {
  let rateLimiter: EsiRateLimiter;

  beforeEach(() => {
    rateLimiter = new EsiRateLimiter(2);
  });

  it('tracks error budget remain and reset from headers', () => {
    const headers = new Headers({
      'x-esi-error-limit-remain': '85',
      'x-esi-error-limit-reset': '30',
    });

    rateLimiter.updateFromHeaders(headers);
    const status = rateLimiter.getStatus();
    expect(status.errorLimitRemain).toBe(85);
    expect(status.errorLimitResetSeconds).toBeGreaterThan(0);
    expect(status.isSuspended).toBe(false);
  });

  it('suspends requests when error limit drops to critical threshold (<= 5)', () => {
    const headers = new Headers({
      'x-esi-error-limit-remain': '3',
      'x-esi-error-limit-reset': '20',
    });

    rateLimiter.updateFromHeaders(headers);
    const status = rateLimiter.getStatus();
    expect(status.isSuspended).toBe(true);
    expect(status.suspendedUntil).toBeGreaterThan(Date.now());
  });

  it('suspends immediately on HTTP 420 or HTTP 429 with retry-after', () => {
    rateLimiter.handleRateLimitHit(420, 45);
    expect(rateLimiter.isSuspended()).toBe(true);

    rateLimiter.reset();
    expect(rateLimiter.isSuspended()).toBe(false);

    rateLimiter.handleRateLimitHit(429, 15);
    expect(rateLimiter.isSuspended()).toBe(true);
  });

  it('automatically unblocks queued requests when suspension expires without deadlocking', async () => {
    const limiter = new EsiRateLimiter(2);
    // Fill all 2 slots
    await limiter.acquire();
    await limiter.acquire();

    // Trigger short 100ms suspension
    limiter.handleRateLimitHit(429, 0.1);
    expect(limiter.isSuspended()).toBe(true);

    // Queue 3rd request while suspended and at max concurrency
    let thirdResolved = false;
    const thirdPromise = limiter.acquire().then(() => {
      thirdResolved = true;
    });

    expect(thirdResolved).toBe(false);

    // Release 1st slot while still suspended
    limiter.release();
    expect(thirdResolved).toBe(false);

    // Wait 150ms for suspension to expire
    await new Promise((resolve) => setTimeout(resolve, 150));
    await thirdPromise;

    expect(thirdResolved).toBe(true);
    limiter.release();
    limiter.release();
  });

  it('rejects acquire with timeout error when acquire timeout expires', async () => {
    const limiter = new EsiRateLimiter(1);
    await limiter.acquire();

    // Try acquiring with 50ms timeout while slot is full
    await expect(limiter.acquire(50)).rejects.toThrow('ESI rate limiter acquire timed out after 50ms');
    limiter.release();
  });
});

describe('ESI Gateway — Client Retries, 304 Handling & Errors', () => {
  let cache: EsiCache;
  let rateLimiter: EsiRateLimiter;

  beforeEach(() => {
    cache = new EsiCache();
    rateLimiter = new EsiRateLimiter(5);
  });

  it('serves directly from local cache if still valid without making network fetch', async () => {
    const mockFetch = vi.fn();
    const client = new EsiClient({ baseUrl: 'https://esi.evetech.net' }, cache, rateLimiter, mockFetch as unknown as typeof fetch);

    const key = cache.generateKey('/markets/prices/', undefined, undefined);
    cache.set(key, [{ type_id: 34, adjusted_price: 5.0 }], {
      expiresHeader: new Date(Date.now() + 60000).toUTCString(),
    });

    const res = await client.get('/markets/prices/');
    expect(res.meta.fromCache).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends conditional headers when cache is stale and handles 304 Not Modified', async () => {
    const mockData = [{ type_id: 34, average_price: 6.2 }];
    const key = cache.generateKey('/markets/prices/', undefined, undefined);
    cache.set(key, mockData, {
      etag: '"etag-version-1"',
      expiresHeader: new Date(Date.now() - 1000).toUTCString(),
    });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 304,
      ok: false,
      headers: new Headers({
        'etag': '"etag-version-1"',
        'expires': new Date(Date.now() + 120000).toUTCString(),
      }),
    });

    const client = new EsiClient({ baseUrl: 'https://esi.evetech.net' }, cache, rateLimiter, mockFetch as unknown as typeof fetch);
    const res = await client.get('/markets/prices/');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchHeaders = mockFetch.mock.calls[0][1].headers;
    expect(fetchHeaders['If-None-Match']).toBe('"etag-version-1"');
    expect(res.meta.fromCache).toBe(true);
    expect(res.data).toEqual(mockData);
  });

  it('retries bounded times with backoff on 5xx server errors then throws error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      headers: new Headers(),
      text: async () => 'Bad Gateway',
    });

    const client = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', maxRetries: 2, baseBackoffMs: 10 },
      cache,
      rateLimiter,
      mockFetch as unknown as typeof fetch
    );

    await expect(client.get('/status/')).rejects.toThrow(/Server error \(HTTP 502\)/);
    // Initial request + 2 retries = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('never retries on HTTP 403 Forbidden', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      headers: new Headers(),
      text: async () => 'Forbidden',
    });

    const client = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', maxRetries: 3 },
      cache,
      rateLimiter,
      mockFetch as unknown as typeof fetch
    );

    await expect(client.get('/characters/123/orders/')).rejects.toThrow(/Forbidden/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('attempts token refresh on HTTP 401 Unauthorized and retries request', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
      callCount++;
      if (opts.headers['Authorization'] === 'Bearer expired_token') {
        return {
          status: 401,
          ok: false,
          headers: new Headers(),
          text: async () => 'Unauthorized',
        };
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [{ order_id: 999 }],
      };
    });

    const refreshTokenMock = vi.fn().mockResolvedValue('fresh_token_123');

    const client = new EsiClient(
      { baseUrl: 'https://esi.evetech.net' },
      cache,
      rateLimiter,
      mockFetch as unknown as typeof fetch
    );

    const res = await client.get('/characters/123/orders/', {
      accessToken: 'expired_token',
      refreshTokenFn: refreshTokenMock,
    });

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual([{ order_id: 999 }]);
    expect(callCount).toBe(2);
  });
});

describe('ESI Gateway — Pagination Strategies (X-Pages & from_id)', () => {
  let cache: EsiCache;
  let rateLimiter: EsiRateLimiter;

  beforeEach(() => {
    cache = new EsiCache();
    rateLimiter = new EsiRateLimiter(5);
  });

  it('fetches all pages sequentially using X-Pages strategy', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsedUrl = new URL(url);
      const page = parsedUrl.searchParams.get('page') || '1';

      if (page === '1') {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'x-pages': '2', 'content-type': 'application/json' }),
          json: async () => [{ id: 1 }, { id: 2 }],
        };
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'x-pages': '2', 'content-type': 'application/json' }),
        json: async () => [{ id: 3 }, { id: 4 }],
      };
    });

    const client = new EsiClient({ baseUrl: 'https://esi.evetech.net' }, cache, rateLimiter, mockFetch as unknown as typeof fetch);
    const result = await fetchXPages<{ id: number }>(client, '/markets/10000002/orders/');

    expect(result.status).toBe('COMPLETE');
    expect(result.totalFetched).toBe(4);
    expect(result.pagesFetched).toBe(2);
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it('returns PARTIAL status with accumulated data when page 2 fails instead of wiping data', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsedUrl = new URL(url);
      const page = parsedUrl.searchParams.get('page') || '1';

      if (page === '1') {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'x-pages': '3', 'content-type': 'application/json' }),
          json: async () => [{ id: 1 }, { id: 2 }],
        };
      }
      return {
        status: 500,
        ok: false,
        headers: new Headers(),
        text: async () => 'Internal Error',
      };
    });

    const client = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', maxRetries: 0 },
      cache,
      rateLimiter,
      mockFetch as unknown as typeof fetch
    );

    const result = await fetchXPages<{ id: number }>(client, '/markets/10000002/orders/');
    expect(result.status).toBe('PARTIAL');
    expect(result.totalFetched).toBe(2);
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.error).toBeDefined();
  });

  it('paginates wallet transactions with from_id and deduplicates items', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const parsedUrl = new URL(url);
      const fromId = parsedUrl.searchParams.get('from_id');

      if (!fromId) {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [
            { transaction_id: 100, is_buy: false },
            { transaction_id: 95, is_buy: true },
          ],
        };
      } else if (fromId === '95') {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [
            { transaction_id: 95, is_buy: true }, // Boundary duplicate
            { transaction_id: 80, is_buy: false },
          ],
        };
      }

      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
      };
    });

    const client = new EsiClient({ baseUrl: 'https://esi.evetech.net' }, cache, rateLimiter, mockFetch as unknown as typeof fetch);
    const result = await fetchFromId<{ transaction_id: number; is_buy: boolean }>(
      client,
      '/characters/123/wallet/transactions/',
      {
        getIdFn: (item) => item.transaction_id,
        pageSize: 2,
      }
    );

    expect(result.status).toBe('COMPLETE');
    expect(result.totalFetched).toBe(3); // 100, 95, 80 (95 deduplicated)
    expect(result.data.map((d) => d.transaction_id)).toEqual([100, 95, 80]);
  });
});
