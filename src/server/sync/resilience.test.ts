import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService, type RawEsiTransaction, type RawEsiJournalEntry } from './service.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemorySyncRepository } from './repository.ts';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { EsiClient, EsiHttpError } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import { RoiRepository } from '../roi/repository.ts';
import { RoiService } from '../roi/service.ts';
import { fetchFromId, fetchXPages } from '../esi/pagination.ts';
import type { EsiRequestOptions } from '../esi/types.ts';
import type { RawEsiOrder } from '../orders/types.ts';

describe('Resilience, Fault Tolerance & Idempotence (Phase H02 Hardening)', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let syncRepo: InMemorySyncRepository;
  let assetsRepo: InMemoryAssetsRepository;
  let roiRepo: RoiRepository;
  let universeService: UniverseService;
  let esiCache: EsiCache;
  let esiRateLimiter: EsiRateLimiter;
  let esiClient: EsiClient;
  let syncService: SyncService;
  let roiService: RoiService;

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ordersRepo = new InMemoryOrdersRepository();
    syncRepo = new InMemorySyncRepository();
    assetsRepo = new InMemoryAssetsRepository();
    roiRepo = new RoiRepository(ledgerRepo);
    esiCache = new EsiCache();
    esiRateLimiter = new EsiRateLimiter();

    esiClient = new EsiClient(
      {
        baseUrl: 'https://esi.evetech.net/latest',
        userAgent: 'EVE-Trade-Dashboard-Test',
        timeoutMs: 1000,
        maxRetries: 2,
        baseBackoffMs: 10,
        concurrencyLimit: 2,
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
      assetsRepo
    );
    roiService = new RoiService(roiRepo, undefined, ledgerRepo);
  });

  describe('1. Network Cut, Timeouts and Checkpoint Recovery', () => {
    it('fetchFromId preserves partial batch and checkpoint when connection drops midway', async () => {
      let callCount = 0;
      vi.spyOn(esiClient, 'get').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            data: [
              { transaction_id: 2000, date: '2026-09-20T12:00:00Z', type_id: 34, quantity: 100, unit_price: 5.0, is_buy: false, is_personal: true, journal_ref_id: 1, location_id: 60003760, client_id: 1 },
              { transaction_id: 1999, date: '2026-09-20T11:00:00Z', type_id: 34, quantity: 100, unit_price: 5.0, is_buy: false, is_personal: true, journal_ref_id: 2, location_id: 60003760, client_id: 2 },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        // Network drops on page 2
        throw new Error('ECONNRESET: Connection reset by peer');
      });

      const result = await fetchFromId<RawEsiTransaction>(esiClient, '/characters/1001/wallet/transactions/', {
        getIdFn: (tx) => tx.transaction_id,
        pageSize: 2, // triggers pagination to page 2
      });

      expect(result.status).toBe('PARTIAL');
      expect(result.data).toHaveLength(2);
      expect(result.lastSuccessfulId).toBe(1999);
      expect(result.error).toContain('ECONNRESET');
    });

    it('resumes pagination from checkpoint after network recovers without creating duplicates', async () => {
      // Step 1: Generate 2500 items to fill full page 1
      const batch1: RawEsiTransaction[] = Array.from({ length: 2500 }, (_, i) => ({
        transaction_id: 5000 - i,
        date: '2026-09-20T12:00:00Z',
        type_id: 34,
        quantity: 10,
        unit_price: 5.0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 1,
        location_id: 60003760,
        client_id: 1,
      }));

      const batch2: RawEsiTransaction[] = [
        {
          transaction_id: 2500,
          date: '2026-09-20T10:00:00Z',
          type_id: 34,
          quantity: 50,
          unit_price: 5.0,
          is_buy: true,
          is_personal: true,
          journal_ref_id: 3,
          location_id: 60003760,
          client_id: 3,
        },
      ];

      let callCount = 0;
      vi.spyOn(esiClient, 'get').mockImplementation(async (_path: string, options?: EsiRequestOptions) => {
        callCount++;
        const fromId = options?.params?.from_id;
        if (!fromId) {
          return {
            data: batch1,
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        if (fromId === 2501 && callCount === 2) {
          throw new Error('ETIMEDOUT: Connection timed out');
        }
        // Resumption success
        if (fromId === 2501 && callCount >= 3) {
          return {
            data: batch2,
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      // Run 1: Fails midway
      const run1 = await syncService.syncWalletTransactions(1001, 'token-1');
      expect(run1.status).toBe('PARTIAL');
      expect(run1.itemsFetched).toBe(2500);
      expect(ledgerRepo.countTransactions(1001)).toBe(2500);

      // Run 2: Network recovered, resumes and reaches complete status
      const run2 = await syncService.syncWalletTransactions(1001, 'token-1');
      expect(run2.status).toBe('COMPLETE');
      expect(ledgerRepo.countTransactions(1001)).toBe(2501);

      expect(ledgerRepo.getTransactionById(1001, 2500)).not.toBeNull();
      expect(ledgerRepo.getTransactionById(1001, 5000)).not.toBeNull();
    });

    it('fetchXPages preserves pages 1-2 when page 3 fails with 504 Gateway Timeout', async () => {
      let pageRequested = 0;
      vi.spyOn(esiClient, 'get').mockImplementation(async (_path: string, options?: EsiRequestOptions) => {
        pageRequested = Number(options?.params?.page || 1);
        if (pageRequested === 1) {
          return {
            data: [{ id: 101, date: '2026-09-20T12:00:00Z', ref_type: 'market_transaction', amount: 50000, balance: 1000000, description: 'Sale' }],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 3 },
          } as never;
        }
        if (pageRequested === 2) {
          return {
            data: [{ id: 102, date: '2026-09-20T11:00:00Z', ref_type: 'transaction_tax', amount: -2000, balance: 998000, description: 'Tax' }],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 3 },
          } as never;
        }
        throw new EsiHttpError(504, 'ESI Server error (HTTP 504)', { status: 504, fromCache: false, fetchedAt: Date.now() });
      });

      const paginated = await fetchXPages<RawEsiJournalEntry>(esiClient, '/characters/1001/wallet/journal/', { maxPages: 5 });
      expect(paginated.status).toBe('PARTIAL');
      expect(paginated.data).toHaveLength(2);
      expect(paginated.pagesFetched).toBe(2);
      expect(paginated.error).toContain('504');
    });

    it('retains all existing valid data intact when a full network outage occurs', async () => {
      // Seed pre-existing data
      ledgerRepo.saveTransactions([
        {
          id: '1001:100',
          characterId: 1001,
          transactionId: 100,
          date: '2026-09-01T00:00:00Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 1000,
          unitPrice: 5.0,
          totalValue: 5000,
          isBuy: true,
          isPersonal: true,
          journalRefId: 1,
          locationId: 60003760,
          clientId: 10,
          source: 'test',
          observedAt: Date.now(),
        },
      ]);

      vi.spyOn(esiClient, 'get').mockRejectedValue(new Error('Network unreachable'));

      const result = await syncService.syncWalletTransactions(1001, 'dummy-token');
      expect(result.status).toBe('ERROR');
      // Existing data must NOT be cleared or zeroed
      expect(ledgerRepo.countTransactions(1001)).toBe(1);
      const summary = ledgerRepo.getSummary(1001);
      expect(summary.totalBuySpendIsk).toBe(5000);
      expect(summary.completeness).toBe('COMPLETE');
    });
  });

  describe('2. Rate Limiter, Error Budget & HTTP Status Handling', () => {
    it('suspends requests when 420 or 429 rate limit is encountered and enforces Retry-After cooldown', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        return new Response('Rate limit exceeded', {
          status: 420,
          headers: new Headers({
            'retry-after': '3',
            'x-esi-error-limit-remain': '0',
            'x-esi-error-limit-reset': '60',
          }),
        });
      });

      const client = new EsiClient(
        { baseUrl: 'https://esi.evetech.net', maxRetries: 0 },
        esiCache,
        esiRateLimiter,
        mockFetch
      );

      await expect(client.get('/test-endpoint')).rejects.toThrow('ESI Rate limit exceeded');
      expect(esiRateLimiter.isSuspended()).toBe(true);

      // Fast forward cooldown
      esiRateLimiter.reset();
      expect(esiRateLimiter.isSuspended()).toBe(false);
    });

    it('retries on transient 5xx errors with exponential backoff and succeeds on recovery', async () => {
      let attempts = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('Internal Server Error', { status: 500, headers: new Headers() });
        }
        return new Response(JSON.stringify({ result: 'ok' }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
        });
      });

      const client = new EsiClient(
        { baseUrl: 'https://esi.evetech.net', maxRetries: 2, baseBackoffMs: 5 },
        esiCache,
        esiRateLimiter,
        mockFetch
      );

      const res = await client.get<{ result: string }>('/test-5xx');
      expect(res.data.result).toBe('ok');
      expect(attempts).toBe(2);
    });

    it('respects 304 Not Modified without duplicating data or creating redundant events', async () => {
      let networkCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        networkCalls++;
        const headers = (init?.headers || {}) as Record<string, string>;
        if (headers['If-None-Match'] === '"etag-v1"') {
          return new Response(null, {
            status: 304,
            headers: new Headers({
              etag: '"etag-v1"',
              expires: new Date(Date.now() + 60000).toUTCString(),
            }),
          });
        }
        return new Response(JSON.stringify([{ order_id: 123, type_id: 34 }]), {
          status: 200,
          headers: new Headers({
            etag: '"etag-v1"',
            expires: new Date(Date.now() - 1000).toUTCString(), // Stale immediately
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

      // Call 1: 200 OK -> saves in cache
      const res1 = await client.get<RawEsiOrder[]>('/orders');
      expect(res1.meta.status).toBe(200);
      expect(networkCalls).toBe(1);

      // Call 2: Sends If-None-Match -> 304 Not Modified -> returns cached data
      const res2 = await client.get<RawEsiOrder[]>('/orders');
      expect(res2.meta.status).toBe(304);
      expect(res2.meta.fromCache).toBe(true);
      expect(res2.data).toHaveLength(1);
      expect(networkCalls).toBe(2);
    });
  });

  describe('3. Idempotence & Absence of Double Counting', () => {
    it('re-synchronizing identical transactions multiple times produces identical ledger metrics and no duplicate records', async () => {
      const mockTransactions: RawEsiTransaction[] = [
        {
          transaction_id: 501,
          date: '2026-09-20T10:00:00Z',
          type_id: 34,
          quantity: 1000,
          unit_price: 5.0,
          is_buy: true,
          is_personal: true,
          journal_ref_id: 901,
          location_id: 60003760,
          client_id: 1,
        },
        {
          transaction_id: 502,
          date: '2026-09-21T10:00:00Z',
          type_id: 34,
          quantity: 500,
          unit_price: 8.0,
          is_buy: false,
          is_personal: true,
          journal_ref_id: 902,
          location_id: 60003760,
          client_id: 2,
        },
      ];

      const mockJournal: RawEsiJournalEntry[] = [
        {
          id: 901,
          date: '2026-09-20T10:00:00Z',
          ref_type: 'market_transaction',
          amount: -5000,
          balance: 10000000,
          description: 'Buy order',
        },
        {
          id: 902,
          date: '2026-09-21T10:00:00Z',
          ref_type: 'market_transaction',
          amount: 4000,
          balance: 10004000,
          description: 'Sell order',
        },
        {
          id: 903,
          date: '2026-09-21T10:00:00Z',
          ref_type: 'transaction_tax',
          amount: -144, // 3.6% sales tax on 4000 ISK
          tax: 144,
          balance: 10003856,
          context_id: 502,
          description: 'Sales tax',
        },
      ];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/wallet/transactions/')) {
          return { data: mockTransactions, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallet/journal/')) {
          return { data: mockJournal, meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      // Run Sync 1
      const sync1 = await syncService.syncWalletTransactions(1001, 'token');
      await syncService.syncWalletJournal(1001, 'token');
      expect(sync1.newItemsPersisted).toBe(2);

      const summary1 = ledgerRepo.getSummary(1001);
      expect(summary1.totalTransactionsCount).toBe(2);
      expect(summary1.totalGrossSalesIsk).toBe(4000);
      expect(summary1.totalBuySpendIsk).toBe(5000);
      expect(summary1.totalTaxesIsk).toBe(144);
      expect(summary1.totalNetSalesIsk).toBe(3856);

      // Run Sync 2 (Exact duplicate replay)
      const sync2 = await syncService.syncWalletTransactions(1001, 'token');
      await syncService.syncWalletJournal(1001, 'token');
      expect(sync2.newItemsPersisted).toBe(0);

      const summary2 = ledgerRepo.getSummary(1001);
      // Metrics must remain strictly identical
      expect(summary2.totalTransactionsCount).toBe(2);
      expect(summary2.totalGrossSalesIsk).toBe(4000);
      expect(summary2.totalBuySpendIsk).toBe(5000);
      expect(summary2.totalTaxesIsk).toBe(144);
      expect(summary2.totalNetSalesIsk).toBe(3856);
    });

    it('running FIFO auto-reconciliation repeatedly is idempotent and never creates duplicate allocations or over-allocations', () => {
      // Seed Buy (1000 units @ 5.0 ISK) and Sell (400 units @ 8.0 ISK)
      ledgerRepo.saveTransactions([
        {
          id: '1001:1',
          characterId: 1001,
          transactionId: 1,
          date: '2026-09-01T10:00:00Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 1000,
          unitPrice: 5.0,
          totalValue: 5000,
          isBuy: true,
          isPersonal: true,
          journalRefId: 10,
          locationId: 60003760,
          clientId: 1,
          source: 'test',
          observedAt: Date.now(),
        },
        {
          id: '1001:2',
          characterId: 1001,
          transactionId: 2,
          date: '2026-09-02T10:00:00Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 400,
          unitPrice: 8.0,
          totalValue: 3200,
          isBuy: false,
          isPersonal: true,
          journalRefId: 11,
          locationId: 60003760,
          clientId: 2,
          source: 'test',
          observedAt: Date.now(),
        },
      ]);

      // Run FIFO Pass 1
      const res1 = roiService.autoReconcileFifo({ characterId: 1001 });
      expect(res1.allocations_created).toBe(1);
      expect(res1.total_quantity_reconciled).toBe(400);

      const allocations1 = roiService.listAllocations(1001);
      expect(allocations1).toHaveLength(1);
      expect(allocations1[0].quantity_allocated).toBe(400);
      expect(allocations1[0].allocated_buy_cost).toBe(2000);

      const unsold1 = roiService.getUnsoldInventory(1001);
      expect(unsold1).toHaveLength(1);
      expect(unsold1[0].remaining_quantity).toBe(600);
      expect(unsold1[0].tied_capital_isk).toBe(3000);

      // Run FIFO Pass 2 (Re-run on same or desynced state)
      const res2 = roiService.autoReconcileFifo({ characterId: 1001 });
      expect(res2.allocations_created).toBe(1);
      expect(res2.total_quantity_reconciled).toBe(400);

      const allocations2 = roiService.listAllocations(1001);
      // No duplicate allocations!
      expect(allocations2).toHaveLength(1);
      expect(allocations2[0].quantity_allocated).toBe(400);

      const unsold2 = roiService.getUnsoldInventory(1001);
      expect(unsold2[0].remaining_quantity).toBe(600);
      expect(unsold2[0].tied_capital_isk).toBe(3000);
    });

    it('combines manual allocations and automatic FIFO without double-counting quantities or fees', () => {
      // Buy: 1000 units
      // Sell: 800 units
      ledgerRepo.saveTransactions([
        {
          id: '1001:1',
          characterId: 1001,
          transactionId: 1,
          date: '2026-09-01T10:00:00Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 1000,
          unitPrice: 5.0,
          totalValue: 5000,
          isBuy: true,
          isPersonal: true,
          journalRefId: 10,
          locationId: 60003760,
          clientId: 1,
          source: 'test',
          observedAt: Date.now(),
        },
        {
          id: '1001:2',
          characterId: 1001,
          transactionId: 2,
          date: '2026-09-02T10:00:00Z',
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 800,
          unitPrice: 8.0,
          totalValue: 6400,
          isBuy: false,
          isPersonal: true,
          journalRefId: 11,
          locationId: 60003760,
          clientId: 2,
          source: 'test',
          observedAt: Date.now(),
        },
      ]);

      // Step 1: Manually allocate 300 units
      const manualResult = roiService.createExplicitAllocation({
        character_id: 1001,
        sell_transaction_id: 2,
        buy_transaction_id: 1,
        quantity_to_allocate: 300,
      });
      expect(manualResult.success).toBe(true);

      // Step 2: Run FIFO automatic reconciliation
      const autoResult = roiService.autoReconcileFifo({ characterId: 1001 });
      // FIFO must allocate ONLY the remaining 500 units needed for the sell transaction
      expect(autoResult.allocations_created).toBe(1);
      expect(autoResult.total_quantity_reconciled).toBe(500);

      const allAllocations = roiService.listAllocations(1001);
      expect(allAllocations).toHaveLength(2);

      const totalAllocatedQty = allAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      expect(totalAllocatedQty).toBe(800); // 300 manual + 500 auto = 800 (exactly matches sell tx quantity)

      const unsold = roiService.getUnsoldInventory(1001);
      expect(unsold[0].remaining_quantity).toBe(200); // 1000 - 800 = 200
      expect(unsold[0].tied_capital_isk).toBe(1000); // 200 * 5.0 ISK
    });
  });

  describe('4. Order Lifecycle & Snapshot Desynchronization Recovery', () => {
    it('marks active orders missing from current active snapshot as DISAPPEARED_UNCONFIRMED without falsely declaring COMPLETED', async () => {
      // Step 1: Character has active order
      const initialOrder: RawEsiOrder = {
        order_id: 8888,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        is_buy_order: false,
        price: 5.5,
        volume_total: 1000,
        volume_remain: 1000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      };

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/orders/history/')) {
          return { data: [], meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 } } as never;
        }
        if (path.includes('/orders/')) {
          return { data: [initialOrder], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      await syncService.syncCharacterOrders(1001, 'dummy-token');
      let orders = ordersRepo.getOrdersForCharacter(1001);
      expect(orders).toHaveLength(1);
      expect(orders[0].state).toBe('ACTIVE');

      // Step 2: Next snapshot active list is empty, and historical list is also empty (e.g. transient ESI lag or desync)
      vi.spyOn(esiClient, 'get').mockImplementation(async () => {
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 } };
      });

      await syncService.syncCharacterOrders(1001, 'dummy-token');
      orders = ordersRepo.getOrdersForCharacter(1001);
      expect(orders).toHaveLength(1);
      // Must be DISAPPEARED_UNCONFIRMED, never COMPLETED_CONFIRMED without evidence
      expect(orders[0].state).toBe('DISAPPEARED_UNCONFIRMED');
      expect(orders[0].stateJustification).toContain('Ordre disparu du snapshot actif');

      // Step 3: Historical sync later confirms the order was completed
      const completedHistoryOrder: RawEsiOrder = {
        order_id: 8888,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        is_buy_order: false,
        price: 5.5,
        volume_total: 1000,
        volume_remain: 0,
        state: 'expired',
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      };

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/orders/history/')) {
          return { data: [completedHistoryOrder], meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      await syncService.syncCharacterOrders(1001, 'dummy-token');
      orders = ordersRepo.getOrdersForCharacter(1001);
      expect(orders[0].state).toBe('COMPLETED_CONFIRMED');
      expect(orders[0].volumeFilled).toBe(1000);
      expect(orders[0].volumeRemain).toBe(0);
    });

    it('skips corporation endpoints for NPC starter corporations without throwing errors', async () => {
      // NPC corp ID 1000044
      const getSpy = vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path === '/characters/1001/') {
          return { data: { corporation_id: 1000044 }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
      });

      await expect(syncService.syncCorporationWallets(1001, 'dummy-token')).resolves.not.toThrow();
      // Should not call /corporations/1000044/wallets/
      expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('/corporations/1000044/wallets/'), expect.anything());
    });

    it('halts corporation division calls when 403 Forbidden is returned and remembers inaccessible status', async () => {
      // Player corp ID 98830882
      let walletCalls = 0;
      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path === '/characters/1001/') {
          return { data: { corporation_id: 98830882 }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/corporations/98830882/wallets/')) {
          walletCalls++;
          throw new EsiHttpError(403, 'Forbidden', { status: 403, fromCache: false, fetchedAt: Date.now() });
        }
        return { data: [], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
      });

      await syncService.syncCorporationWallets(1001, 'dummy-token');
      expect(walletCalls).toBe(1); // Did not attempt division 1 or retry

      // Subsequent call should skip immediately
      await syncService.syncCorporationWallets(1001, 'dummy-token');
      expect(walletCalls).toBe(1);
    });
  });
});
