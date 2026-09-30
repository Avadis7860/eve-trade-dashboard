import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UniverseService, MAX_ESI_INT32 } from './service.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';

describe('Universe Service', () => {
  let universeService: UniverseService;
  let esiClient: EsiClient;

  beforeEach(() => {
    esiClient = new EsiClient(
      {
        baseUrl: 'https://esi.evetech.net/latest',
        userAgent: 'test-agent',
        timeoutMs: 5000,
        maxRetries: 1,
        baseBackoffMs: 10,
        concurrencyLimit: 2,
      },
      new EsiCache(),
      new EsiRateLimiter()
    );

    universeService = new UniverseService(esiClient);
  });

  it('resolves well known static names immediately without network requests', () => {
    expect(universeService.getNameSync(34)).toBe('Tritanium');
    expect(universeService.getNameSync(60003760)).toBe('Jita IV - Moon 4 - Caldari Navy Assembly Plant');
    expect(universeService.getNameSync(999999999, 'CustomPrefix')).toBe('CustomPrefix #999999999');
  });

  it('resolves unknown IDs via ESI /universe/names/ endpoint', async () => {
    const postSpy = vi.spyOn(esiClient, 'post').mockResolvedValue({
      data: [
        { id: 95465499, name: 'Test Pilot Character', category: 'character' },
      ],
      meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
    });

    const resolved = await universeService.resolveNames([95465499]);
    expect(resolved.get(95465499)).toBe('Test Pilot Character');
    expect(universeService.getNameSync(95465499)).toBe('Test Pilot Character');
    expect(postSpy).toHaveBeenCalledWith('/universe/names/', [95465499]);
  });

  it('safely handles 64-bit Upwell structure IDs without sending them to ESI int32 /universe/names/', async () => {
    const postSpy = vi.spyOn(esiClient, 'post');
    const structureIds = [1044961079041, 1055001846642, 1032717532381];

    expect(universeService.isStructureId(1044961079041)).toBe(true);
    expect(universeService.isStructureId(60003760)).toBe(false);
    expect(universeService.isStructureId(MAX_ESI_INT32)).toBe(false);

    const resolved = await universeService.resolveNames(structureIds);

    // ESI POST should NEVER be called since all IDs are 64-bit structure IDs
    expect(postSpy).not.toHaveBeenCalled();
    expect(resolved.get(1044961079041)).toBe('Structure #1044961079041');
    expect(resolved.get(1055001846642)).toBe('Structure #1055001846642');
    expect(resolved.get(1032717532381)).toBe('Structure #1032717532381');
    expect(universeService.getNameSync(1044961079041)).toBe('Structure #1044961079041');
  });

  it('isolates structure IDs from mixed batch requests and only sends int32 IDs to ESI', async () => {
    const postSpy = vi.spyOn(esiClient, 'post').mockResolvedValue({
      data: [
        { id: 12345, name: 'Standard NPC Corp', category: 'corporation' },
      ],
      meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
    });

    const mixedIds = [12345, 1044961079041];
    const resolved = await universeService.resolveNames(mixedIds);

    // Only int32 ID should be passed to POST /universe/names/
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/universe/names/', [12345]);
    expect(resolved.get(12345)).toBe('Standard NPC Corp');
    expect(resolved.get(1044961079041)).toBe('Structure #1044961079041');
  });
});
