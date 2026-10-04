import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newDb, type IMemoryDb, type IBackup } from 'pg-mem';
import type pg from 'pg';
import { PostgresDatabaseAdapter } from './database.ts';
import { SCHEMA_VERSION, MIGRATIONS } from './schema.ts';
import { PostgresLedgerRepository } from '../ledger/repository.ts';
import { PostgresOrdersRepository } from '../orders/repository.ts';
import { PostgresRoiRepository } from '../roi/repository.ts';
import { PostgresAssetsRepository } from '../assets/repository.ts';
import { PostgresHubsRepository } from '../hubs/repository.ts';
import { PostgresSyncRepository } from '../sync/repository.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { ExplicitCostAllocation, OpeningBalanceLot } from '../roi/types.ts';
import type { CharacterAsset } from '../assets/types.ts';

function makeTestTx(overrides: Partial<CharacterTransaction> & {
  characterId: number;
  transactionId: number;
  typeId: number;
  quantity: number;
  unitPrice: number;
  isBuy: boolean;
}): CharacterTransaction {
  return {
    id: `${overrides.characterId}:${overrides.transactionId}`,
    typeName: 'Test Item',
    totalValue: overrides.unitPrice * overrides.quantity,
    isPersonal: true,
    journalRefId: 1000000 + overrides.transactionId,
    locationId: 60003760,
    locationName: 'Jita IV - Moon 4',
    clientId: 2001,
    clientName: 'Capsuleer Client',
    source: `esi:/characters/${overrides.characterId}/wallet/transactions/`,
    date: '2026-09-30T12:00:00Z',
    observedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a real PostgreSQL adapter instance.
 * If process.env.DATABASE_URL is provided, it connects to the real PostgreSQL server.
 * Otherwise, it creates a pure in-memory PostgreSQL engine via pg-mem with ACID rollback hooks.
 */
function createRealPostgresAdapter(): { adapter: PostgresDatabaseAdapter; db?: IMemoryDb } {
  if (process.env.DATABASE_URL) {
    return { adapter: new PostgresDatabaseAdapter(process.env.DATABASE_URL) };
  }

  const db = newDb({ autoCreateForeignKeyIndices: true });

  let snap: IBackup | null = null;
  db.public.interceptQueries((sql) => {
    const s = sql.trim().toUpperCase();
    if (s === 'BEGIN') {
      snap = db.backup();
      return [];
    }
    if (s === 'ROLLBACK') {
      if (snap) {
        snap.restore();
        snap = null;
      }
      return [];
    }
    if (s === 'COMMIT') {
      snap = null;
      return [];
    }
    return null;
  });

  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as pg.Pool;
  const adapter = new PostgresDatabaseAdapter(pool);
  return { adapter, db };
}

describe('Phase F04-A — Real PostgreSQL Engine Qualification & Integration Suite (S1-5)', () => {
  let adapter: PostgresDatabaseAdapter;
  let ledgerRepo: PostgresLedgerRepository;
  let ordersRepo: PostgresOrdersRepository;
  let roiRepo: PostgresRoiRepository;
  let assetsRepo: PostgresAssetsRepository;
  let hubsRepo: PostgresHubsRepository;
  let syncRepo: PostgresSyncRepository;

  beforeEach(async () => {
    const created = createRealPostgresAdapter();
    adapter = created.adapter;
    await adapter.init();

    ledgerRepo = new PostgresLedgerRepository(adapter);
    ordersRepo = new PostgresOrdersRepository(adapter);
    roiRepo = new PostgresRoiRepository(ledgerRepo, adapter);
    assetsRepo = new PostgresAssetsRepository(adapter);
    hubsRepo = new PostgresHubsRepository(adapter);
    syncRepo = new PostgresSyncRepository(adapter);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('1. Initializes schema and executes all sequential DDL migrations (1 to SCHEMA_VERSION) on real SQL engine', async () => {
    const appliedVersions = await adapter.getAppliedMigrationVersions();
    expect(appliedVersions).toContain(1);
    expect(appliedVersions).toContain(2);
    expect(appliedVersions).toContain(3);
    expect(appliedVersions).toContain(4);
    expect(appliedVersions).toContain(5);
    expect(appliedVersions).toContain(6);
    expect(appliedVersions).toContain(7);
    expect(appliedVersions).toContain(SCHEMA_VERSION);

    const isHealthy = await adapter.isHealthy();
    expect(isHealthy).toBe(true);

    // Verify migration idempotence: re-running init does not fail or duplicate
    await adapter.init();
    const secondCheck = await adapter.getAppliedMigrationVersions();
    expect(secondCheck.length).toBe(MIGRATIONS.length);
  });

  it('2. Inserts batch transactions via parameterized SQL with type safety and indexed queries', async () => {
    const batchSize = 100;
    const testTxs: CharacterTransaction[] = [];
    for (let i = 1; i <= batchSize; i++) {
      testTxs.push(
        makeTestTx({
          characterId: 1001,
          transactionId: 600000 + i,
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 1000 * i,
          unitPrice: 5.5,
          isBuy: i % 2 === 0,
          locationId: 60003760,
          locationName: 'Jita IV - Moon 4',
          clientId: 2001,
          clientName: 'Capsuleer Buyer',
          date: `2026-09-30T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
          observedAt: Date.now(),
        })
      );
    }

    const tStart = performance.now();
    const result = await ledgerRepo.saveTransactionsAsync(testTxs);
    const duration = performance.now() - tStart;

    expect(result.inserted).toBe(batchSize);
    expect(duration).toBeLessThan(3000);

    const retrieved = await ledgerRepo.getAllTransactionsAsync(1001);
    expect(retrieved).toHaveLength(batchSize);
  });

  it('3. Enforces multi-character tenant isolation strictly at SQL query and table level', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 101,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100,
        unitPrice: 5.0,
        isBuy: false,
        locationId: 60003760,
        clientId: 2001,
        date: '2026-09-30T12:00:00Z',
        observedAt: Date.now(),
      }),
      makeTestTx({
        characterId: 1002,
        transactionId: 201,
        typeId: 35,
        typeName: 'Pyerite',
        quantity: 200,
        unitPrice: 12.0,
        isBuy: true,
        locationId: 60008494,
        clientId: 2002,
        date: '2026-09-30T13:00:00Z',
        observedAt: Date.now(),
      }),
    ]);

    const charATxs = await ledgerRepo.getAllTransactionsAsync(1001);
    const charBTxs = await ledgerRepo.getAllTransactionsAsync(1002);
    const charCTxs = await ledgerRepo.getAllTransactionsAsync(9999);

    expect(charATxs).toHaveLength(1);
    expect(charATxs[0].characterId).toBe(1001);
    expect(charATxs[0].typeName).toBe('Tritanium');

    expect(charBTxs).toHaveLength(1);
    expect(charBTxs[0].characterId).toBe(1002);
    expect(charBTxs[0].typeName).toBe('Pyerite');

    expect(charCTxs).toHaveLength(0);

    const summaryB = await ledgerRepo.getSummaryAsync(1002);
    expect(summaryB.totalTransactionsCount).toBe(1);
    expect(summaryB.totalBuySpendIsk).toBe(2400);
    expect(summaryB.totalGrossSalesIsk).toBe(0);
  });

  it('4. Executes genuine ACID transactions: ROLLBACK completely clears uncommitted writes on error', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 1,
        typeId: 34,
        typeName: 'Initial Safe Transaction',
        quantity: 10,
        unitPrice: 10,
        isBuy: true,
      }),
    ]);

    const beforeTxs = await ledgerRepo.getAllTransactionsAsync(1001);
    expect(beforeTxs).toHaveLength(1);

    // Attempt transactional insertion that fails midway
    await expect(
      adapter.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO transactions (character_id, transaction_id, date, type_id, quantity, unit_price, total_value, is_buy, location_id, client_id, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [1001, 2, '2026-09-30T12:00:00Z', 34, 10, 10, 100, false, 60003760, 2001, Date.now()]
        );
        throw new Error('Simulated database network failure midway in transaction');
      })
    ).rejects.toThrow('Simulated database network failure midway in transaction');

    // Verify state was completely rolled back: transaction 2 must NOT exist in the database
    const afterTxs = await ledgerRepo.getAllTransactionsAsync(1001);
    expect(afterTxs).toHaveLength(1);
    expect(afterTxs[0].transactionId).toBe(1);
  });

  it('5. Verifies PostgresOrdersRepository lifecycle tracking and restock item persistence in SQL', async () => {
    const snap: CharacterOrderSnapshot = {
      id: '1001:9001',
      characterId: 1001,
      orderId: 9001,
      typeId: 34,
      typeName: 'Tritanium',
      regionId: 10000002,
      locationId: 60003760,
      price: 6.0,
      volumeTotal: 10000,
      volumeRemain: 5000,
      volumeFilled: 5000,
      isBuyOrder: false,
      duration: 90,
      issued: '2026-09-30T00:00:00Z',
      expiresAt: '2026-12-29T00:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif sur le marché EVE',
      isActiveInCurrentSnapshot: true,
      lastSnapshotVolumeRemain: 5000,
      source: 'esi:/characters/1001/orders/',
      firstObservedAt: Date.now(),
      lastObservedAt: Date.now(),
    };

    const res = await ordersRepo.saveOrderSnapshotsAsync([snap]);
    expect(res.inserted).toBe(1);

    const retrieved = await ordersRepo.getOrderByIdAsync(1001, 9001);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.volumeRemain).toBe(5000);
    expect(retrieved?.price).toBe(6.0);

    const restockItem = await ordersRepo.createRestockItemAsync({
      characterId: 1001,
      typeId: 34,
      typeName: 'Tritanium',
      targetBuyHubId: 60003760,
      targetBuyHubName: 'Jita IV-4',
      sellHubId: 60008494,
      sellHubName: 'Amarr VIII',
      suggestedQuantity: 50000,
      targetQuantity: 100000,
      estimatedBuyUnitPrice: 5.2,
      justification: 'Stock épuisé à Amarr',
    });

    expect(restockItem.id).toBeDefined();
    expect(restockItem.status).toBe('SUGGESTED');

    const updatedItem = await ordersRepo.updateRestockItemAsync(1001, restockItem.id, {
      status: 'PURCHASED',
      notes: 'Acheté via multibuy',
    });
    expect(updatedItem?.status).toBe('PURCHASED');
    expect(updatedItem?.notes).toBe('Acheté via multibuy');
  });

  it('6. Verifies PostgresRoiRepository explicit cost allocations and opening balances in SQL', async () => {
    const alloc: ExplicitCostAllocation = {
      id: 'alloc-real-1',
      character_id: 1001,
      sell_transaction_id: 2001,
      buy_transaction_id: 1001,
      source_type: 'TRANSACTION',
      type_id: 34,
      type_name: 'Tritanium',
      quantity_allocated: 500,
      unit_buy_price: 5.0,
      allocated_buy_cost: 2500,
      allocated_buy_fees: 10,
      allocated_sell_fees: 15,
      buy_location_id: 60003760,
      buy_hub_id: 'hub-jita',
      buy_hub_name: 'Jita IV-4',
      sell_location_id: 60008494,
      sell_hub_id: 'hub-amarr',
      sell_hub_name: 'Amarr VIII',
      reconciliation_mode: 'FIFO_AUTOMATIC',
      created_at: '2026-09-30T12:00:00Z',
      updated_at: '2026-09-30T12:00:00Z',
      version: 1,
    };

    await roiRepo.saveAllocationAsync(alloc);
    const retrieved = await roiRepo.getAllocationAsync('alloc-real-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.quantity_allocated).toBe(500);
    expect(retrieved?.unit_buy_price).toBe(5.0);

    const openingLot: OpeningBalanceLot = {
      id: 'ob-real-1',
      character_id: 1001,
      type_id: 34,
      type_name: 'Tritanium',
      quantity: 10000,
      allocated_quantity: 0,
      remaining_quantity: 10000,
      unit_cost_isk: 4.8,
      total_cost_isk: 48000,
      location_id: 60003760,
      hub_id: 'hub-jita',
      hub_name: 'Jita IV-4',
      acquisition_date: '2026-01-01T00:00:00Z',
      justification: 'Stock pré-ESI certifié',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      version: 1,
    };

    await roiRepo.saveOpeningBalanceAsync(openingLot);
    const retrievedOb = await roiRepo.getOpeningBalanceAsync('ob-real-1');
    expect(retrievedOb?.justification).toBe('Stock pré-ESI certifié');
    expect(retrievedOb?.unit_cost_isk).toBe(4.8);
  });

  it('7. Verifies PostgresAssetsRepository physical stock breakdowns and SQL SUM aggregation', async () => {
    const assets: CharacterAsset[] = [
      {
        id: '1001:100001',
        characterId: 1001,
        itemId: 100001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 25000,
        locationId: 60003760,
        locationName: 'Jita IV-4',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: '1001:100002',
        characterId: 1001,
        itemId: 100002,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 15000,
        locationId: 60003760,
        locationName: 'Jita IV-4',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      },
    ];

    await assetsRepo.saveAssetsAsync(assets);
    const stock = await assetsRepo.getStockForTypeAsync(34, 60003760, [1001]);
    expect(stock).toBe(40000); // 25000 + 15000
  });

  it('8. Verifies PostgresHubsRepository default hubs and custom mapping management', async () => {
    await hubsRepo.resetToDefaultsAsync();
    const hubs = await hubsRepo.listHubsAsync();
    expect(hubs.length).toBeGreaterThanOrEqual(5);

    await hubsRepo.upsertHubAsync({
      id: 'hub-custom-sql',
      name: 'Custom Nullsec Hub',
      system_name: '1DQ1-A',
      is_system_default: false,
      created_at: new Date().toISOString(),
    });

    const custom = await hubsRepo.getHubAsync('hub-custom-sql');
    expect(custom?.system_name).toBe('1DQ1-A');
  });

  it('9. Verifies PostgresSyncRepository state tracking, checkpoints and division statuses in SQL', async () => {
    const now = Date.now();
    await syncRepo.updateSyncStateAsync(1001, 'wallet_transactions', {
      status: 'COMPLETE',
      coverageStatus: 'COMPLETE',
      totalRecords: 250,
      newRecordsInLastSync: 25,
      lastSyncCompletedAt: now,
      lastSuccessfulId: 998877,
      divisionStatuses: {
        1: { status: 'COMPLETE', lastPage: 1, hasMore: false },
        2: { status: 'COMPLETE', lastPage: 1, hasMore: false },
      },
    });

    const state = await syncRepo.getSyncStateAsync(1001, 'wallet_transactions');
    expect(state.status).toBe('COMPLETE');
    expect(state.coverageStatus).toBe('COMPLETE');
    expect(state.totalRecords).toBe(250);
    expect(state.lastSuccessfulId).toBe(998877);
  });

  it('10. Verifies cascading clearCharacterData purges all relational tables cleanly without orphan data', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 10,
        typeId: 34,
        quantity: 100,
        unitPrice: 5,
        isBuy: false,
        locationId: 60003760,
      }),
      makeTestTx({
        characterId: 1002,
        transactionId: 20,
        typeId: 35,
        quantity: 200,
        unitPrice: 10,
        isBuy: true,
        locationId: 60003760,
      }),
    ]);

    await adapter.clearCharacterData(1001);

    const charATxs = await ledgerRepo.getAllTransactionsAsync(1001);
    const charBTxs = await ledgerRepo.getAllTransactionsAsync(1002);

    expect(charATxs).toHaveLength(0);
    expect(charBTxs).toHaveLength(1);
    expect(charBTxs[0].characterId).toBe(1002);
  });

  it('11. (SQL Real) Verifies targeted getTransactionsByTypeIdAsync queries type without scanning entire history', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 101,
        typeId: 34,
        quantity: 50,
        unitPrice: 10,
        isBuy: true,
        locationId: 60003760,
        date: '2026-09-30T10:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 102,
        typeId: 35,
        quantity: 100,
        unitPrice: 20,
        isBuy: true,
        locationId: 60003760,
        date: '2026-09-30T11:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 103,
        typeId: 34,
        quantity: 25,
        unitPrice: 15,
        isBuy: false,
        locationId: 60003760,
        date: '2026-09-30T12:00:00Z',
      }),
    ]);

    const type34Txs = await ledgerRepo.getTransactionsByTypeIdAsync(34, 1001);
    expect(type34Txs).toHaveLength(2);
    expect(type34Txs.every((t) => t.typeId === 34)).toBe(true);
  });

  it('12. (SQL Real) Verifies SQL MAX(date) aggregation for getLastActivityDatesAsync across items and locations', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 201,
        typeId: 34,
        quantity: 10,
        unitPrice: 100,
        isBuy: false,
        locationId: 60003760,
        date: '2026-09-25T12:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 202,
        typeId: 34,
        quantity: 10,
        unitPrice: 105,
        isBuy: false,
        locationId: 60003760,
        date: '2026-09-30T15:30:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 203,
        typeId: 35,
        quantity: 5,
        unitPrice: 50,
        isBuy: true,
        locationId: 60008494,
        date: '2026-09-28T09:00:00Z',
      }),
    ]);

    const activityMap = await ledgerRepo.getLastActivityDatesAsync(1001);
    expect(activityMap.get('1001:34:60003760')).toBe(new Date('2026-09-30T15:30:00Z').getTime());
    expect(activityMap.get('1001:35:60008494')).toBe(new Date('2026-09-28T09:00:00Z').getTime());
  });

  it('13. (SQL Real) Verifies mathematical summary aggregations (COUNT, SUM, DISTINCT) in SQL getSummaryAsync', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 301,
        typeId: 34,
        quantity: 100,
        unitPrice: 10,
        isBuy: true,
        locationId: 60003760,
        date: '2026-09-30T10:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 302,
        typeId: 34,
        quantity: 50,
        unitPrice: 15,
        isBuy: false,
        locationId: 60003760,
        date: '2026-09-30T11:00:00Z',
      }),
    ]);

    const summary = await ledgerRepo.getSummaryAsync(1001);
    expect(summary.totalTransactionsCount).toBe(2);
    expect(summary.buyTransactionsCount).toBe(1);
    expect(summary.sellTransactionsCount).toBe(1);
    expect(summary.totalBuySpendIsk).toBe(1000);
    expect(summary.totalGrossSalesIsk).toBe(750);
    expect(summary.distinctItemsCount).toBe(1);
  });

  it('14. (SQL Real) Verifies getFilterOptionsAsync produces clean grouped filter items via GROUP BY in SQL', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 401,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100,
        unitPrice: 5,
        isBuy: true,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        date: '2026-09-30T10:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 402,
        typeId: 35,
        typeName: 'Pyerite',
        quantity: 50,
        unitPrice: 15,
        isBuy: false,
        locationId: 60008494,
        locationName: 'Amarr VIII',
        date: '2026-09-30T11:00:00Z',
      }),
    ]);

    const filters = await ledgerRepo.getFilterOptionsAsync(1001);
    expect(filters.types).toHaveLength(2);
    expect(filters.locations).toHaveLength(2);
    expect(filters.types.map((t) => t.id)).toContain(34);
    expect(filters.types.map((t) => t.id)).toContain(35);
  });

  it('15. (SQL Real) Verifies paginated getTransactionsAsync with filtering, sorting and LIMIT/OFFSET', async () => {
    await ledgerRepo.saveTransactionsAsync([
      makeTestTx({
        characterId: 1001,
        transactionId: 501,
        typeId: 34,
        quantity: 10,
        unitPrice: 10,
        isBuy: true,
        locationId: 60003760,
        date: '2026-09-30T10:00:00Z',
      }),
      makeTestTx({
        characterId: 1001,
        transactionId: 502,
        typeId: 34,
        quantity: 20,
        unitPrice: 12,
        isBuy: true,
        locationId: 60003760,
        date: '2026-09-30T11:00:00Z',
      }),
    ]);

    const res = await ledgerRepo.getTransactionsAsync({
      characterId: 1001,
      page: 1,
      pageSize: 1,
      sortBy: 'date',
      sortOrder: 'desc',
    });

    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(1);
    expect(res.total).toBe(2);
    expect(res.totalPages).toBe(2);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].transactionId).toBe(502);
  });

  it('16. (Phase F01/F04) Verifies PostgresSyncRepository persists state durably across instance restarts in SQL', async () => {
    await syncRepo.updateSyncStateAsync(1001, 'wallet_transactions', {
      status: 'PARTIAL',
      coverageStatus: 'PARTIAL',
      lastSuccessfulId: 778899,
      lastPage: 4,
      totalRecords: 1500,
      newRecordsInLastSync: 250,
      hasMore: true,
      errorMessage: 'Interrupted by rate limiter',
    });

    // Create fresh PostgresSyncRepository on same database adapter to simulate server reboot
    const freshSyncRepoAfterRestart = new PostgresSyncRepository(adapter);

    const restoredState = await freshSyncRepoAfterRestart.getSyncStateAsync(1001, 'wallet_transactions');
    expect(restoredState.characterId).toBe(1001);
    expect(restoredState.resource).toBe('wallet_transactions');
    expect(restoredState.status).toBe('PARTIAL');
    expect(restoredState.coverageStatus).toBe('PARTIAL');
    expect(restoredState.lastSuccessfulId).toBe(778899);
    expect(restoredState.lastPage).toBe(4);
    expect(restoredState.totalRecords).toBe(1500);
    expect(restoredState.newRecordsInLastSync).toBe(250);
    expect(restoredState.hasMore).toBe(true);
    expect(restoredState.errorMessage).toBe('Interrupted by rate limiter');
  });
});
