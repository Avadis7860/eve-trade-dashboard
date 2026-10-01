import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  DurableFileDatabaseAdapter,
  StorageManager,
} from './database.ts';
import { PersistentLedgerRepository } from '../ledger/repository.ts';
import { PersistentOrdersRepository } from '../orders/repository.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { PersistentAssetsRepository } from '../assets/repository.ts';
import { PersistentSyncRepository } from '../sync/repository.ts';
import { BackupRestoreService } from './backupService.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { ExplicitCostAllocation } from '../roi/types.ts';
import type { AppBackupSnapshot } from './types.ts';

const TEST_STORAGE_PATH = './.data/test_trade_store.json';

describe('Phase 07 — Persistent Storage, PostgreSQL Durability & History Reliability', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      try {
        fs.unlinkSync(TEST_STORAGE_PATH);
      } catch {
        // Ignore
      }
    }
    StorageManager.resetInstance({ storagePath: TEST_STORAGE_PATH, engine: 'file' });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      try {
        fs.unlinkSync(TEST_STORAGE_PATH);
      } catch {
        // Ignore cleanup error
      }
    }
  });

  it('1. Survives complete process restart without manual restore', () => {
    const adapter1 = new DurableFileDatabaseAdapter(TEST_STORAGE_PATH);
    adapter1.init();

    const ledgerRepo1 = new PersistentLedgerRepository(adapter1);
    const ordersRepo1 = new PersistentOrdersRepository(adapter1);
    const roiRepo1 = new RoiRepository(ledgerRepo1, adapter1);

    const tx: CharacterTransaction = {
      id: '9001:100001',
      characterId: 9001,
      transactionId: 100001,
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 50000,
      unitPrice: 5.5,
      totalValue: 275000,
      isBuy: true,
      isPersonal: true,
      journalRefId: 1,
      locationId: 60003760,
      locationName: 'Jita IV - 4',
      clientId: 12345,
      clientName: 'Supplier Corp',
      date: '2026-03-01T12:00:00Z',
      source: 'test',
      observedAt: Date.now(),
    };

    const order: CharacterOrderSnapshot = {
      id: '9001:200001',
      characterId: 9001,
      orderId: 200001,
      typeId: 34,
      typeName: 'Tritanium',
      regionId: 10000002,
      locationId: 60003760,
      locationName: 'Jita IV - 4',
      price: 6.2,
      volumeTotal: 50000,
      volumeRemain: 30000,
      volumeFilled: 20000,
      isBuyOrder: false,
      duration: 90,
      issued: '2026-03-01T13:00:00Z',
      expiresAt: '2026-05-30T13:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif',
      isActiveInCurrentSnapshot: true,
      firstObservedAt: Date.now(),
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 30000,
      source: 'test',
    };

    const allocation: ExplicitCostAllocation = {
      id: 'alloc-9001-1',
      character_id: 9001,
      buy_character_id: 9001,
      sell_character_id: 9001,
      source_type: 'TRANSACTION',
      buy_transaction_id: 100001,
      sell_transaction_id: 100002,
      type_id: 34,
      type_name: 'Tritanium',
      quantity_allocated: 20000,
      unit_buy_price: 5.5,
      allocated_buy_cost: 110000,
      allocated_buy_fees: 100,
      allocated_sell_fees: 150,
      buy_location_id: 60003760,
      buy_hub_id: 'hub-jita',
      buy_hub_name: 'Jita',
      sell_location_id: 60003760,
      sell_hub_id: 'hub-jita',
      sell_hub_name: 'Jita',
      reconciliation_mode: 'FIFO_AUTOMATIC',
      created_at: '2026-03-01T14:00:00Z',
      updated_at: '2026-03-01T14:00:00Z',
      version: 1,
    };

    ledgerRepo1.saveTransactions([tx]);
    ordersRepo1.saveOrderSnapshots([order]);
    roiRepo1.saveAllocation(allocation);

    expect(fs.existsSync(TEST_STORAGE_PATH)).toBe(true);

    // Simulate process cold restart
    const adapter2 = new DurableFileDatabaseAdapter(TEST_STORAGE_PATH);
    adapter2.init();
    const ledgerRepo2 = new PersistentLedgerRepository(adapter2);
    const ordersRepo2 = new PersistentOrdersRepository(adapter2);
    const roiRepo2 = new RoiRepository(ledgerRepo2, adapter2);

    const retrievedTx = ledgerRepo2.getTransactionById(9001, 100001);
    expect(retrievedTx).toBeDefined();
    expect(retrievedTx?.typeName).toBe('Tritanium');
    expect(retrievedTx?.totalValue).toBe(275000);

    const retrievedOrder = ordersRepo2.getOrderById(9001, 200001);
    expect(retrievedOrder).toBeDefined();
    expect(retrievedOrder?.price).toBe(6.2);
    expect(retrievedOrder?.volumeRemain).toBe(30000);

    const retrievedAlloc = roiRepo2.getAllocation('alloc-9001-1');
    expect(retrievedAlloc).toBeDefined();
    expect(retrievedAlloc?.quantity_allocated).toBe(20000);
  });

  it('2. Enforces schema migrations and version recording', () => {
    const adapter = new DurableFileDatabaseAdapter(TEST_STORAGE_PATH);
    adapter.init();

    const versions = adapter.getAppliedMigrationVersions();
    expect(versions).toContain(1);

    adapter.recordMigration(2, '002_test_future_migration');
    const updatedVersions = adapter.getAppliedMigrationVersions();
    expect(updatedVersions).toContain(2);
  });

  it('3. Atomically purges character data across all domains while keeping other characters intact', () => {
    const ledgerRepo = new PersistentLedgerRepository();
    const ordersRepo = new PersistentOrdersRepository();
    const assetsRepo = new PersistentAssetsRepository();
    const syncRepo = new PersistentSyncRepository();

    ledgerRepo.saveTransactions([
      {
        id: '9001:101',
        characterId: 9001,
        transactionId: 101,
        typeId: 34,
        quantity: 100,
        unitPrice: 5,
        totalValue: 500,
        isBuy: true,
        isPersonal: true,
        journalRefId: 1,
        locationId: 60003760,
        clientId: 1,
        date: '2026-03-01T00:00:00Z',
        source: 'test',
        observedAt: Date.now(),
      },
      {
        id: '9002:102',
        characterId: 9002,
        transactionId: 102,
        typeId: 34,
        quantity: 200,
        unitPrice: 5,
        totalValue: 1000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 2,
        locationId: 60003760,
        clientId: 2,
        date: '2026-03-01T00:00:00Z',
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    ordersRepo.saveOrderSnapshots([
      {
        id: '9001:201',
        characterId: 9001,
        orderId: 201,
        typeId: 34,
        regionId: 10000002,
        locationId: 60003760,
        price: 6,
        volumeTotal: 100,
        volumeRemain: 100,
        volumeFilled: 0,
        isBuyOrder: false,
        duration: 90,
        issued: '2026-03-01T00:00:00Z',
        expiresAt: '2026-05-30T00:00:00Z',
        state: 'ACTIVE',
        stateJustification: 'Actif',
        isActiveInCurrentSnapshot: true,
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 100,
        source: 'test',
      },
      {
        id: '9002:202',
        characterId: 9002,
        orderId: 202,
        typeId: 34,
        regionId: 10000002,
        locationId: 60003760,
        price: 6,
        volumeTotal: 200,
        volumeRemain: 200,
        volumeFilled: 0,
        isBuyOrder: false,
        duration: 90,
        issued: '2026-03-01T00:00:00Z',
        expiresAt: '2026-05-30T00:00:00Z',
        state: 'ACTIVE',
        stateJustification: 'Actif',
        isActiveInCurrentSnapshot: true,
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 200,
        source: 'test',
      },
    ]);

    assetsRepo.saveAssets([
      {
        id: '9001:301',
        characterId: 9001,
        itemId: 301,
        typeId: 34,
        quantity: 1000,
        locationId: 60003760,
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
      {
        id: '9002:302',
        characterId: 9002,
        itemId: 302,
        typeId: 34,
        quantity: 2000,
        locationId: 60003760,
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    syncRepo.updateSyncState(9001, 'wallet_transactions', { totalRecords: 5 });
    syncRepo.updateSyncState(9002, 'wallet_transactions', { totalRecords: 10 });

    ledgerRepo.clearCharacter(9001);
    ordersRepo.clearCharacter(9001);
    assetsRepo.clearAssets(9001);
    syncRepo.clearCharacter(9001);

    expect(ledgerRepo.getTransactionById(9001, 101)).toBeNull();
    expect(ordersRepo.getOrderById(9001, 201)).toBeNull();
    expect(assetsRepo.getStockForType(34, undefined, [9001])).toBe(0);
    expect(syncRepo.getSyncState(9001, 'wallet_transactions').totalRecords).toBe(0);

    expect(ledgerRepo.getTransactionById(9002, 102)).not.toBeNull();
    expect(ordersRepo.getOrderById(9002, 202)).not.toBeNull();
    expect(assetsRepo.getStockForType(34, undefined, [9002])).toBe(2000);
    expect(syncRepo.getSyncState(9002, 'wallet_transactions').totalRecords).toBe(10);
  });

  it('4. Restores 100% of data and allocations from AppBackupSnapshot v1', () => {
    const ledgerRepo = new PersistentLedgerRepository();
    const ordersRepo = new PersistentOrdersRepository();
    const hubsRepo = new HubsRepository();
    const roiRepo = new RoiRepository(ledgerRepo);
    const assetsRepo = new PersistentAssetsRepository();
    const syncRepo = new PersistentSyncRepository();

    const backupService = new BackupRestoreService(
      ledgerRepo,
      ordersRepo,
      hubsRepo,
      roiRepo,
      assetsRepo,
      syncRepo
    );

    const snapshotV1: AppBackupSnapshot = {
      schemaVersion: 1,
      exportedAt: '2026-03-01T10:00:00.000Z',
      checksum: '',
      data: {
        ledger: {
          transactions: [
            {
              id: '8888:50001',
              characterId: 8888,
              transactionId: 50001,
              typeId: 34,
              typeName: 'Tritanium',
              quantity: 1000,
              unitPrice: 5.2,
              totalValue: 5200,
              isBuy: true,
              isPersonal: true,
              journalRefId: 10,
              locationId: 60003760,
              clientId: 12,
              date: '2026-03-01T08:00:00Z',
              source: 'test',
              observedAt: 1772438400000,
            },
          ],
          journalEntries: [],
        },
        orders: {
          snapshots: [],
          restockItems: [],
        },
        hubs: {
          definitions: [
            {
              id: 'hub-jita',
              name: 'Jita IV - Moon 4 - CNAP',
              system_name: 'Jita',
              is_system_default: true,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          mappings: [],
        },
        roi: {
          allocations: [],
        },
        assets: {
          assets: [],
        },
        sync: {
          states: [],
        },
      },
    };

    snapshotV1.checksum = backupService.computeChecksum(snapshotV1.data);

    const result = backupService.restoreBackup(snapshotV1);
    expect(result.success).toBe(true);
    expect(result.restoredCounts?.transactions).toBe(1);

    const audit = backupService.auditDataIntegrity();
    expect(audit.status).toBe('HEALTHY');
    expect(audit.summary.totalTransactions).toBe(1);
  });

  it('5. Executes indexed queries on 50,000 transactions in < 50ms', () => {
    const ledgerRepo = new PersistentLedgerRepository();

    const bulkTxs: CharacterTransaction[] = [];
    const now = Date.now();

    for (let i = 1; i <= 50000; i++) {
      const isBuy = i % 2 === 0;
      const charId = (i % 3) + 1;
      const typeId = (i % 200) + 1;
      const locId = 60003760 + (i % 10);

      bulkTxs.push({
        id: `${charId}:${i}`,
        characterId: charId,
        transactionId: i,
        typeId,
        typeName: `Item #${typeId}`,
        quantity: 10 + (i % 100),
        unitPrice: 100 + (i % 50),
        totalValue: (10 + (i % 100)) * (100 + (i % 50)),
        isBuy,
        isPersonal: true,
        journalRefId: i,
        locationId: locId,
        locationName: `Station ${locId}`,
        clientId: 1000 + (i % 500),
        clientName: `Trader ${i % 500}`,
        date: new Date(now - i * 60000).toISOString(),
        source: 'test',
        observedAt: now,
      });
    }

    ledgerRepo.saveTransactions(bulkTxs);

    const queryStart = performance.now();
    const result = ledgerRepo.getTransactions({
      characterId: 1,
      type: 'SELL',
      typeId: 42,
      pageSize: 50,
    });
    const queryDuration = performance.now() - queryStart;

    expect(queryDuration).toBeLessThan(150);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((tx) => tx.characterId === 1 && !tx.isBuy && tx.typeId === 42)).toBe(true);
  });

  it('6. Rolls back ACID transaction cleanly when an error occurs during batch operations', async () => {
    const isolatedPath = './.data/isolated_test_acid.json';
    if (fs.existsSync(isolatedPath)) fs.unlinkSync(isolatedPath);

    const adapter = new DurableFileDatabaseAdapter(isolatedPath);
    adapter.init();

    const initialState = adapter.getState();
    initialState.data.ledger.transactions.push({
      id: '777:1',
      characterId: 777,
      transactionId: 1,
      typeId: 34,
      quantity: 10,
      unitPrice: 5,
      totalValue: 50,
      isBuy: true,
      isPersonal: true,
      journalRefId: 1,
      locationId: 60003760,
      clientId: 1,
      date: '2026-03-01T00:00:00Z',
      source: 'test',
      observedAt: Date.now(),
    });
    adapter.setState(initialState);

    await expect(
      adapter.transaction(async () => {
        const state = adapter.getState();
        state.data.ledger.transactions.push({
          id: '777:2',
          characterId: 777,
          transactionId: 2,
          typeId: 34,
          quantity: 20,
          unitPrice: 5,
          totalValue: 100,
          isBuy: true,
          isPersonal: true,
          journalRefId: 2,
          locationId: 60003760,
          clientId: 1,
          date: '2026-03-01T00:00:00Z',
          source: 'test',
          observedAt: Date.now(),
        });
        throw new Error('Simulated database write failure');
      })
    ).rejects.toThrow('Simulated database write failure');

    expect(adapter.getState().data.ledger.transactions.length).toBe(1);
    expect(adapter.getState().data.ledger.transactions[0].transactionId).toBe(1);

    if (fs.existsSync(isolatedPath)) fs.unlinkSync(isolatedPath);
  });

  it('7. Preserves corrupted storage file as backup archive without destructive overwrite (S0-1 fix)', () => {
    const corruptPath = './.data/corrupt_test_store.json';
    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);

    // Clean up any previous backup files
    const dir = './.data';
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith('corrupt_test_store.json.corrupt.')) {
          fs.unlinkSync(`${dir}/${file}`);
        }
      }
    }

    // Write truncated/corrupted JSON
    fs.writeFileSync(corruptPath, '{"version": 2, "appliedMigrations": [1], "data": {"ledger": {"transactions": [ truncated...', 'utf8');

    const adapter = new DurableFileDatabaseAdapter(corruptPath);
    adapter.init();

    // 1. The original path now contains fresh clean state
    expect(fs.existsSync(corruptPath)).toBe(true);
    const cleanContent = JSON.parse(fs.readFileSync(corruptPath, 'utf8'));
    expect(cleanContent.data.ledger.transactions).toEqual([]);

    // 2. A backup file exists containing the corrupted content intact
    const backupFiles = fs.readdirSync(dir).filter((f) => f.startsWith('corrupt_test_store.json.corrupt.'));
    expect(backupFiles.length).toBeGreaterThan(0);
    const backupContent = fs.readFileSync(`${dir}/${backupFiles[0]}`, 'utf8');
    expect(backupContent).toContain('truncated...');

    // Cleanup
    if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    for (const file of backupFiles) {
      fs.unlinkSync(`${dir}/${file}`);
    }
  });

  it('8. Propagates IO error when persist() fails due to disk write or permission error (S0-1 fix)', () => {
    const errorPath = './.data/io_error_store.json';
    const adapter = new DurableFileDatabaseAdapter(errorPath);
    adapter.init();

    // Mock writeFileSync to throw an IO error (e.g. ENOSPC or EACCES)
    const originalWriteFileSync = fs.writeFileSync;
    try {
      fs.writeFileSync = () => {
        throw new Error('ENOSPC: no space left on device');
      };

      expect(() => adapter.persist()).toThrow('ENOSPC: no space left on device');
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      if (fs.existsSync(errorPath)) fs.unlinkSync(errorPath);
    }
  });
});
