import { describe, it, expect, beforeEach } from 'vitest';
import { BackupRestoreService } from './backupService.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { InMemorySyncRepository } from '../sync/repository.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { ExplicitCostAllocation } from '../roi/types.ts';

describe('Storage & Backup Reliability Service (Phase H02)', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let hubsRepo: HubsRepository;
  let roiRepo: RoiRepository;
  let assetsRepo: InMemoryAssetsRepository;
  let syncRepo: InMemorySyncRepository;
  let backupService: BackupRestoreService;

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ordersRepo = new InMemoryOrdersRepository();
    hubsRepo = new HubsRepository();
    roiRepo = new RoiRepository();
    assetsRepo = new InMemoryAssetsRepository();
    syncRepo = new InMemorySyncRepository();

    backupService = new BackupRestoreService(
      ledgerRepo,
      ordersRepo,
      hubsRepo,
      roiRepo,
      assetsRepo,
      syncRepo
    );
  });

  it('exports a valid backup with deterministic SHA-256 checksum and schemaVersion', () => {
    const tx: CharacterTransaction = {
      id: '1001:5001',
      characterId: 1001,
      transactionId: 5001,
      date: '2026-09-20T10:00:00Z',
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 1000,
      unitPrice: 5.5,
      totalValue: 5500,
      isBuy: true,
      isPersonal: true,
      journalRefId: 101,
      locationId: 60003760,
      clientId: 999,
      source: 'test',
      observedAt: Date.now(),
    };
    ledgerRepo.saveTransactions([tx]);

    const backup = backupService.exportBackup();

    expect(backup.schemaVersion).toBe(2);
    expect(backup.exportedAt).toBeDefined();
    expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(backup.data.ledger.transactions).toHaveLength(1);
    expect(backup.data.ledger.transactions[0].transactionId).toBe(5001);

    const verification = backupService.verifyBackup(backup);
    expect(verification.valid).toBe(true);
  });

  it('rejects tampered or corrupted backup files with checksum mismatch', () => {
    const backup = backupService.exportBackup();
    
    // Tamper data without updating checksum
    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.data.ledger.transactions.push({
      id: '1001:9999',
      characterId: 1001,
      transactionId: 9999,
      date: '2026-09-20T10:00:00Z',
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 500,
      unitPrice: 5.0,
      totalValue: 2500,
      isBuy: true,
      isPersonal: true,
      journalRefId: 102,
      locationId: 60003760,
      clientId: 999,
      source: 'test',
      observedAt: Date.now(),
    });

    const verification = backupService.verifyBackup(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain('checksum mismatch');

    const restoreResult = backupService.restoreBackup(tampered);
    expect(restoreResult.success).toBe(false);
    expect(restoreResult.error).toContain('checksum mismatch');
  });

  it('rejects backups with invalid structure or unsupported schemaVersion', () => {
    expect(backupService.verifyBackup(null).valid).toBe(false);
    expect(backupService.verifyBackup({ schemaVersion: 99 }).valid).toBe(false);
    expect(backupService.verifyBackup({ schemaVersion: 1, data: null }).valid).toBe(false);
  });

  it('restores application state cleanly and atomically across all repositories', () => {
    // 1. Seed initial data
    const txBuy: CharacterTransaction = {
      id: '1001:101',
      characterId: 1001,
      transactionId: 101,
      date: '2026-09-01T10:00:00Z',
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 1000,
      unitPrice: 5.0,
      totalValue: 5000,
      isBuy: true,
      isPersonal: true,
      journalRefId: 1,
      locationId: 60003760,
      clientId: 900,
      source: 'test',
      observedAt: Date.now(),
    };
    ledgerRepo.saveTransactions([txBuy]);

    const order: CharacterOrderSnapshot = {
      id: '1001:201',
      characterId: 1001,
      orderId: 201,
      typeId: 34,
      typeName: 'Tritanium',
      regionId: 10000002,
      locationId: 60003760,
      isBuyOrder: false,
      price: 6.0,
      volumeTotal: 1000,
      volumeRemain: 1000,
      volumeFilled: 0,
      issued: '2026-09-01T12:00:00Z',
      duration: 90,
      expiresAt: '2026-11-30T12:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif',
      firstObservedAt: Date.now(),
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 1000,
      isActiveInCurrentSnapshot: true,
      source: 'test',
    };
    ordersRepo.saveOrderSnapshots([order]);

    // 2. Export backup
    const backup = backupService.exportBackup();

    // 3. Mutate/clear repositories
    ledgerRepo.reset();
    ordersRepo.clearCharacter(1001);
    expect(ledgerRepo.countTransactions(1001)).toBe(0);
    expect(ordersRepo.getOrdersForCharacter(1001)).toHaveLength(0);

    // 4. Restore backup
    const restoreResult = backupService.restoreBackup(backup);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredCounts?.transactions).toBe(1);
    expect(restoreResult.restoredCounts?.orders).toBe(1);

    // 5. Verify restored state
    expect(ledgerRepo.countTransactions(1001)).toBe(1);
    expect(ledgerRepo.getTransactionById(1001, 101)).not.toBeNull();
    expect(ordersRepo.getOrderById(1001, 201)).not.toBeNull();
  });

  it('performs exhaustive data integrity audit detecting anomalies and orphan links', () => {
    // Seed valid buy & sell transactions
    const buyTx: CharacterTransaction = {
      id: '1001:1',
      characterId: 1001,
      transactionId: 1,
      date: '2026-09-01T10:00:00Z',
      typeId: 34,
      quantity: 100,
      unitPrice: 5.0,
      totalValue: 500,
      isBuy: true,
      isPersonal: true,
      journalRefId: 10,
      locationId: 60003760,
      clientId: 1,
      source: 'test',
      observedAt: Date.now(),
    };
    const sellTx: CharacterTransaction = {
      id: '1001:2',
      characterId: 1001,
      transactionId: 2,
      date: '2026-09-02T10:00:00Z',
      typeId: 34,
      quantity: 100,
      unitPrice: 7.0,
      totalValue: 700,
      isBuy: false,
      isPersonal: true,
      journalRefId: 11,
      locationId: 60003760,
      clientId: 2,
      source: 'test',
      observedAt: Date.now(),
    };
    ledgerRepo.saveTransactions([buyTx, sellTx]);

    // Healthy audit
    let report = backupService.auditDataIntegrity();
    expect(report.status).toBe('HEALTHY');
    expect(report.issues).toHaveLength(0);

    // Introduce orphan allocation pointing to non-existent transaction
    const orphanAlloc: ExplicitCostAllocation = {
      id: 'orphan-1',
      character_id: 1001,
      buy_character_id: 1001,
      sell_character_id: 1001,
      sell_transaction_id: 2,
      source_type: 'TRANSACTION',
      buy_transaction_id: 9999, // Missing buy transaction!
      type_id: 34,
      type_name: 'Tritanium',
      quantity_allocated: 50,
      unit_buy_price: 5.0,
      allocated_buy_cost: 250,
      allocated_buy_fees: 0,
      allocated_sell_fees: 0,
      buy_location_id: 60003760,
      buy_hub_id: 'hub-jita',
      buy_hub_name: 'Jita',
      sell_location_id: 60003760,
      sell_hub_id: 'hub-jita',
      sell_hub_name: 'Jita',
      reconciliation_mode: 'MANUAL',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    roiRepo.saveAllocation(orphanAlloc);

    report = backupService.auditDataIntegrity();
    expect(report.status).toBe('CORRUPTED');
    expect(report.issues.some((i) => i.message.includes('references missing buy transaction'))).toBe(true);

    // Introduce over-allocation
    roiRepo.deleteAllocation('orphan-1');
    const overAlloc: ExplicitCostAllocation = {
      id: 'over-1',
      character_id: 1001,
      buy_character_id: 1001,
      sell_character_id: 1001,
      sell_transaction_id: 2,
      source_type: 'TRANSACTION',
      buy_transaction_id: 1,
      type_id: 34,
      type_name: 'Tritanium',
      quantity_allocated: 500, // Exceeds buyTx.quantity (100) & sellTx.quantity (100)
      unit_buy_price: 5.0,
      allocated_buy_cost: 2500,
      allocated_buy_fees: 0,
      allocated_sell_fees: 0,
      buy_location_id: 60003760,
      buy_hub_id: 'hub-jita',
      buy_hub_name: 'Jita',
      sell_location_id: 60003760,
      sell_hub_id: 'hub-jita',
      sell_hub_name: 'Jita',
      reconciliation_mode: 'MANUAL',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    roiRepo.saveAllocation(overAlloc);

    report = backupService.auditDataIntegrity();
    expect(report.status).toBe('CORRUPTED');
    expect(report.issues.some((i) => i.message.includes('Over-allocated buy transaction'))).toBe(true);
  });

  describe('Phase R06 — Security Isolation & Scoped Backup/Restore', () => {
    it('exports a scoped backup containing only authorized characters', () => {
      const txA: CharacterTransaction = {
        id: '1001:1',
        characterId: 1001,
        transactionId: 1,
        date: '2026-09-01T10:00:00Z',
        typeId: 34,
        quantity: 100,
        unitPrice: 5.0,
        totalValue: 500,
        isBuy: true,
        isPersonal: true,
        journalRefId: 10,
        locationId: 60003760,
        clientId: 1,
        source: 'test',
        observedAt: Date.now(),
      };
      const txB: CharacterTransaction = {
        id: '2002:2',
        characterId: 2002,
        transactionId: 2,
        date: '2026-09-02T10:00:00Z',
        typeId: 34,
        quantity: 200,
        unitPrice: 5.5,
        totalValue: 1100,
        isBuy: true,
        isPersonal: true,
        journalRefId: 11,
        locationId: 60003760,
        clientId: 2,
        source: 'test',
        observedAt: Date.now(),
      };
      ledgerRepo.saveTransactions([txA, txB]);

      // Scoped export for character 1001 only
      const backupA = backupService.exportBackup([1001]);
      expect(backupA.data.ledger.transactions).toHaveLength(1);
      expect(backupA.data.ledger.transactions[0].characterId).toBe(1001);
      expect(backupA.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(backupService.verifyBackup(backupA).valid).toBe(true);
    });

    it('restores scoped backup for Character A without modifying or corrupting Character C data in database', () => {
      // Seed Character A (1001) and Character C (3003)
      const txA: CharacterTransaction = {
        id: '1001:10',
        characterId: 1001,
        transactionId: 10,
        date: '2026-09-01T10:00:00Z',
        typeId: 34,
        quantity: 100,
        unitPrice: 5.0,
        totalValue: 500,
        isBuy: true,
        isPersonal: true,
        journalRefId: 1,
        locationId: 60003760,
        clientId: 10,
        source: 'test',
        observedAt: Date.now(),
      };
      const txC: CharacterTransaction = {
        id: '3003:30',
        characterId: 3003,
        transactionId: 30,
        date: '2026-09-01T11:00:00Z',
        typeId: 35,
        quantity: 500,
        unitPrice: 10.0,
        totalValue: 5000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 2,
        locationId: 60003760,
        clientId: 30,
        source: 'test',
        observedAt: Date.now(),
      };
      ledgerRepo.saveTransactions([txA, txC]);

      // Export backup for character A
      const backupA = backupService.exportBackup([1001]);

      // Character A data gets modified, but Character C data remains
      ledgerRepo.clearCharacter(1001);
      expect(ledgerRepo.countTransactions(1001)).toBe(0);
      expect(ledgerRepo.countTransactions(3003)).toBe(1);

      // Restore Character A in scoped mode
      const result = backupService.restoreBackup(backupA, { authorizedCharacterIds: [1001] });
      expect(result.success).toBe(true);
      expect(result.restoredCounts?.transactions).toBe(1);

      // Character A is restored
      expect(ledgerRepo.countTransactions(1001)).toBe(1);
      expect(ledgerRepo.getTransactionById(1001, 10)).not.toBeNull();

      // Character C is completely intact and untouched
      expect(ledgerRepo.countTransactions(3003)).toBe(1);
      expect(ledgerRepo.getTransactionById(3003, 30)?.totalValue).toBe(5000);
    });

    it('strictly rejects restoring a backup containing characters outside authorizedCharacterIds (tenant traversal prevention)', () => {
      const txB: CharacterTransaction = {
        id: '2002:99',
        characterId: 2002,
        transactionId: 99,
        date: '2026-09-01T10:00:00Z',
        typeId: 34,
        quantity: 10,
        unitPrice: 5.0,
        totalValue: 50,
        isBuy: true,
        isPersonal: true,
        journalRefId: 9,
        locationId: 60003760,
        clientId: 99,
        source: 'test',
        observedAt: Date.now(),
      };
      ledgerRepo.saveTransactions([txB]);

      const backupB = backupService.exportBackup([2002]);

      // User session is only authorized for character 1001, attempts to restore backup containing 2002
      const result = backupService.restoreBackup(backupB, { authorizedCharacterIds: [1001] });
      expect(result.success).toBe(false);
      expect(result.unauthorized).toBe(true);
      expect(result.error).toContain('non autorisés');
    });

    it('rejects backup with invalid cryptographic SHA-256 fingerprint if a single character is modified', () => {
      const backup = backupService.exportBackup();
      const serialized = JSON.stringify(backup);

      // Modify a character inside the data payload
      const tamperedSerialized = serialized.replace('"hubs":{', '"hubs":{"tampered":true,');
      const tamperedObj = JSON.parse(tamperedSerialized);

      const verification = backupService.verifyBackup(tamperedObj);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('checksum mismatch');

      const restoreRes = backupService.restoreBackup(tamperedObj);
      expect(restoreRes.success).toBe(false);
      expect(restoreRes.error).toContain('checksum mismatch');
    });
  });
});
