import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from './service.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemorySyncRepository } from './repository.ts';
import { UniverseService } from '../universe/service.ts';
import { EsiClient } from '../esi/client.ts';
import { EsiCache } from '../esi/cache.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';

describe('Sync Module (Sales Ledger & Orders Synchronization)', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let syncRepo: InMemorySyncRepository;
  let universeService: UniverseService;
  let esiClient: EsiClient;
  let syncService: SyncService;

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ordersRepo = new InMemoryOrdersRepository();
    syncRepo = new InMemorySyncRepository();
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
    syncService = new SyncService(esiClient, ledgerRepo, ordersRepo, syncRepo, universeService);
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
});
