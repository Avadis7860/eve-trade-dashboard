// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiningCollector } from './collector.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import type { RawEsiMiningEntry } from '../esi/types.ts';

describe('Phase P01 — MiningCollector: Character Mining Ledger Ingestion & Pagination', () => {
  let cache: EsiCache;
  let rateLimiter: EsiRateLimiter;
  let esiClient: EsiClient;
  let miningCollector: MiningCollector;

  beforeEach(() => {
    cache = new EsiCache();
    rateLimiter = new EsiRateLimiter(5);
    esiClient = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', timeoutMs: 3000, maxRetries: 1 },
      cache,
      rateLimiter
    );
    miningCollector = new MiningCollector(esiClient);
  });

  const mockMiningEntries: RawEsiMiningEntry[] = [
    {
      date: '2026-10-10',
      quantity: 15000,
      solar_system_id: 30000142, // Jita
      type_id: 34, // Tritanium
    },
    {
      date: '2026-10-10',
      quantity: 8500,
      solar_system_id: 30000142,
      type_id: 35, // Pyerite
    },
    {
      date: '2026-10-09',
      quantity: 22000,
      solar_system_id: 30002187, // Amamake
      type_id: 17459, // Veldspar
    },
  ];

  it('TEST-P01-MIN-01: Successfully collects mining ledger entries and calculates total quantity', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockMiningEntries,
      meta: {
        status: 200,
        fromCache: false,
        pages: 1,
        fetchedAt: Date.now(),
      },
    });

    const result = await miningCollector.collectMiningLedger(1001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.entries).toHaveLength(3);
    expect(result.totalQuantity).toBe(15000 + 8500 + 22000); // 45500
    expect(result.pagesFetched).toBe(1);
    expect(miningCollector.getStoredMiningEntries(1001)).toHaveLength(3);
  });

  it('TEST-P01-MIN-02: Handles empty mining ledger gracefully (returns COMPLETE with 0 entries)', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: [],
      meta: {
        status: 200,
        fromCache: false,
        pages: 1,
        fetchedAt: Date.now(),
      },
    });

    const result = await miningCollector.collectMiningLedger(1001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.entries).toEqual([]);
    expect(result.totalQuantity).toBe(0);
    expect(result.pagesFetched).toBe(1);
  });

  it('TEST-P01-MIN-03: Respects 304 Not Modified cache and retains previously stored entries', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockMiningEntries,
      meta: {
        status: 200,
        fromCache: false,
        pages: 1,
        fetchedAt: Date.now(),
        etag: '"mining-v1"',
      },
    });

    await miningCollector.collectMiningLedger(1001, 'test-token');

    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockMiningEntries,
      meta: {
        status: 304,
        fromCache: true,
        pages: 1,
        fetchedAt: Date.now(),
        etag: '"mining-v1"',
      },
    });

    const res304 = await miningCollector.collectMiningLedger(1001, 'test-token');
    expect(res304.status).toBe('COMPLETE');
    expect(res304.entries).toHaveLength(3);
    expect(res304.totalQuantity).toBe(45500);
  });
});
