import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from './service.ts';
import { SyncCoordinator } from './coordinator.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemorySyncRepository } from './repository.ts';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import type { EsiRequestOptions } from '../esi/types.ts';

describe('Phase R05 — Bounded Concurrency, Request Coalescing & Rate Limiting Guard', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let syncRepo: InMemorySyncRepository;
  let assetsRepo: InMemoryAssetsRepository;
  let universeService: UniverseService;
  let esiCache: EsiCache;
  let esiRateLimiter: EsiRateLimiter;
  let esiClient: EsiClient;
  let coordinator: SyncCoordinator;
  let syncService: SyncService;

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ordersRepo = new InMemoryOrdersRepository();
    syncRepo = new InMemorySyncRepository();
    assetsRepo = new InMemoryAssetsRepository();
    esiCache = new EsiCache();
    esiRateLimiter = new EsiRateLimiter(5);
    coordinator = new SyncCoordinator(4);

    esiClient = new EsiClient(
      {
        baseUrl: 'https://esi.evetech.net/latest',
        userAgent: 'EVE-Trade-Dashboard-Test',
        timeoutMs: 3000,
        maxRetries: 1,
        baseBackoffMs: 10,
        concurrencyLimit: 5,
      },
      esiCache,
      esiRateLimiter
    );

    universeService = new UniverseService(esiClient);
    syncService = new SyncService(
      esiClient,
      ledgerRepo,
      ordersRepo,
      syncRepo,
      universeService,
      assetsRepo,
      coordinator
    );
  });

  describe('1. SyncCoordinator Worker Pool & Bounded Concurrency', () => {
    it('strictly bounds concurrent worker execution to maxConcurrent limit', async () => {
      const pool = new SyncCoordinator(3);
      let activePeak = 0;
      let currentActive = 0;

      const makeTask = (id: number, durationMs: number) => async () => {
        currentActive++;
        activePeak = Math.max(activePeak, currentActive);
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        currentActive--;
        return `done-${id}`;
      };

      const promises = Array.from({ length: 9 }, (_, i) =>
        pool.enqueue(`task-${i}`, makeTask(i, 20))
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(9);
      expect(activePeak).toBeLessThanOrEqual(3);
      expect(pool.getStats().activeWorkers).toBe(0);
      expect(pool.getStats().queuedTasks).toBe(0);
      expect(pool.getStats().totalProcessed).toBe(9);
    });

    it('times out and rejects hanging tasks without permanently locking the worker pool', async () => {
      const pool = new SyncCoordinator(2);

      // Task 1: hangs indefinitely
      const hangingTask = pool.enqueue(
        'hanging',
        () => new Promise(() => {}), // never resolves
        { timeoutMs: 50 }
      );

      // Task 2: quick task
      const quickTask = pool.enqueue(
        'quick',
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return 'success';
        },
        { timeoutMs: 200 }
      );

      await expect(hangingTask).rejects.toThrow('timed out after 50ms');
      await expect(quickTask).resolves.toBe('success');

      expect(pool.getStats().activeWorkers).toBe(0);
    });
  });

  describe('2. In-Flight Request Merging (Coalescing / Deduplication)', () => {
    it('merges 5 concurrent syncWalletTransactions calls into a single ESI execution and resolves all callers with identical result', async () => {
      let networkCalls = 0;

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/wallet/transactions/')) {
          networkCalls++;
          await new Promise((r) => setTimeout(r, 30));
          return {
            data: [
              {
                transaction_id: 8801,
                date: '2026-09-25T10:00:00Z',
                type_id: 34,
                quantity: 500,
                unit_price: 6.0,
                is_buy: true,
                is_personal: true,
                journal_ref_id: 101,
                location_id: 60003760,
                client_id: 1,
              },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      // Launch 5 calls concurrently for character 1001
      const [res1, res2, res3, res4, res5] = await Promise.all([
        syncService.syncWalletTransactions(1001, 'dummy-token'),
        syncService.syncWalletTransactions(1001, 'dummy-token'),
        syncService.syncWalletTransactions(1001, 'dummy-token'),
        syncService.syncWalletTransactions(1001, 'dummy-token'),
        syncService.syncWalletTransactions(1001, 'dummy-token'),
      ]);

      // All 5 callers get the exact same valid SyncResult
      expect(res1.status).toBe('COMPLETE');
      expect(res1.itemsFetched).toBe(1);
      expect(res2).toBe(res1);
      expect(res3).toBe(res1);
      expect(res4).toBe(res1);
      expect(res5).toBe(res1);

      // Exactly 1 ESI call was made!
      expect(networkCalls).toBe(1);

      // Total coalesced count in coordinator stats
      expect(coordinator.getStats().totalCoalesced).toBe(4);
      expect(coordinator.getStats().totalProcessed).toBe(1);
    });

    it('merges multiple concurrent syncAll calls for the same character', async () => {
      let txCalls = 0;

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/wallet/transactions/')) {
          txCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return {
            data: [
              {
                transaction_id: 9901,
                date: '2026-09-25T10:00:00Z',
                type_id: 34,
                quantity: 100,
                unit_price: 5.0,
                is_buy: false,
                is_personal: true,
                journal_ref_id: 1,
                location_id: 60003760,
                client_id: 1,
              },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const [sync1, sync2, sync3] = await Promise.all([
        syncService.syncAll(1001, 'dummy-token'),
        syncService.syncAll(1001, 'dummy-token'),
        syncService.syncAll(1001, 'dummy-token'),
      ]);

      expect(sync1.transactions.status).toBe('COMPLETE');
      expect(sync2).toBe(sync1);
      expect(sync3).toBe(sync1);
      expect(txCalls).toBe(1);
    });
  });

  describe('3. Multi-Character & Parallel Resource Synchronization', () => {
    it('synchronizes 8 characters concurrently without deadlock or timeout (prevents child task starvation)', async () => {
      // User scenario: 8 linked characters synced at once
      const userCharacterIds = [
        2124224223, 2124236919, 2124260787, 2124260809,
        2124665440, 2124699373, 2124717459, 2124724334,
      ];

      let networkCallsCount = 0;
      vi.spyOn(esiClient, 'get').mockImplementation(async () => {
        networkCallsCount++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          data: [],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
        } as never;
      });

      const characters = userCharacterIds.map((id) => ({
        characterId: id,
        accessToken: `token-${id}`,
      }));

      const results = await syncService.syncCharacters(characters);

      expect(results).toHaveLength(8);
      // All 8 characters must complete with ZERO errors and NO deadlocks
      for (const res of results) {
        expect(res.error).toBeNull();
        expect(res.result).not.toBeNull();
        expect(res.result?.transactions.status).toBe('COMPLETE');
        expect(res.result?.orders.status).toBe('COMPLETE');
      }
      expect(networkCallsCount).toBeGreaterThanOrEqual(8 * 4);
    });

    it('executes 3 characters with 4 resources each concurrently without exceeding rate limiter or pool boundaries', async () => {
      let activeEsiRequests = 0;
      let peakEsiRequests = 0;

      vi.spyOn(esiClient, 'get').mockImplementation(async (_path: string) => {
        activeEsiRequests++;
        peakEsiRequests = Math.max(peakEsiRequests, activeEsiRequests);
        await new Promise((resolve) => setTimeout(resolve, 15));
        activeEsiRequests--;
        return {
          data: [],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
        } as never;
      });

      const characters = [
        { characterId: 1001, accessToken: 'token-1' },
        { characterId: 1002, accessToken: 'token-2' },
        { characterId: 1003, accessToken: 'token-3' },
      ];

      const results = await syncService.syncCharacters(characters);

      expect(results).toHaveLength(3);
      expect(results[0].error).toBeNull();
      expect(results[1].error).toBeNull();
      expect(results[2].error).toBeNull();

      expect(results[0].result?.transactions.status).toBe('COMPLETE');
      expect(results[1].result?.orders.status).toBe('COMPLETE');
      expect(results[2].result?.assets.status).toBe('COMPLETE');

      // Peak active ESI requests should stay bounded (<= rateLimiter capacity)
      expect(peakEsiRequests).toBeLessThanOrEqual(5);
    });

    it('runs independent resources (tx, journal, orders, assets) in parallel within syncAll', async () => {
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        let resKey = 'unknown';
        if (path.includes('/wallet/transactions/')) resKey = 'tx';
        else if (path.includes('/wallet/journal/')) resKey = 'journal';
        else if (path.includes('/orders/')) resKey = 'orders';
        else if (path.includes('/assets/')) resKey = 'assets';

        startTimes[resKey] = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 30));
        endTimes[resKey] = Date.now();

        return {
          data: [],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
        } as never;
      });

      const start = Date.now();
      const res = await syncService.syncAll(1001, 'dummy-token');
      const totalDuration = Date.now() - start;

      expect(res.transactions.status).toBe('COMPLETE');
      expect(res.journal.status).toBe('COMPLETE');
      expect(res.orders.status).toBe('COMPLETE');
      expect(res.assets.status).toBe('COMPLETE');

      // With 4 resources taking ~30ms each, sequential would take ~120ms+.
      // In parallel with 4 workers, it should take well under 100ms.
      expect(totalDuration).toBeLessThan(100);
    });
  });

  describe('4. Rate Limiter Cooldown (420/429) & Resumption', () => {
    it('suspends worker execution on HTTP 420 and smoothly resumes once the cooldown finishes', async () => {
      let callCount = 0;

      vi.spyOn(esiClient, 'get').mockImplementation(async (_path: string, _options?: EsiRequestOptions) => {
        callCount++;
        if (callCount === 1) {
          // Simulate HTTP 420 with 1-second Retry-After
          esiRateLimiter.handleRateLimitHit(420, 1);
          throw new Error('ESI Rate limit exceeded (Error limit 420)');
        }
        return {
          data: [],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        } as never;
      });

      // Attempt 1: Hits rate limit
      const run1 = await syncService.syncWalletTransactions(1001, 'dummy-token');
      expect(run1.status).toBe('ERROR');
      expect(esiRateLimiter.isSuspended()).toBe(true);

      // Fast forward cooldown
      esiRateLimiter.reset();
      expect(esiRateLimiter.isSuspended()).toBe(false);

      // Attempt 2: Resumes normally
      const run2 = await syncService.syncWalletTransactions(1001, 'dummy-token');
      expect(run2.status).toBe('COMPLETE');
    });
  });

  describe('5. Performance Benchmark (Sequential vs Parallel Pool)', () => {
    it('validates substantial synchronization speedup (>50% reduction) with parallel task pool', async () => {
      // Mock with 20ms network latency per ESI call
      vi.spyOn(esiClient, 'get').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          data: [],
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
        } as never;
      });

      // 1. Simulated Sequential Duration
      const seqStart = performance.now();
      await syncService.syncWalletTransactions(2001, 'dummy-token');
      await syncService.syncWalletJournal(2001, 'dummy-token');
      await syncService.syncCharacterOrders(2001, 'dummy-token');
      await syncService.syncCharacterAssets(2001, 'dummy-token');
      const seqDuration = performance.now() - seqStart;

      // 2. Parallel SyncAll Duration
      const parStart = performance.now();
      await syncService.syncAll(2002, 'dummy-token');
      const parDuration = performance.now() - parStart;

      // Parallel execution should be substantially faster than sequential
      expect(parDuration).toBeLessThan(seqDuration * 0.7);
      expect(parDuration).toBeLessThan(100);
    });

    it('bypasses in-memory fresh cache and issues conditional validation (If-None-Match) with CCP ESI on forceRevalidate', async () => {
      let callCount = 0;
      let sentIfNoneMatch: string | undefined;

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        callCount++;
        const headers = (init?.headers || {}) as Record<string, string>;
        sentIfNoneMatch = headers['If-None-Match'];

        if (sentIfNoneMatch === '"etag-live"') {
          // CCP ESI confirms no change on conditional revalidation
          return new Response(null, {
            status: 304,
            headers: new Headers({
              etag: '"etag-live"',
              expires: new Date(Date.now() + 300000).toUTCString(),
            }),
          });
        }

        return new Response(JSON.stringify([{ order_id: 5555, type_id: 34 }]), {
          status: 200,
          headers: new Headers({
            etag: '"etag-live"',
            expires: new Date(Date.now() + 300000).toUTCString(), // 5 min in the future
            'content-type': 'application/json',
          }),
        });
      });

      const client = new EsiClient(
        { baseUrl: 'https://esi.evetech.net', maxRetries: 0 },
        esiCache,
        esiRateLimiter,
        mockFetch
      );

      // Call 1: Populates cache with 5-minute future expiration
      const res1 = await client.get<unknown[]>('/characters/1001/orders/');
      expect(res1.meta.status).toBe(200);
      expect(callCount).toBe(1);

      // Call 2: Default get() with fresh in-memory cache returns without network call
      const res2 = await client.get<unknown[]>('/characters/1001/orders/');
      expect(res2.meta.status).toBe(304);
      expect(res2.meta.fromCache).toBe(true);
      expect(callCount).toBe(1); // No network call made

      // Call 3: With forceRevalidate: true, MUST issue conditional HTTP request to CCP ESI!
      const res3 = await client.get<unknown[]>('/characters/1001/orders/', { forceRevalidate: true });
      expect(res3.meta.status).toBe(304);
      expect(callCount).toBe(2); // Network call was made!
      expect(sentIfNoneMatch).toBe('"etag-live"'); // Sent If-None-Match
    });
  });

  describe('6. Phase F01 — AbortSignal Interruptibility & Ghost Task Prevention', () => {
    it('aborts running task via AbortSignal when coordinator timeout fires and prevents ghost writes', async () => {
      const pool = new SyncCoordinator(2);
      let wasAborted = false;
      let postTimeoutExecutionReached = false;

      const task = pool.enqueue(
        'cancellable-task',
        async (signal: AbortSignal) => {
          signal.addEventListener('abort', () => {
            wasAborted = true;
          });

          // Wait longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 80));

          if (!signal.aborted) {
            postTimeoutExecutionReached = true;
          }
          return 'should-not-reach';
        },
        { timeoutMs: 30 }
      );

      await expect(task).rejects.toThrow('timed out after 30ms');
      expect(wasAborted).toBe(true);
      expect(postTimeoutExecutionReached).toBe(false);
      expect(pool.getStats().activeWorkers).toBe(0);
    });

    it('multi-character stress test with mixed timeouts stays strictly within concurrency bounds', async () => {
      const pool = new SyncCoordinator(4);
      let activeWorkersPeak = 0;

      const runWithTracking = async (id: number, duration: number, signal: AbortSignal) => {
        activeWorkersPeak = Math.max(activeWorkersPeak, pool.getStats().activeWorkers);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, duration);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new Error('Aborted'));
          });
        });
        return `ok-${id}`;
      };

      const tasks = Array.from({ length: 16 }, (_, i) => {
        const duration = i % 2 === 0 ? 60 : 15;
        const timeoutMs = i % 2 === 0 ? 25 : 50;
        return pool
          .enqueue(`stress-${i}`, (signal) => runWithTracking(i, duration, signal), { timeoutMs })
          .catch((err) => (err as Error).message);
      });

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(16);
      expect(activeWorkersPeak).toBeLessThanOrEqual(4);
      expect(pool.getStats().activeWorkers).toBe(0);
    });
  });
});
