// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PiCollector } from './collector.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import type { RawEsiPlanet, RawEsiPlanetDetail } from '../esi/types.ts';

describe('Phase P01 — PiCollector: Planetary Interaction Ingestion & Rate Regulation', () => {
  let cache: EsiCache;
  let rateLimiter: EsiRateLimiter;
  let esiClient: EsiClient;
  let piCollector: PiCollector;

  beforeEach(() => {
    cache = new EsiCache();
    rateLimiter = new EsiRateLimiter(5);
    esiClient = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', timeoutMs: 3000, maxRetries: 1 },
      cache,
      rateLimiter
    );
    piCollector = new PiCollector(esiClient, rateLimiter);
  });

  const mockPlanets: RawEsiPlanet[] = [
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 5,
      owner_id: 1001,
      planet_id: 40001,
      planet_type: 'temperate',
      solar_system_id: 300001,
      upgrade_level: 4,
    },
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 8,
      owner_id: 1001,
      planet_id: 40002,
      planet_type: 'barren',
      solar_system_id: 300001,
      upgrade_level: 5,
    },
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 6,
      owner_id: 1001,
      planet_id: 40003,
      planet_type: 'lava',
      solar_system_id: 300001,
      upgrade_level: 4,
    },
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 7,
      owner_id: 1001,
      planet_id: 40004,
      planet_type: 'gas',
      solar_system_id: 300001,
      upgrade_level: 5,
    },
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 4,
      owner_id: 1001,
      planet_id: 40005,
      planet_type: 'plasma',
      solar_system_id: 300001,
      upgrade_level: 3,
    },
    {
      last_update: '2026-10-10T12:00:00Z',
      num_pins: 10,
      owner_id: 1001,
      planet_id: 40006,
      planet_type: 'storm',
      solar_system_id: 300001,
      upgrade_level: 5,
    },
  ];

  const mockDetail = (_planetId: number): RawEsiPlanetDetail => ({
    links: [{ destination_pin_id: 2, link_level: 0, source_pin_id: 1 }],
    pins: [
      {
        latitude: 0.1,
        longitude: 0.2,
        pin_id: 1,
        type_id: 2254,
        contents: [{ amount: 100, type_id: 2400 }],
      },
      {
        latitude: 0.3,
        longitude: 0.4,
        pin_id: 2,
        type_id: 2470,
      },
    ],
    routes: [
      {
        content_type_id: 2400,
        destination_pin_id: 2,
        quantity: 100,
        route_id: 10,
        source_pin_id: 1,
      },
    ],
  });

  it('TEST-P01-PI-01: Successfully collects colonies and pin details with valid ESI payload', async () => {
    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/characters/1001/planets/') {
        return {
          data: mockPlanets,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        };
      }
      const match = path.match(/\/characters\/1001\/planets\/(\d+)\//);
      if (match) {
        const planetId = Number(match[1]);
        return {
          data: mockDetail(planetId),
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await piCollector.collectPlanets(1001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.planetsCount).toBe(6);
    expect(Object.keys(result.planetDetails)).toHaveLength(6);
    expect(result.pinsCount).toBe(12); // 6 planets * 2 pins
    expect(result.suspendedDueToErrorBudget).toBeFalsy();
    expect(piCollector.getStoredPlanets(1001)).toHaveLength(6);
  });

  it('TEST-P01-PI-02: Sub-batching strictly bounds concurrent pin detail queries to <= 4', async () => {
    let currentConcurrent = 0;
    let peakConcurrent = 0;

    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/characters/1001/planets/') {
        return {
          data: mockPlanets,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        };
      }

      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
      // Small delay to simulate network latency and verify sub-batch boundedness
      await new Promise((res) => setTimeout(res, 25));
      currentConcurrent--;

      const match = path.match(/\/characters\/1001\/planets\/(\d+)\//);
      const planetId = match ? Number(match[1]) : 40001;
      return {
        data: mockDetail(planetId),
        meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
      };
    });

    const result = await piCollector.collectPlanets(1001, 'test-token', undefined, { concurrencyLimit: 3 });

    expect(result.status).toBe('COMPLETE');
    expect(peakConcurrent).toBeLessThanOrEqual(3);
    expect(peakConcurrent).toBeGreaterThan(0);
  });

  it('TEST-P01-PI-03: Error Budget Guard: Suspends collection if errorLimitRemain < 50', async () => {
    // Set headers with errorLimitRemain = 45 (< 50)
    rateLimiter.updateFromHeaders(
      new Headers({
        'x-esi-error-limit-remain': '45',
        'x-esi-error-limit-reset': '30',
      })
    );

    const spyGet = vi.spyOn(esiClient, 'get');

    const result = await piCollector.collectPlanets(1001, 'test-token');

    expect(result.suspendedDueToErrorBudget).toBe(true);
    expect(result.status).toBe('ABSENT');
    expect(result.error).toContain('ESI error budget low');
    expect(spyGet).not.toHaveBeenCalled(); // Prevented any network call
  });

  it('TEST-P01-PI-04: Error Budget Guard: Mid-batch suspension when budget drops below threshold', async () => {
    let callCount = 0;
    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/characters/1001/planets/') {
        return {
          data: mockPlanets,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        };
      }

      callCount++;
      if (callCount === 2) {
        // Drop error budget during execution
        rateLimiter.updateFromHeaders(
          new Headers({
            'x-esi-error-limit-remain': '40',
            'x-esi-error-limit-reset': '45',
          })
        );
      }

      const match = path.match(/\/characters\/1001\/planets\/(\d+)\//);
      const planetId = match ? Number(match[1]) : 40001;
      return {
        data: mockDetail(planetId),
        meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
      };
    });

    const result = await piCollector.collectPlanets(1001, 'test-token', undefined, { concurrencyLimit: 2 });

    expect(result.suspendedDueToErrorBudget).toBe(true);
    expect(result.status).toBe('PARTIAL');
    // Only first batch was fetched, subsequent batch was skipped
    expect(Object.keys(result.planetDetails).length).toBeLessThan(6);
  });

  it('TEST-P01-PI-05: Returns COMPLETE with 0 planets for characters with no PI setup', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: [],
      meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
    });

    const result = await piCollector.collectPlanets(1001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.planetsCount).toBe(0);
    expect(result.pinsCount).toBe(0);
    expect(result.planetDetails).toEqual({});
  });

  it('TEST-P01-PI-06: Respects 304 Not Modified without replacing valid cached representation', async () => {
    // 1. Initial 200 fetch
    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/characters/1001/planets/') {
        return {
          data: [mockPlanets[0]],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), etag: '"p-v1"' },
        };
      }
      return {
        data: mockDetail(40001),
        meta: { status: 200, fromCache: false, fetchedAt: Date.now(), etag: '"d-v1"' },
      };
    });

    await piCollector.collectPlanets(1001, 'test-token');
    const stored = piCollector.getStoredPlanetDetail(1001, 40001);
    expect(stored).not.toBeNull();
    expect(stored?.pins).toHaveLength(2);

    // 2. Second fetch returns 304 fromCache
    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/characters/1001/planets/') {
        return {
          data: [mockPlanets[0]],
          meta: { status: 304, fromCache: true, fetchedAt: Date.now(), etag: '"p-v1"' },
        };
      }
      return {
        data: mockDetail(40001),
        meta: { status: 304, fromCache: true, fetchedAt: Date.now(), etag: '"d-v1"' },
      };
    });

    const res304 = await piCollector.collectPlanets(1001, 'test-token');
    expect(res304.status).toBe('COMPLETE');
    expect(piCollector.getStoredPlanetDetail(1001, 40001)).toEqual(stored);
  });
});
