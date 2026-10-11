// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndustryCollector } from './collector.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import type { RawEsiIndustryJob } from '../esi/types.ts';

describe('Phase P01 — IndustryCollector: Character & Corporation Jobs Ingestion', () => {
  let cache: EsiCache;
  let rateLimiter: EsiRateLimiter;
  let esiClient: EsiClient;
  let industryCollector: IndustryCollector;

  beforeEach(() => {
    cache = new EsiCache();
    rateLimiter = new EsiRateLimiter(5);
    esiClient = new EsiClient(
      { baseUrl: 'https://esi.evetech.net', timeoutMs: 3000, maxRetries: 1 },
      cache,
      rateLimiter
    );
    industryCollector = new IndustryCollector(esiClient);
  });

  const mockCharJobs: RawEsiIndustryJob[] = [
    {
      activity_id: 1, // Manufacturing
      blueprint_id: 10001,
      blueprint_location_id: 60003760,
      blueprint_type_id: 688,
      cost: 150000,
      duration: 3600,
      end_date: '2026-10-10T15:00:00Z',
      facility_id: 60003760,
      installer_id: 1001,
      job_id: 90001,
      licensed_runs: 10,
      output_location_id: 60003760,
      runs: 1,
      start_date: '2026-10-10T14:00:00Z',
      station_id: 60003760,
      status: 'active',
    },
    {
      activity_id: 5, // Copying
      blueprint_id: 10002,
      blueprint_location_id: 60003760,
      blueprint_type_id: 688,
      cost: 50000,
      duration: 1800,
      end_date: '2026-10-10T13:30:00Z',
      facility_id: 60003760,
      installer_id: 1001,
      job_id: 90002,
      output_location_id: 60003760,
      runs: 2,
      start_date: '2026-10-10T13:00:00Z',
      station_id: 60003760,
      status: 'delivered',
      completed_character_id: 1001,
      completed_date: '2026-10-10T13:30:00Z',
    },
  ];

  const mockCorpJobs: RawEsiIndustryJob[] = [
    {
      activity_id: 1,
      blueprint_id: 20001,
      blueprint_location_id: 60003760,
      blueprint_type_id: 12005,
      cost: 5000000,
      duration: 72000,
      end_date: '2026-10-11T10:00:00Z',
      facility_id: 60003760,
      installer_id: 1001,
      job_id: 90003,
      output_location_id: 60003760,
      runs: 5,
      start_date: '2026-10-10T14:00:00Z',
      station_id: 60003760,
      status: 'active',
    },
  ];

  it('TEST-P01-IND-01: Successfully collects character industry jobs with include_completed parameter', async () => {
    const spyGet = vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockCharJobs,
      meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
    });

    const result = await industryCollector.collectCharacterJobs(1001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.totalJobs).toBe(2);
    expect(result.characterJobs).toEqual(mockCharJobs);
    expect(industryCollector.getStoredCharacterJobs(1001)).toHaveLength(2);

    expect(spyGet).toHaveBeenCalledWith(
      '/characters/1001/industry/jobs/',
      expect.objectContaining({
        accessToken: 'test-token',
        params: { include_completed: true },
      })
    );
  });

  it('TEST-P01-IND-02: Successfully collects corporation industry jobs with roles', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockCorpJobs,
      meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
    });

    const result = await industryCollector.collectCorporationJobs(1001, 980001, 'test-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.corporationId).toBe(980001);
    expect(result.corporationJobs).toEqual(mockCorpJobs);
    expect(result.totalJobs).toBe(1);
    expect(industryCollector.getStoredCorporationJobs(980001)).toHaveLength(1);
  });

  it('TEST-P01-IND-03: Gracefully handles 403 Forbidden without crashing when character lacks corp roles', async () => {
    vi.spyOn(esiClient, 'get').mockRejectedValueOnce(
      new Error('Forbidden: HTTP 403 - character lacks Factory_Manager role')
    );

    const result = await industryCollector.collectCorporationJobs(1001, 980001, 'test-token');

    expect(result.status).toBe('PARTIAL');
    expect(result.error).toContain('Lacks corporation industry roles');
    expect(result.totalJobs).toBe(0);
  });

  it('TEST-P01-IND-04: Returns cached representation upon 304 Not Modified', async () => {
    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockCharJobs,
      meta: { status: 200, fromCache: false, fetchedAt: Date.now(), etag: '"jobs-v1"' },
    });

    await industryCollector.collectCharacterJobs(1001, 'test-token');

    vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
      data: mockCharJobs,
      meta: { status: 304, fromCache: true, fetchedAt: Date.now(), etag: '"jobs-v1"' },
    });

    const res304 = await industryCollector.collectCharacterJobs(1001, 'test-token');
    expect(res304.status).toBe('COMPLETE');
    expect(res304.characterJobs).toHaveLength(2);
  });
});
