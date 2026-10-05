import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  FinancialRecoveryManager,
  type FinancialRecoveryReport,
} from './recovery.ts';
import { PersistentLedgerRepository } from './repository.ts';
import { PersistentOrdersRepository } from '../orders/repository.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { RoiService } from '../roi/service.ts';
import { PersistentAssetsRepository } from '../assets/repository.ts';
import { PersistentSyncRepository } from '../sync/repository.ts';
import { BackupRestoreService } from '../storage/backupService.ts';
import { DurableFileDatabaseAdapter, StorageManager } from '../storage/database.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from './types.ts';
import type { ExplicitCostAllocation, OpeningBalanceLot } from '../roi/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';

const TEST_DB_PATH = './.data/test_recovery_store.json';
const TEST_BACKUP_DIR = './.data/test_backups';

describe('Phase F10 — Reconstitution Historique, Recalcul et Qualification Financière', () => {
  let adapter: DurableFileDatabaseAdapter;
  let ledgerRepo: PersistentLedgerRepository;
  let ordersRepo: PersistentOrdersRepository;
  let hubsRepo: HubsRepository;
  let roiRepo: RoiRepository;
  let assetsRepo: PersistentAssetsRepository;
  let syncRepo: PersistentSyncRepository;
  let roiService: RoiService;
  let backupService: BackupRestoreService;
  let recoveryManager: FinancialRecoveryManager;

  const cleanupTestFiles = () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // Ignore
      }
    }
    if (fs.existsSync(TEST_BACKUP_DIR)) {
      try {
        fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  };

  beforeEach(() => {
    cleanupTestFiles();
    StorageManager.resetInstance({ storagePath: TEST_DB_PATH, engine: 'file' });
    adapter = new DurableFileDatabaseAdapter(TEST_DB_PATH);
    adapter.init();

    ordersRepo = new PersistentOrdersRepository(adapter);
    ledgerRepo = new PersistentLedgerRepository(adapter, ordersRepo);
    hubsRepo = new HubsRepository(adapter);
    roiRepo = new RoiRepository(ledgerRepo, adapter);
    assetsRepo = new PersistentAssetsRepository(adapter);
    syncRepo = new PersistentSyncRepository(adapter);

    roiService = new RoiService(roiRepo, undefined, ledgerRepo);
    backupService = new BackupRestoreService(
      ledgerRepo,
      ordersRepo,
      hubsRepo,
      roiRepo,
      assetsRepo,
      syncRepo
    );

    recoveryManager = new FinancialRecoveryManager(
      ledgerRepo,
      ordersRepo,
      hubsRepo,
      roiRepo,
      assetsRepo,
      syncRepo,
      roiService,
      backupService,
      adapter
    );
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  // Helper to build realistic dataset with task-55 anomalies
  const seedCorruptedHistoricalData = () => {
    const charA = 1001;
    const charB = 1002;
    const corpId = 98000001;

    // 1. Hub definition
    hubsRepo.upsertHub({
      id: 'hub-jita',
      name: 'Jita 4-4',
      system_name: 'Jita',
      is_system_default: true,
      created_at: '2026-01-01T00:00:00Z',
    });

    // 2. Buy Transactions (Purchase lots)
    const buyTxs: CharacterTransaction[] = [
      {
        id: `${charA}:101`,
        characterId: charA,
        transactionId: 101,
        date: '2026-09-01T10:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 10000,
        unitPrice: 5.0,
        totalValue: 50000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 501,
        locationId: 60003760,
        clientId: 9001,
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: `${charB}:102`,
        characterId: charB,
        transactionId: 102,
        date: '2026-09-02T10:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 5000,
        unitPrice: 5.5,
        totalValue: 27500,
        isBuy: true,
        isPersonal: true,
        journalRefId: 502,
        locationId: 60003760,
        clientId: 9002,
        source: 'esi',
        observedAt: Date.now(),
      },
    ];

    // 3. Sell Transactions (Sales)
    const sellTxs: CharacterTransaction[] = [
      {
        id: `${charA}:201`,
        characterId: charA,
        transactionId: 201,
        date: '2026-09-05T12:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 4000,
        unitPrice: 7.0,
        totalValue: 28000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 601,
        locationId: 60003760,
        clientId: 9003,
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: `${charA}:202`,
        characterId: charA,
        transactionId: 202,
        date: '2026-09-06T12:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 6000,
        unitPrice: 7.5,
        totalValue: 45000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 602,
        locationId: 60003760,
        clientId: 9004,
        source: 'esi',
        observedAt: Date.now(),
      },
    ];

    ledgerRepo.saveTransactions([...buyTxs, ...sellTxs]);

    // 4. Broker fees order snapshot
    const orders: CharacterOrderSnapshot[] = [
      {
        id: `${charA}:701`,
        orderId: 701,
        characterId: charA,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60003760,
        price: 7.0,
        volumeTotal: 10000,
        volumeRemain: 0,
        volumeFilled: 10000,
        isBuyOrder: false,
        duration: 90,
        expiresAt: '2026-12-05T11:50:00Z',
        state: 'COMPLETED_CONFIRMED',
        stateJustification: 'Order completed and filled',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 0,
        isActiveInCurrentSnapshot: false,
        issued: '2026-09-05T11:50:00Z',
        source: 'esi',
      },
    ];
    ordersRepo.saveOrderSnapshots(orders);

    // 5. Journal entries with DUPLICATED corporate records under both charA and charB
    const journals: CharacterWalletJournalEntry[] = [
      // Taxes for sell #201 and #202
      {
        id: `char:${charA}:801`,
        characterId: charA,
        journalId: 801,
        date: '2026-09-05T12:00:00Z',
        refType: 'transaction_tax',
        amount: -224, // 0.8% of 28000
        tax: 224,
        contextId: 201,
        contextIdType: 'transaction_tax',
        description: 'Transaction tax',
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: `char:${charA}:802`,
        characterId: charA,
        journalId: 802,
        date: '2026-09-06T12:00:00Z',
        refType: 'transaction_tax',
        amount: -360, // 0.8% of 45000
        tax: 360,
        contextId: 202,
        contextIdType: 'transaction_tax',
        description: 'Transaction tax',
        source: 'esi',
        observedAt: Date.now(),
      },
      // Broker fee
      {
        id: `char:${charA}:803`,
        characterId: charA,
        journalId: 803,
        date: '2026-09-05T11:50:00Z',
        refType: 'brokers_fee',
        amount: -700, // 1% of 70000 order
        contextId: 701,
        contextIdType: 'broker_fee',
        description: 'Brokers fee',
        source: 'esi',
        observedAt: Date.now(),
      },
      // Duplicate corporate journal entry 1 (seen by charA and charB)
      {
        id: `char:${charA}:9001`,
        characterId: charA,
        journalId: 9001,
        corporationId: corpId,
        isCorporationWallet: true,
        division: 1,
        date: '2026-09-03T10:00:00Z',
        refType: 'market_transaction',
        amount: 150000,
        description: 'Corp sale',
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: `char:${charB}:9001`,
        characterId: charB,
        journalId: 9001,
        corporationId: corpId,
        isCorporationWallet: true,
        division: 1,
        date: '2026-09-03T10:00:00Z',
        refType: 'market_transaction',
        amount: 150000,
        description: 'Corp sale',
        source: 'esi',
        observedAt: Date.now(),
      },
      // Duplicate corporate journal entry 2
      {
        id: `char:${charA}:9002`,
        characterId: charA,
        journalId: 9002,
        corporationId: corpId,
        isCorporationWallet: true,
        division: 1,
        date: '2026-09-03T11:00:00Z',
        refType: 'brokers_fee',
        amount: -1500,
        description: 'Corp broker fee',
        source: 'esi',
        observedAt: Date.now(),
      },
      {
        id: `char:${charB}:9002`,
        characterId: charB,
        journalId: 9002,
        corporationId: corpId,
        isCorporationWallet: true,
        division: 1,
        date: '2026-09-03T11:00:00Z',
        refType: 'brokers_fee',
        amount: -1500,
        description: 'Corp broker fee',
        source: 'esi',
        observedAt: Date.now(),
      },
    ];

    ledgerRepo.saveJournalEntries(journals);

    // 6. Old allocations with missing broker fees
    const oldAllocations: ExplicitCostAllocation[] = [
      {
        id: 'old-fifo-1',
        character_id: charA,
        buy_character_id: charA,
        sell_character_id: charA,
        sell_transaction_id: 201,
        source_type: 'TRANSACTION',
        buy_transaction_id: 101,
        type_id: 34,
        type_name: 'Tritanium',
        quantity_allocated: 4000,
        unit_buy_price: 5.0,
        allocated_buy_cost: 20000,
        allocated_buy_fees: 0, // Legacy bug: 0 broker fee
        allocated_sell_fees: 0, // Legacy bug: 0 fees
        buy_location_id: 60003760,
        buy_hub_id: 'jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: '2026-09-05T12:05:00Z',
        updated_at: '2026-09-05T12:05:00Z',
        version: 1,
      },
    ];
    roiRepo.saveAllocations(oldAllocations);
  };

  /**
   * TEST-F10-01 : Exécution en mode dry-run: true sur base avec doublons
   * Résultat attendu : Rapport d'écart généré, fichier source strictement non modifié (même hash SHA-256).
   */
  it('TEST-F10-01: dry-run mode generates discrepancy report and leaves store file strictly unmodified (same SHA-256)', async () => {
    seedCorruptedHistoricalData();
    adapter.persist();

    const rawFileBefore = fs.readFileSync(TEST_DB_PATH, 'utf8');
    const shaBefore = crypto.createHash('sha256').update(rawFileBefore, 'utf8').digest('hex');

    const report: FinancialRecoveryReport = await recoveryManager.runRecovery({
      dryRun: true,
      backupDir: TEST_BACKUP_DIR,
    });

    expect(report.dryRun).toBe(true);
    expect(report.success).toBe(true);
    expect(report.preRecoverySha256).toBeDefined();

    // Check discrepancy report
    expect(report.details.journalDeduplication.removedDuplicatesCount).toBe(2);
    expect(report.metrics.deltas.deltaJournalEntriesCount).toBe(-2);
    expect(report.metrics.after.journalEntriesCount).toBe(5); // 7 original - 2 duplicates

    // Verify taxes and broker fees re-allocated
    expect(report.metrics.after.totalTaxesIsk).toBe(584); // 224 + 360
    expect(report.metrics.after.totalBrokerFeesIsk).toBe(2200); // 700 + 1500

    // Check file integrity: byte-for-byte unmodified
    const rawFileAfter = fs.readFileSync(TEST_DB_PATH, 'utf8');
    const shaAfter = crypto.createHash('sha256').update(rawFileAfter, 'utf8').digest('hex');
    expect(shaAfter).toBe(shaBefore);
  });

  /**
   * TEST-F10-02 : Exécution réelle : création du backup de sécurité
   * Résultat attendu : Fichier de backup présent dans .data/backups/, hash SHA-256 validé.
   */
  it('TEST-F10-02: real execution creates verified SHA-256 backup file and persists reconciled state', async () => {
    seedCorruptedHistoricalData();
    adapter.persist();

    const initialExport = backupService.exportBackup();
    const initialChecksum = initialExport.checksum;

    const report = await recoveryManager.runRecovery({
      dryRun: false,
      backupDir: TEST_BACKUP_DIR,
    });

    expect(report.dryRun).toBe(false);
    expect(report.success).toBe(true);
    expect(report.backupFilePath).toBeDefined();
    expect(fs.existsSync(report.backupFilePath!)).toBe(true);

    // Verify backup file content and cryptographic hash
    const backupContent = fs.readFileSync(report.backupFilePath!, 'utf8');
    const computedSha = crypto.createHash('sha256').update(backupContent, 'utf8').digest('hex');
    expect(report.backupSha256).toBe(computedSha);

    const parsedBackup = JSON.parse(backupContent);
    expect(parsedBackup.checksum).toBe(initialChecksum);

    // Verify durable storage was updated
    const afterExport = backupService.exportBackup();
    expect(afterExport.data.ledger.journalEntries.length).toBe(5);
    expect(report.postRecoverySha256).toBe(afterExport.checksum);
    expect(report.postRecoverySha256).not.toBe(report.preRecoverySha256);
  });

  /**
   * TEST-F10-03 : Recalcul avec 10 allocations manuelles verrouillées
   * Résultat attendu : Les 10 allocations MANUAL sont rigoureusement intactes (identiques en quantité et coût).
   */
  it('TEST-F10-03: preserves 10 locked manual opening balance and transaction allocations intact', async () => {
    seedCorruptedHistoricalData();

    // Create 10 manual allocations on opening balances & transactions
    const manualOpeningBalances: OpeningBalanceLot[] = [];
    const manualAllocations: ExplicitCostAllocation[] = [];

    for (let i = 1; i <= 5; i++) {
      const obLot: OpeningBalanceLot = {
        id: `ob-manual-${i}`,
        character_id: 1001,
        type_id: 34,
        type_name: 'Tritanium',
        quantity: 500,
        allocated_quantity: 100 * i,
        remaining_quantity: 500 - 100 * i,
        unit_cost_isk: 4.0 + i * 0.1,
        total_cost_isk: 500 * (4.0 + i * 0.1),
        location_id: 60003760,
        hub_id: 'jita',
        hub_name: 'Jita 4-4',
        acquisition_date: '2026-08-01T00:00:00Z',
        justification: `Stock initial lot #${i}`,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        version: 1,
      };
      roiRepo.saveOpeningBalance(obLot);
      manualOpeningBalances.push(obLot);

      const allocOb: ExplicitCostAllocation = {
        id: `alloc-manual-ob-${i}`,
        character_id: 1001,
        buy_character_id: 1001,
        sell_character_id: 1001,
        sell_transaction_id: 201,
        source_type: 'OPENING_BALANCE',
        opening_balance_id: obLot.id,
        type_id: 34,
        type_name: 'Tritanium',
        quantity_allocated: 100 * i,
        unit_buy_price: obLot.unit_cost_isk,
        allocated_buy_cost: (100 * i) * obLot.unit_cost_isk,
        allocated_buy_fees: 0,
        allocated_sell_fees: 50 * i,
        allocated_sell_taxes: 20 * i,
        allocated_sell_broker_fees: 30 * i,
        buy_location_id: 60003760,
        buy_hub_id: 'jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'MANUAL',
        created_at: '2026-09-05T12:00:00Z',
        updated_at: '2026-09-05T12:00:00Z',
        version: 1,
      };
      roiRepo.saveAllocation(allocOb);
      manualAllocations.push(allocOb);
    }

    for (let i = 1; i <= 5; i++) {
      const allocTx: ExplicitCostAllocation = {
        id: `alloc-manual-tx-${i}`,
        character_id: 1001,
        buy_character_id: 1001,
        sell_character_id: 1001,
        sell_transaction_id: 202,
        source_type: 'TRANSACTION',
        buy_transaction_id: 101,
        type_id: 34,
        type_name: 'Tritanium',
        quantity_allocated: 50 * i,
        unit_buy_price: 5.0,
        allocated_buy_cost: (50 * i) * 5.0,
        allocated_buy_fees: 10 * i,
        allocated_sell_fees: 25 * i,
        buy_location_id: 60003760,
        buy_hub_id: 'jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'MANUAL',
        created_at: '2026-09-06T12:00:00Z',
        updated_at: '2026-09-06T12:00:00Z',
        version: 1,
      };
      roiRepo.saveAllocation(allocTx);
      manualAllocations.push(allocTx);
    }

    expect(manualAllocations.length).toBe(10);
    adapter.persist();

    // Execute real recovery
    const report = await recoveryManager.runRecovery({
      dryRun: false,
      backupDir: TEST_BACKUP_DIR,
    });

    expect(report.success).toBe(true);
    expect(report.manualAllocationsIntegrity.expectedCount).toBe(10);
    expect(report.manualAllocationsIntegrity.preservedCount).toBe(10);
    expect(report.manualAllocationsIntegrity.intact).toBe(true);

    // Verify each manual allocation remained completely identical
    const currentAllocations = roiRepo.listAllocations();
    for (const original of manualAllocations) {
      const found = currentAllocations.find((a) => a.id === original.id);
      expect(found).toBeDefined();
      expect(found!.reconciliation_mode).toBe('MANUAL');
      expect(found!.quantity_allocated).toBe(original.quantity_allocated);
      expect(found!.unit_buy_price).toBe(original.unit_buy_price);
      expect(found!.allocated_buy_cost).toBe(original.allocated_buy_cost);
      expect(found!.sell_transaction_id).toBe(original.sell_transaction_id);
    }
  });

  /**
   * TEST-F10-04 : Idempotence : exécution 2 fois de suite du recalcul
   * Résultat attendu : Le 2ème rapport d'écart affiche un delta strictement nul (delta = 0 ISK) sur tous les postes.
   */
  it('TEST-F10-04: idempotence: second consecutive recalculation produces strictly zero delta on all financial metrics', async () => {
    seedCorruptedHistoricalData();
    adapter.persist();

    // First recovery run (applies fixes)
    const report1 = await recoveryManager.runRecovery({
      dryRun: false,
      backupDir: TEST_BACKUP_DIR,
    });
    expect(report1.success).toBe(true);
    expect(report1.metrics.deltas.deltaJournalEntriesCount).toBe(-2);

    // Second recovery run (must be completely idempotent)
    const report2 = await recoveryManager.runRecovery({
      dryRun: false,
      backupDir: TEST_BACKUP_DIR,
    });

    expect(report2.success).toBe(true);
    expect(report2.details.journalDeduplication.removedDuplicatesCount).toBe(0);

    // Check all deltas are strictly 0
    expect(report2.metrics.deltas.deltaJournalEntriesCount).toBe(0);
    expect(report2.metrics.deltas.deltaCorporateJournalEntriesCount).toBe(0);
    expect(report2.metrics.deltas.deltaTaxesIsk).toBe(0);
    expect(report2.metrics.deltas.deltaBrokerFeesIsk).toBe(0);
    expect(report2.metrics.deltas.deltaGrossSalesIsk).toBe(0);
    expect(report2.metrics.deltas.deltaNetSalesIsk).toBe(0);
    expect(report2.metrics.deltas.deltaRealizedProfitIsk).toBe(0);
    expect(report2.metrics.deltas.deltaAllocationsCount).toBe(0);
    expect(report2.metrics.deltas.deltaAutoAllocationsCount).toBe(0);
    expect(report2.metrics.deltas.deltaManualAllocationsCount).toBe(0);
    expect(report2.metrics.deltas.deltaReconciledSalesCount).toBe(0);
    expect(report2.metrics.deltas.deltaFullyMatchedSalesCount).toBe(0);
    expect(report2.metrics.deltas.deltaQuantityReconciled).toBe(0);

    // Check pre-recovery hash matches post-recovery hash on 2nd run
    expect(report2.preRecoverySha256).toBe(report2.postRecoverySha256);
  });

  /**
   * TEST-F10-05 : Résilience : interruption forcée au milieu du recalcul (simulation d'erreur)
   * Résultat attendu : Restauration automatique de l'état initial sans corruption de base.
   */
  it('TEST-F10-05: resilience: automatic rollback to initial state on simulated mid-execution failure without corruption', async () => {
    seedCorruptedHistoricalData();
    adapter.persist();

    const initialExport = backupService.exportBackup();
    const initialChecksum = initialExport.checksum;

    // Simulate an error inside autoReconcileFifo
    const faultyRoiService = {
      ...roiService,
      getSummary: roiService.getSummary.bind(roiService),
      getSalesReconciliationDetails: roiService.getSalesReconciliationDetails.bind(roiService),
      autoReconcileFifo: () => {
        throw new Error('Simulated crash: disk full during FIFO re-allocation');
      },
    } as unknown as RoiService;

    const faultyRecoveryManager = new FinancialRecoveryManager(
      ledgerRepo,
      ordersRepo,
      hubsRepo,
      roiRepo,
      assetsRepo,
      syncRepo,
      faultyRoiService,
      backupService,
      adapter
    );

    let caughtError: Error | null = null;
    try {
      await faultyRecoveryManager.runRecovery({
        dryRun: false,
        backupDir: TEST_BACKUP_DIR,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('Simulated crash');

    // Verify that data was cleanly restored to initial baseline
    const currentExport = backupService.exportBackup();
    expect(currentExport.checksum).toBe(initialChecksum);
    expect(currentExport.data.ledger.journalEntries.length).toBe(7); // Kept original pre-run entries without corruption

    const auditReport = backupService.auditDataIntegrity();
    expect(auditReport.status).not.toBe('CORRUPTED');
  });
});
