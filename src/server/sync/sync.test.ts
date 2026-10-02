import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from './service.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemorySyncRepository } from './repository.ts';
import { UniverseService } from '../universe/service.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import { WalletRepository } from '../ledger/walletRepository.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

describe('Sync Module (Sales Ledger & Orders Synchronization)', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let syncRepo: InMemorySyncRepository;
  let universeService: UniverseService;
  let walletRepo: WalletRepository;
  let esiClient: EsiClient;
  let syncService: SyncService;

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ordersRepo = new InMemoryOrdersRepository();
    syncRepo = new InMemorySyncRepository();
    walletRepo = new WalletRepository(null as unknown as IDatabaseAdapter);
    const cache = new EsiCache();
    const rateLimiter = new EsiRateLimiter();

    esiClient = new EsiClient(
      {
        baseUrl: 'https://esi.evetech.net/latest',
        userAgent: 'test-agent',
        timeoutMs: 5000,
        maxRetries: 1,
        baseBackoffMs: 10,
        concurrencyLimit: 2,
      },
      cache,
      rateLimiter
    );

    universeService = new UniverseService(esiClient);
    syncService = new SyncService(
      esiClient,
      ledgerRepo,
      ordersRepo,
      syncRepo,
      universeService,
      undefined,
      undefined,
      walletRepo
    );
  });

  it('synchronizes wallet transactions with from_id pagination and persists them', async () => {
    const mockTxBatch1 = [
      {
        transaction_id: 1003,
        date: '2026-09-22T12:00:00Z',
        type_id: 34,
        quantity: 100,
        unit_price: 5.0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 801,
        location_id: 60003760,
        client_id: 9991,
      },
      {
        transaction_id: 1002,
        date: '2026-09-22T11:00:00Z',
        type_id: 35,
        quantity: 200,
        unit_price: 12.0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 802,
        location_id: 60003760,
        client_id: 9992,
      },
    ];

    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/wallet/transactions/')) {
        return {
          data: mockTxBatch1 as unknown as typeof mockTxBatch1,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        } as never;
      }
      return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
    });

    const result = await syncService.syncWalletTransactions(1001, 'dummy-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.itemsFetched).toBe(2);
    expect(result.newItemsPersisted).toBe(2);
    expect(result.totalPersisted).toBe(2);

    const saved = ledgerRepo.getTransactions({ characterId: 1001 });
    expect(saved.items).toHaveLength(2);
    expect(saved.items[0].typeName).toBe('Tritanium');
    expect(saved.items[0].locationName).toBe('Jita IV - Moon 4 - Caldari Navy Assembly Plant');

    const status = syncRepo.getSyncState(1001, 'wallet_transactions');
    expect(status.status).toBe('COMPLETE');
    expect(status.totalRecords).toBe(2);
  });

  it('handles partial pagination when ESI fails on subsequent requests without losing existing data', async () => {
    ledgerRepo.saveTransactions([
      {
        id: '1001:500',
        characterId: 1001,
        transactionId: 500,
        date: '2026-09-01T00:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 50,
        unitPrice: 5.0,
        totalValue: 250,
        isBuy: false,
        isPersonal: true,
        journalRefId: 1,
        locationId: 60003760,
        clientId: 1,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    vi.spyOn(esiClient, 'get').mockRejectedValue(new Error('Gateway timeout'));

    const result = await syncService.syncWalletTransactions(1001, 'dummy-token');

    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('Gateway timeout');
    expect(ledgerRepo.countTransactions(1001)).toBe(1);

    const state = syncRepo.getSyncState(1001, 'wallet_transactions');
    expect(state.status).toBe('ERROR');
    expect(state.errorMessage).toContain('Gateway timeout');
  });

  it('synchronizes wallet journal and stores fee entries', async () => {
    const mockJournal = [
      {
        id: 7001,
        date: '2026-09-22T12:00:00Z',
        ref_type: 'market_transaction',
        amount: 500000,
        balance: 10000000,
        context_id: 1003,
        context_id_type: 'market_transaction_id',
        description: 'Market transaction sale',
        tax: 18000,
        tax_receiver_id: 1000127,
      },
      {
        id: 7002,
        date: '2026-09-22T11:00:00Z',
        ref_type: 'brokers_fee',
        amount: -15000,
        balance: 9500000,
        description: 'Brokers fee for market order',
      },
    ];

    vi.spyOn(esiClient, 'get').mockResolvedValue({
      data: mockJournal as unknown as typeof mockJournal,
      meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
    } as never);

    const result = await syncService.syncWalletJournal(1001, 'dummy-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.itemsFetched).toBe(2);
    expect(result.newItemsPersisted).toBe(2);

    const journal = ledgerRepo.getJournalEntries(1001);
    expect(journal.items).toHaveLength(2);
    expect(journal.items[0].refType).toBe('market_transaction');
  });

  it('synchronizes active character orders and evaluates lifecycle states', async () => {
    const mockOrders = [
      {
        order_id: 9001,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        is_buy_order: false,
        price: 5.5,
        volume_total: 10000,
        volume_remain: 10000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      },
    ];

    vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/orders/history/')) {
        return {
          data: [] as never,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
        } as never;
      }
      if (path.includes('/orders/')) {
        return {
          data: mockOrders as unknown as typeof mockOrders,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        } as never;
      }
      return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
    });

    const result = await syncService.syncCharacterOrders(1001, 'dummy-token');

    expect(result.status).toBe('COMPLETE');
    expect(result.itemsFetched).toBe(1);

    const savedOrders = ordersRepo.getOrdersForCharacter(1001);
    expect(savedOrders).toHaveLength(1);
    expect(savedOrders[0].orderId).toBe(9001);
    expect(savedOrders[0].state).toBe('ACTIVE');
    expect(savedOrders[0].typeName).toBe('Tritanium');
  });

  describe('Phase 10.bis Real Wallets & Corporation Divisions Sync', () => {
    it('synchronizes real character wallet balance via GET /characters/{id}/wallet and stores snapshot', async () => {
      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/wallet/')) {
          return { data: 12_345_678_900.5, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCharacterWallet(1001, 'dummy-token');
      expect(result.status).toBe('COMPLETE');
      expect(result.itemsFetched).toBe(1);

      const snap = walletRepo.getCharacterWallet(1001);
      expect(snap).toBeDefined();
      expect(snap?.balance).toBe(12_345_678_900.5);
      expect(snap?.type).toBe('CHARACTER');
      expect(snap?.source).toBe('/characters/1001/wallet/');
    });

    it('synchronizes corporation divisions with real balances, names, and tags journal entries', async () => {
      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path === '/characters/1001/') {
          return { data: { corporation_id: 98000001 }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path === '/corporations/98000001/wallets/') {
          return {
            data: [
              { division: 1, balance: 25_000_000_000 },
              { division: 2, balance: 5_000_000_000 },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        if (path === '/corporations/98000001/divisions/') {
          return {
            data: {
              wallet: [
                { division: 1, name: 'Trésorerie Centrale' },
                { division: 2, name: 'Trading Hub Jita' },
              ],
            },
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        if (path.includes('/journal/')) {
          return {
            data: [
              {
                id: 88801,
                date: '2026-09-20T12:00:00Z',
                ref_type: 'transaction_tax',
                amount: -150000,
                balance: 24_999_850_000,
                description: 'Taxe CCP',
              },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      await syncService.syncCorporationWallets(1001, 'dummy-token');

      const corpWallets = walletRepo.getCorporationWallets(98000001);
      expect(corpWallets).toHaveLength(2);

      const div1 = corpWallets.find((w) => w.division === 1);
      expect(div1?.divisionName).toBe('Trésorerie Centrale');
      expect(div1?.balance).toBe(25_000_000_000);

      const div2 = corpWallets.find((w) => w.division === 2);
      expect(div2?.divisionName).toBe('Trading Hub Jita');
      expect(div2?.balance).toBe(5_000_000_000);

      // Verify that journal entries are saved with isCorporationWallet: true and corporationId
      const { items: journalItems } = ledgerRepo.getJournalEntries(1001);
      expect(journalItems.length).toBeGreaterThan(0);
      const corpJn = journalItems.find((j) => j.journalId === 88801);
      expect(corpJn?.isCorporationWallet).toBe(true);
      expect(corpJn?.corporationId).toBe(98000001);
      expect(corpJn?.division).toBe(1);
    });

    it('skips corporation wallet synchronization when walletSyncMode is CHARACTERS_ONLY', async () => {
      const getSpy = vi.spyOn(esiClient, 'get');
      await syncService.syncCorporationWallets(1001, 'dummy-token', undefined, {
        walletSyncMode: 'CHARACTERS_ONLY',
      });

      expect(getSpy).not.toHaveBeenCalled();
      expect(walletRepo.getCorporationWallets()).toHaveLength(0);
    });
  });

  describe('Phase F01 — Orders Completeness Qualification & Resilient syncAll', () => {
    it('qualifies order sync as PARTIAL and records reason when historical orders fetch fails (S0-4 fix)', async () => {
      const mockActiveOrders = [
        {
          order_id: 9001,
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
        },
      ];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/orders/history/')) {
          throw new Error('504 Gateway Timeout on historical orders');
        }
        if (path.includes('/orders/')) {
          return {
            data: mockActiveOrders as unknown as typeof mockActiveOrders,
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCharacterOrders(1001, 'dummy-token');

      // Must be PARTIAL, not falsely COMPLETE!
      expect(result.status).toBe('PARTIAL');
      expect(result.coverageStatus).toBe('PARTIAL');
      expect(result.hasMore).toBe(true);
      expect(result.error).toContain('504 Gateway Timeout');

      const savedState = await syncRepo.getSyncStateAsync(1001, 'character_orders');
      expect(savedState.status).toBe('PARTIAL');
      expect(savedState.coverageStatus).toBe('PARTIAL');
      expect(savedState.errorMessage).toContain('504 Gateway Timeout');
    });

    it('syncAll resiliently handles partial failures and returns corporation resources without rejecting (S1-4 fix)', async () => {
      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/wallet/transactions/')) {
          throw new Error('Transactions connection failed');
        }
        if (path.includes('/characters/1001/wallet/')) {
          return { data: 5000000, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [], meta: { status: 200, fromCache: false, fetchedAt: Date.now(), pages: 1 } } as never;
      });

      const allRes = await syncService.syncAll(1001, 'dummy-token');

      // The 4 other endpoints and corp endpoints should not be aborted by the 1 failure
      expect(allRes.transactions.status).toBe('ERROR');
      expect(allRes.transactions.error).toContain('Transactions connection failed');
      expect(allRes.journal.status).toBe('COMPLETE');
      expect(allRes.orders.status).toBe('COMPLETE');
      expect(allRes.assets.status).toBe('COMPLETE');
      expect(allRes.wallet?.status).toBe('COMPLETE');
      expect(allRes.wallet?.itemsFetched).toBe(1);
    });
  });

  describe('Phase F02 — Storage Integrity, Strict Wallet Validation & 5-Streams Freshness', () => {
    it('rejects invalid or non-numeric wallet balances (null, undefined, string, object) with ERROR without persisting 0 ISK (S0-5 fix)', async () => {
      const invalidPayloads: unknown[] = [null, undefined, 'not-a-number', {}, [], '   '];

      for (const invalidData of invalidPayloads) {
        // Clear snapshots before each try
        walletRepo.clearCharacterData(1001);

        vi.spyOn(esiClient, 'get').mockResolvedValueOnce({
          data: invalidData,
          meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
        } as never);

        const result = await syncService.syncCharacterWallet(1001, 'dummy-token');

        expect(result.status).toBe('ERROR');
        expect(result.coverageStatus).toBe('ERROR');
        expect(result.error).toMatch(/Invalid wallet balance/i);

        // Crucial: no snapshot at 0 ISK must be inserted!
        const snapshot = walletRepo.getCharacterWallet(1001);
        expect(snapshot).toBeNull();

        const state = syncRepo.getSyncState(1001, 'character_wallet');
        expect(state.status).toBe('ERROR');
        expect(state.totalRecords).toBe(0);
      }
    });

    it('evaluates getFullStatus across all 5 streams and detects stale assets or error states (S2-2 fix)', () => {
      const now = Date.now();

      // Seed all 5 streams for character 2001
      syncRepo.updateSyncState(2001, 'wallet_transactions', {
        status: 'COMPLETE',
        totalRecords: 10,
        lastSyncCompletedAt: now - 2 * 60 * 1000, // 2 mins ago (fresh < 10m)
      });
      syncRepo.updateSyncState(2001, 'wallet_journal', {
        status: 'COMPLETE',
        totalRecords: 10,
        lastSyncCompletedAt: now - 2 * 60 * 1000,
      });
      syncRepo.updateSyncState(2001, 'character_orders', {
        status: 'COMPLETE',
        totalRecords: 5,
        lastSyncCompletedAt: now - 3 * 60 * 1000, // 3 mins ago (fresh < 10m)
      });
      syncRepo.updateSyncState(2001, 'character_wallet', {
        status: 'COMPLETE',
        totalRecords: 1,
        lastSyncCompletedAt: now - 1 * 60 * 1000, // 1 min ago (fresh < 10m)
      });
      syncRepo.updateSyncState(2001, 'character_assets', {
        status: 'COMPLETE',
        totalRecords: 50,
        lastSyncCompletedAt: now - 30 * 60 * 1000, // 30 mins ago (fresh < 60m)
      });

      // 1. All 5 are fresh
      const status1 = syncRepo.getFullStatus(2001);
      expect(status1.freshness).toBe('FRESH');
      expect(status1.assets).toBeDefined();
      expect(status1.wallet).toBeDefined();
      expect(status1.transactions.status).toBe('COMPLETE');

      // 2. If assets are 65 mins old (> 60m TTL), overall freshness must be STALE even if orders/txs are fresh!
      syncRepo.updateSyncState(2001, 'character_assets', {
        status: 'COMPLETE',
        totalRecords: 50,
        lastSyncCompletedAt: now - 65 * 60 * 1000, // 65 mins ago (stale > 60m)
      });
      const status2 = syncRepo.getFullStatus(2001);
      expect(status2.freshness).toBe('STALE');

      // 3. If wallet is in ERROR, overall freshness must be PARTIAL
      syncRepo.updateSyncState(2001, 'character_wallet', {
        status: 'ERROR',
        totalRecords: 0,
        errorMessage: 'Invalid wallet balance',
      });
      const status3 = syncRepo.getFullStatus(2001);
      expect(status3.freshness).toBe('PARTIAL');
    });
  });

  describe('Phase F05 — Corporation Journal Completeness & Division Pagination (TEST-F05-01 to TEST-F05-07)', () => {
    function generateMockJournalEntries(startId: number, count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        date: '2026-09-30T12:00:00Z',
        ref_type: 'transaction_tax',
        amount: -100000.0,
        balance: 500000000.0,
        description: `Transaction tax for market sale #${startId + i}`,
        first_party_id: 1001,
        second_party_id: 1000132,
        tax: 100000.0,
        tax_receiver_id: 1000132,
        context_id: 2000000 + startId + i,
        context_id_type: 'market_transaction_id',
      }));
    }

    it('TEST-F05-01: Division with 1 single page of journal (50 entries) completes and persists entries without truncation', async () => {
      const corpId = 9800001;
      const entries50 = generateMockJournalEntries(1000, 50);

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/journal/')) {
          return { data: entries50, meta: { status: 200, pages: 1, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [{ division: 1, name: 'Main Treasury' }] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return { data: [{ division: 1, balance: 500000000 }], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token');

      expect(result.status).toBe('COMPLETE');
      expect(result.coverageStatus).toBe('COMPLETE');
      expect(result.hasMore).toBe(false);
      expect(result.divisionStatuses?.[1]).toBeDefined();
      expect(result.divisionStatuses?.[1].status).toBe('COMPLETE');
      expect(result.divisionStatuses?.[1].lastPage).toBe(1);
      expect(result.divisionStatuses?.[1].hasMore).toBe(false);
      expect(result.divisionStatuses?.[1].totalFetched).toBe(50);

      const persisted = ledgerRepo.getJournalEntries(1001, 1, 100);
      expect(persisted.total).toBe(50);
    });

    it('TEST-F05-02: Division with 5 pages of journal (250 entries) fetches all pages without hardcoded maxPages=3 truncation', async () => {
      const corpId = 9800001;
      const pagesRequested: number[] = [];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/journal/')) {
          const page = Number(options?.params?.page || 1);
          pagesRequested.push(page);
          const entries = generateMockJournalEntries(page * 1000, 50);
          return { data: entries, meta: { status: 200, pages: 5, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [{ division: 1, name: 'Main Treasury' }] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return { data: [{ division: 1, balance: 500000000 }], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token');

      expect(pagesRequested).toEqual([1, 2, 3, 4, 5]);
      expect(result.status).toBe('COMPLETE');
      expect(result.coverageStatus).toBe('COMPLETE');
      expect(result.hasMore).toBe(false);
      expect(result.divisionStatuses?.[1].status).toBe('COMPLETE');
      expect(result.divisionStatuses?.[1].lastPage).toBe(5);
      expect(result.divisionStatuses?.[1].totalFetched).toBe(250);

      const persisted = ledgerRepo.getJournalEntries(1001, 1, 300);
      expect(persisted.total).toBe(250);
    });

    it('TEST-F05-03: Division with pagination interrupted halfway (maxPages: 2 on 5) returns PARTIAL with hasMore=true', async () => {
      const corpId = 9800001;
      const pagesRequested: number[] = [];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/journal/')) {
          const page = Number(options?.params?.page || 1);
          pagesRequested.push(page);
          const entries = generateMockJournalEntries(page * 1000, 50);
          return { data: entries, meta: { status: 200, pages: 5, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [{ division: 1, name: 'Main Treasury' }] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return { data: [{ division: 1, balance: 500000000 }], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token', undefined, { maxPages: 2 });

      expect(pagesRequested).toEqual([1, 2]);
      expect(result.status).toBe('PARTIAL');
      expect(result.coverageStatus).toBe('PARTIAL');
      expect(result.hasMore).toBe(true);
      expect(result.divisionStatuses?.[1].status).toBe('PARTIAL');
      expect(result.divisionStatuses?.[1].lastPage).toBe(2);
      expect(result.divisionStatuses?.[1].hasMore).toBe(true);
      expect(result.divisionStatuses?.[1].totalFetched).toBe(100);

      const persisted = ledgerRepo.getJournalEntries(1001, 1, 300);
      expect(persisted.total).toBe(100);
    });

    it('TEST-F05-04: Resume synchronization (resume: true) starts from page 3 through 5 and completes', async () => {
      const corpId = 9800001;

      // Seed previous partial state (lastPage = 2, hasMore = true)
      await syncRepo.updateSyncStateAsync(1001, 'corporation_wallets', {
        status: 'PARTIAL',
        coverageStatus: 'PARTIAL',
        hasMore: true,
        divisionStatuses: {
          1: { status: 'PARTIAL', lastPage: 2, hasMore: true, totalFetched: 100 },
        },
      });

      const pagesRequested: number[] = [];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/journal/')) {
          const page = Number(options?.params?.page || 1);
          pagesRequested.push(page);
          const entries = generateMockJournalEntries(page * 1000, 50);
          return { data: entries, meta: { status: 200, pages: 5, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [{ division: 1, name: 'Main Treasury' }] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return { data: [{ division: 1, balance: 500000000 }], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token', undefined, { resume: true });

      expect(pagesRequested).toEqual([3, 4, 5]);
      expect(result.status).toBe('COMPLETE');
      expect(result.coverageStatus).toBe('COMPLETE');
      expect(result.hasMore).toBe(false);
      expect(result.divisionStatuses?.[1].status).toBe('COMPLETE');
      expect(result.divisionStatuses?.[1].lastPage).toBe(5);
      expect(result.divisionStatuses?.[1].hasMore).toBe(false);
    });

    it('TEST-F05-05: Division 3 failure (HTTP 500) produces overall PARTIAL status with detailed error without crashing', async () => {
      const corpId = 9800001;

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/1/journal/')) {
          return { data: generateMockJournalEntries(1000, 20), meta: { status: 200, pages: 1, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/2/journal/')) {
          return { data: generateMockJournalEntries(2000, 20), meta: { status: 200, pages: 1, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/3/journal/')) {
          throw new Error('500 Internal Server Error: division journal unavailable');
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return {
            data: [
              { division: 1, balance: 1000000 },
              { division: 2, balance: 2000000 },
              { division: 3, balance: 3000000 },
            ],
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token');

      expect(result.status).toBe('PARTIAL');
      expect(result.coverageStatus).toBe('PARTIAL');
      expect(result.hasMore).toBe(true);
      expect(result.divisionStatuses?.[1].status).toBe('COMPLETE');
      expect(result.divisionStatuses?.[2].status).toBe('COMPLETE');
      expect(result.divisionStatuses?.[3].status).toBe('ERROR');
      expect(result.divisionStatuses?.[3].error).toContain('500 Internal Server Error');
      expect(result.error).toContain('Division 3');

      const savedState = await syncRepo.getSyncStateAsync(1001, 'corporation_wallets');
      expect(savedState.status).toBe('PARTIAL');
      expect(savedState.divisionStatuses?.[3].status).toBe('ERROR');
    });

    it('TEST-F05-06: Integration - Complete synchronization of a corporation with all 7 divisions', async () => {
      const corpId = 9800001;

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return {
            data: {
              wallet: Array.from({ length: 7 }, (_, i) => ({ division: i + 1, name: `Division ${i + 1} Hangar` })),
            },
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        for (let div = 1; div <= 7; div++) {
          if (path.includes(`/wallets/${div}/journal/`)) {
            return {
              data: generateMockJournalEntries(div * 10000, 50),
              meta: { status: 200, pages: 1, fromCache: false, fetchedAt: Date.now() },
            } as never;
          }
        }
        if (path.includes('/wallets/')) {
          return {
            data: Array.from({ length: 7 }, (_, i) => ({ division: i + 1, balance: (i + 1) * 10000000 })),
            meta: { status: 200, fromCache: false, fetchedAt: Date.now() },
          } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token');

      expect(result.status).toBe('COMPLETE');
      expect(result.coverageStatus).toBe('COMPLETE');
      expect(result.hasMore).toBe(false);

      const corpWallets = walletRepo.getCorporationWallets(corpId);
      for (let div = 1; div <= 7; div++) {
        expect(result.divisionStatuses?.[div]?.status).toBe('COMPLETE');
        expect(result.divisionStatuses?.[div]?.totalFetched).toBe(50);
        const snap = corpWallets.find((w) => w.division === div);
        expect(snap).toBeDefined();
        expect(snap?.divisionName).toBe(`Division ${div} Hangar`);
      }

      const totalJournal = ledgerRepo.getJournalEntries(1001, 1, 500);
      expect(totalJournal.total).toBe(350);
    });

    it('TEST-F05-07: Non-regression - Character without corporation wallet roles (403 Forbidden) returns PARTIAL without infinite loop', async () => {
      const corpId = 9800001;

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes(`/corporations/${corpId}/wallets/`)) {
          throw new Error('403 Forbidden: Character lacks Accountant or Junior Accountant role');
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      const result = await syncService.syncCorporationWallets(1001, 'dummy-token');

      expect(result.status).toBe('PARTIAL');
      expect(result.coverageStatus).toBe('PARTIAL');
      expect(result.hasMore).toBe(false);
      expect(result.error).toContain('Lacks corporation wallet roles');

      // Next call should immediately return PARTIAL from inaccessibleCorpCharacters set
      const result2 = await syncService.syncCorporationWallets(1001, 'dummy-token');
      expect(result2.status).toBe('PARTIAL');
      expect(result2.coverageStatus).toBe('PARTIAL');
    });
  });

  describe('Phase F06 — Corporation Journal Deduplication Across Multi-Character ESI Sync (TEST-F06-05)', () => {
    it('TEST-F06-05: Simultaneous or successive ESI sync of 2 characters in the same corporation deduplicates journal entries perfectly', async () => {
      const corpId = 98000001;
      const mockCorpJournal = [
        {
          id: 55001,
          date: '2026-09-30T12:00:00Z',
          ref_type: 'transaction_tax',
          amount: -120000,
          balance: 100000000,
          description: 'Sales tax SCC',
          first_party_id: 1001,
          second_party_id: 1000132,
          tax: 120000,
          tax_receiver_id: 1000132,
          context_id: 888999,
          context_id_type: 'market_transaction_id',
        },
        {
          id: 55002,
          date: '2026-09-30T11:00:00Z',
          ref_type: 'brokers_fee',
          amount: -45000,
          balance: 100120000,
          description: 'Brokers fee',
        },
      ];

      vi.spyOn(esiClient, 'get').mockImplementation(async (path: string) => {
        if (path.includes('/characters/1001/') || path.includes('/characters/1002/')) {
          return { data: { corporation_id: corpId }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/divisions/')) {
          return { data: { wallet: [{ division: 1, name: 'Main' }] }, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/journal/')) {
          return { data: mockCorpJournal, meta: { status: 200, pages: 1, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        if (path.includes('/wallets/')) {
          return { data: [{ division: 1, balance: 100000000 }], meta: { status: 200, fromCache: false, fetchedAt: Date.now() } } as never;
        }
        return { data: [] as never, meta: { status: 200, fromCache: false, fetchedAt: Date.now() } };
      });

      // Character 1 syncs corporation wallets (2 journal entries + 1 division snapshot)
      const resChar1 = await syncService.syncCorporationWallets(1001, 'token-1001');
      expect(resChar1.status).toBe('COMPLETE');
      expect(resChar1.newItemsPersisted).toBe(3);

      // Character 2 syncs the same corporation wallets (0 new journal entries + 1 division snapshot)
      const resChar2 = await syncService.syncCorporationWallets(1002, 'token-1002');
      expect(resChar2.status).toBe('COMPLETE');
      expect(resChar2.newItemsPersisted).toBe(1);

      // Unique storage check: exactly 2 journal entries exist in total in the ledger
      const dump = ledgerRepo.dumpData();
      expect(dump.journalEntries).toHaveLength(2);
      expect(dump.journalEntries[0].id).toBe(`corp:${corpId}:1:55001`);
      expect(dump.journalEntries[1].id).toBe(`corp:${corpId}:1:55002`);

      // Both characters are recorded in audit trace
      expect(dump.journalEntries[0].observedByCharacterIds).toContain(1001);
      expect(dump.journalEntries[0].observedByCharacterIds).toContain(1002);

      // Summary across the whole multi-character account reflects exact single taxes & broker fees
      const summary = ledgerRepo.getSummary(undefined, [1001, 1002]);
      expect(summary.totalTaxesIsk).toBe(120000); // NOT 240,000 ISK
      expect(summary.totalBrokerFeesIsk).toBe(45000); // NOT 90,000 ISK
    });
  });
});
