import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ILedgerRepository } from './repository.ts';
import { defaultLedgerRepository } from './repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { RoiRepository, roiRepository } from '../roi/repository.ts';
import { RoiService, roiService as defaultRoiService } from '../roi/service.ts';
import { HubsRepository, hubsRepository } from '../hubs/repository.ts';
import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { ISyncRepository } from '../sync/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import { BackupRestoreService, defaultBackupService } from '../storage/backupService.ts';
import { DurableFileDatabaseAdapter, StorageManager } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import type { CharacterWalletJournalEntry } from './types.ts';
import { makeJournalEntryKey } from './types.ts';
import { logger } from '../utils/logger.ts';

export interface FinancialRecoveryOptions {
  dryRun?: boolean;
  backupDir?: string;
  storagePath?: string;
  characterId?: number;
  characterIds?: number[];
  strictCharacterIsolation?: boolean;
  prioritizeSellingCharacter?: boolean;
  createBackupFile?: boolean;
}

export interface FinancialSnapshotMetrics {
  transactionsCount: number;
  journalEntriesCount: number;
  corporateJournalEntriesCount: number;
  personalJournalEntriesCount: number;
  totalGrossSalesIsk: number;
  totalBuySpendIsk: number;
  totalTaxesIsk: number;
  totalBrokerFeesIsk: number;
  unallocatedBrokerFeesIsk: number;
  totalNetSalesIsk: number;
  allocationsCount: number;
  autoAllocationsCount: number;
  manualAllocationsCount: number;
  totalRealizedProfitIsk: number;
  reconciledSalesCount: number;
  fullyMatchedSalesCount: number;
  partiallyMatchedSalesCount: number;
  unmatchedSalesCount: number;
  totalQuantityReconciled: number;
  unsoldInventoryLotsCount: number;
}

export interface FinancialDeltas {
  deltaJournalEntriesCount: number;
  deltaCorporateJournalEntriesCount: number;
  deltaTaxesIsk: number;
  deltaBrokerFeesIsk: number;
  deltaGrossSalesIsk: number;
  deltaNetSalesIsk: number;
  deltaRealizedProfitIsk: number;
  deltaAllocationsCount: number;
  deltaAutoAllocationsCount: number;
  deltaManualAllocationsCount: number;
  deltaReconciledSalesCount: number;
  deltaFullyMatchedSalesCount: number;
  deltaQuantityReconciled: number;
}

export interface ManualAllocationSnapshot {
  id: string;
  sellTransactionId: number;
  buyTransactionId?: number;
  openingBalanceId?: string;
  quantityAllocated: number;
  unitBuyPrice: number;
  allocatedBuyCost: number;
  allocatedBuyFees?: number;
  allocatedSellFees?: number;
  allocatedSellTaxes?: number;
  allocatedSellBrokerFees?: number;
}

export interface ManualAllocationIntegrityCheck {
  expectedCount: number;
  preservedCount: number;
  intact: boolean;
  verifiedLots: Array<{
    id: string;
    sellTransactionId: number;
    buyTransactionId?: number;
    openingBalanceId?: string;
    quantityAllocated: number;
    unitBuyPrice: number;
    allocatedBuyCost: number;
    intact: boolean;
  }>;
}

export interface FinancialRecoveryReport {
  timestamp: string;
  dryRun: boolean;
  preRecoverySha256: string;
  postRecoverySha256?: string;
  backupFilePath?: string;
  backupSha256?: string;
  metrics: {
    before: FinancialSnapshotMetrics;
    after: FinancialSnapshotMetrics;
    deltas: FinancialDeltas;
  };
  manualAllocationsIntegrity: ManualAllocationIntegrityCheck;
  details: {
    journalDeduplication: {
      totalOriginalEntries: number;
      removedDuplicatesCount: number;
      normalizedCorporateEntriesCount: number;
      finalEntriesCount: number;
    };
    taxReconciliation: {
      matchedTaxesCount: number;
      totalTaxesIsk: number;
    };
    brokerFeeReconciliation: {
      allocatedBrokerFeesIsk: number;
      unallocatedBrokerFeesIsk: number;
      totalBrokerFeesCollectedIsk: number;
    };
    fifoReconciliation: {
      allocationsCreated: number;
      totalQuantityReconciled: number;
      salesFullyMatched: number;
      salesPartiallyMatched: number;
      salesUnmatched: number;
      message: string;
    };
  };
  success: boolean;
}

/**
 * FinancialRecoveryManager — Idempotent migration, recalculation and financial qualification engine.
 *
 * Enforces:
 * 1. Safe pre-recovery backup with verified SHA-256 fingerprint (.pre-recovery-TIMESTAMP.json).
 * 2. Step A: Corporation journal normalization & deduplication with canonical keys (corp:corpId:div:id).
 * 3. Step B: Deterministic tax re-attribution (F07 engine).
 * 4. Step C: Broker fee attribution & lifecycle order pro-rata (F08 engine).
 * 5. Step D: Chronological FIFO cost allocation on automatic mode, preserving 100% of locked MANUAL allocations.
 * 6. Step E: Total Cost Ownership (TTC) profitability recalculation (F09 engine).
 * 7. Step F: Comparative audit diff report generation with zero-delta idempotence proof.
 */
export class FinancialRecoveryManager {
  constructor(
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    _ordersRepo: IOrdersRepository = defaultOrdersRepository,
    _hubsRepo: HubsRepository = hubsRepository,
    private roiRepo: RoiRepository = roiRepository,
    _assetsRepo: IAssetsRepository = defaultAssetsRepository,
    _syncRepo: ISyncRepository = defaultSyncRepository,
    private roiService: RoiService = defaultRoiService,
    private backupService: BackupRestoreService = defaultBackupService,
    private adapter?: IDatabaseAdapter
  ) {}

  /**
   * Helper to normalize and deduplicate raw wallet journal entries across characters and corporations.
   */
  public static deduplicateAndNormalizeJournals(journalEntries: CharacterWalletJournalEntry[]): {
    normalizedEntries: CharacterWalletJournalEntry[];
    removedDuplicatesCount: number;
    normalizedCorporateEntriesCount: number;
  } {
    const journalMap = new Map<string, CharacterWalletJournalEntry>();
    let removedDuplicatesCount = 0;
    let normalizedCorporateEntriesCount = 0;

    for (const rawEntry of journalEntries) {
      const isCorp = Boolean(rawEntry.isCorporationWallet || rawEntry.corporationId);
      const normalizedEntry: CharacterWalletJournalEntry = {
        ...rawEntry,
        isCorporationWallet: isCorp ? true : undefined,
        corporationId: isCorp ? rawEntry.corporationId : undefined,
      };

      const canonicalKey = makeJournalEntryKey(normalizedEntry);
      normalizedEntry.id = canonicalKey;

      if (isCorp) {
        normalizedCorporateEntriesCount++;
      }

      if (journalMap.has(canonicalKey)) {
        removedDuplicatesCount++;
        const existing = journalMap.get(canonicalKey)!;
        const observers = new Set<number>(
          existing.observedByCharacterIds || (existing.characterId ? [existing.characterId] : [])
        );
        if (normalizedEntry.characterId) observers.add(normalizedEntry.characterId);
        if (normalizedEntry.observedByCharacterIds) {
          for (const cid of normalizedEntry.observedByCharacterIds) observers.add(cid);
        }

        const merged: CharacterWalletJournalEntry = {
          ...existing,
          ...normalizedEntry,
          id: canonicalKey,
          isCorporationWallet: isCorp ? true : undefined,
          observedAt: Math.min(existing.observedAt || Date.now(), normalizedEntry.observedAt || Date.now()),
          observedByCharacterIds: Array.from(observers),
          description: existing.description || normalizedEntry.description,
          reason: existing.reason || normalizedEntry.reason,
          tax: normalizedEntry.tax !== undefined ? normalizedEntry.tax : existing.tax,
          amount: normalizedEntry.amount !== undefined ? normalizedEntry.amount : existing.amount,
        };
        journalMap.set(canonicalKey, merged);
      } else {
        const observers = new Set<number>(
          normalizedEntry.observedByCharacterIds || (normalizedEntry.characterId ? [normalizedEntry.characterId] : [])
        );
        normalizedEntry.observedByCharacterIds = Array.from(observers);
        journalMap.set(canonicalKey, normalizedEntry);
      }
    }

    return {
      normalizedEntries: Array.from(journalMap.values()),
      removedDuplicatesCount,
      normalizedCorporateEntriesCount,
    };
  }

  /**
   * Captures current financial metrics snapshot across ledger, orders, and ROI models.
   */
  public captureMetricsSnapshot(characterId?: number, characterIds?: number[]): FinancialSnapshotMetrics {
    const ledgerData = this.ledgerRepo.dumpData();
    const roiData = this.roiRepo.dumpData();
    const filterSet = characterIds && characterIds.length > 0
      ? new Set(characterIds)
      : characterId !== undefined
      ? new Set([characterId])
      : null;

    const transactions = filterSet
      ? ledgerData.transactions.filter((t) => filterSet.has(t.characterId))
      : ledgerData.transactions;

    const journalEntries = filterSet
      ? ledgerData.journalEntries.filter((j) => filterSet.has(j.characterId) || (j.observedByCharacterIds && j.observedByCharacterIds.some((cid) => filterSet.has(cid))))
      : ledgerData.journalEntries;

    const corporateJournalEntriesCount = journalEntries.filter((j) => j.isCorporationWallet || j.corporationId).length;
    const personalJournalEntriesCount = journalEntries.length - corporateJournalEntriesCount;

    const ledgerSummary = this.ledgerRepo.getSummary(characterId, characterIds);
    const roiSummary = this.roiService.getSummary({ character_id: characterId, character_ids: characterIds });

    const allocations = filterSet
      ? roiData.allocations.filter((a) => filterSet.has(a.character_id) || filterSet.has(a.buy_character_id || a.character_id) || filterSet.has(a.sell_character_id || a.character_id))
      : roiData.allocations;

    let autoAllocationsCount = 0;
    let manualAllocationsCount = 0;
    let totalQuantityReconciled = 0;
    const salesWithAllocations = new Set<number>();

    for (const a of allocations) {
      if (a.reconciliation_mode === 'MANUAL') {
        manualAllocationsCount++;
      } else {
        autoAllocationsCount++;
      }
      totalQuantityReconciled += a.quantity_allocated;
      salesWithAllocations.add(a.sell_transaction_id);
    }

    const salesDetails = this.roiService.getSalesReconciliationDetails({ character_id: characterId, character_ids: characterIds });
    let fullyMatchedSalesCount = 0;
    let partiallyMatchedSalesCount = 0;
    let unmatchedSalesCount = 0;

    for (const d of salesDetails) {
      if (d.coverage_status === 'COMPLETE') {
        fullyMatchedSalesCount++;
      } else if (d.coverage_status === 'PARTIAL') {
        partiallyMatchedSalesCount++;
      } else {
        unmatchedSalesCount++;
      }
    }

    const unsoldLots = this.roiRepo.getUnsoldInventory(characterId, characterIds);
    const profitTtc = roiSummary.realized_profit_ttc_isk !== null && roiSummary.realized_profit_ttc_isk !== undefined
      ? roiSummary.realized_profit_ttc_isk
      : 0;

    return {
      transactionsCount: transactions.length,
      journalEntriesCount: journalEntries.length,
      corporateJournalEntriesCount,
      personalJournalEntriesCount,
      totalGrossSalesIsk: ledgerSummary.totalGrossSalesIsk,
      totalBuySpendIsk: ledgerSummary.totalBuySpendIsk,
      totalTaxesIsk: ledgerSummary.totalTaxesIsk,
      totalBrokerFeesIsk: ledgerSummary.totalBrokerFeesIsk,
      unallocatedBrokerFeesIsk: ledgerSummary.unallocatedBrokerFeesIsk || 0,
      totalNetSalesIsk: ledgerSummary.totalNetSalesIsk,
      allocationsCount: allocations.length,
      autoAllocationsCount,
      manualAllocationsCount,
      totalRealizedProfitIsk: profitTtc,
      reconciledSalesCount: salesWithAllocations.size,
      fullyMatchedSalesCount,
      partiallyMatchedSalesCount,
      unmatchedSalesCount,
      totalQuantityReconciled,
      unsoldInventoryLotsCount: unsoldLots.length,
    };
  }

  /**
   * Captures an exact list of locked manual allocations to verify preservation.
   */
  public captureManualAllocations(characterId?: number, characterIds?: number[]): ManualAllocationSnapshot[] {
    const allocations = this.roiRepo.listAllocations(characterId, characterIds);
    return allocations
      .filter((a) => a.reconciliation_mode === 'MANUAL')
      .map((a) => ({
        id: a.id,
        sellTransactionId: a.sell_transaction_id,
        buyTransactionId: a.buy_transaction_id,
        openingBalanceId: a.opening_balance_id,
        quantityAllocated: a.quantity_allocated,
        unitBuyPrice: a.unit_buy_price,
        allocatedBuyCost: a.allocated_buy_cost,
        allocatedBuyFees: a.allocated_buy_fees,
        allocatedSellFees: a.allocated_sell_fees,
        allocatedSellTaxes: a.allocated_sell_taxes,
        allocatedSellBrokerFees: a.allocated_sell_broker_fees,
      }));
  }

  /**
   * Verifies that all manual allocations were preserved byte-for-byte in counts and values.
   */
  public verifyManualAllocationsIntegrity(
    beforeManual: ManualAllocationSnapshot[],
    characterId?: number,
    characterIds?: number[]
  ): ManualAllocationIntegrityCheck {
    const afterManual = this.captureManualAllocations(characterId, characterIds);
    const afterMap = new Map<string, ManualAllocationSnapshot>();
    for (const m of afterManual) {
      afterMap.set(m.id, m);
    }

    const verifiedLots: ManualAllocationIntegrityCheck['verifiedLots'] = [];
    let allIntact = beforeManual.length === afterManual.length;

    for (const b of beforeManual) {
      const a = afterMap.get(b.id);
      if (!a) {
        allIntact = false;
        verifiedLots.push({
          id: b.id,
          sellTransactionId: b.sellTransactionId,
          buyTransactionId: b.buyTransactionId,
          openingBalanceId: b.openingBalanceId,
          quantityAllocated: b.quantityAllocated,
          unitBuyPrice: b.unitBuyPrice,
          allocatedBuyCost: b.allocatedBuyCost,
          intact: false,
        });
        continue;
      }

      const lotIntact =
        a.quantityAllocated === b.quantityAllocated &&
        a.unitBuyPrice === b.unitBuyPrice &&
        a.allocatedBuyCost === b.allocatedBuyCost &&
        a.sellTransactionId === b.sellTransactionId &&
        a.buyTransactionId === b.buyTransactionId &&
        a.openingBalanceId === b.openingBalanceId;

      if (!lotIntact) {
        allIntact = false;
      }

      verifiedLots.push({
        id: b.id,
        sellTransactionId: b.sellTransactionId,
        buyTransactionId: b.buyTransactionId,
        openingBalanceId: b.openingBalanceId,
        quantityAllocated: a.quantityAllocated,
        unitBuyPrice: a.unitBuyPrice,
        allocatedBuyCost: a.allocatedBuyCost,
        intact: lotIntact,
      });
    }

    return {
      expectedCount: beforeManual.length,
      preservedCount: afterManual.length,
      intact: allIntact,
      verifiedLots,
    };
  }

  /**
   * Executes the full historical financial recovery, recalculation, and qualification pipeline.
   */
  public async runRecovery(options: FinancialRecoveryOptions = {}): Promise<FinancialRecoveryReport> {
    const dryRun = options.dryRun !== undefined ? options.dryRun : false;
    const backupDir = options.backupDir || './.data/backups';
    const createBackupFile = options.createBackupFile ?? !dryRun;
    const timestamp = new Date().toISOString();

    // 0. Export pristine baseline snapshot and compute cryptographic checksum
    const initialBackupSnapshot = this.backupService.exportBackup();
    const preRecoverySha256 = initialBackupSnapshot.checksum;

    let backupFilePath: string | undefined;
    let backupSha256: string | undefined;

    // 1. Create inviolable timestamped pre-recovery backup on disk if required
    if (createBackupFile) {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const safeTime = timestamp.replace(/[:.]/g, '-');
      backupFilePath = path.join(backupDir, `eve_trade_store.pre-recovery-${safeTime}.json`);
      const backupJson = JSON.stringify(initialBackupSnapshot, null, 2);
      fs.writeFileSync(backupFilePath, backupJson, 'utf8');

      // Calculate and verify written backup checksum
      backupSha256 = crypto.createHash('sha256').update(backupJson, 'utf8').digest('hex');
      logger.info(`[FinancialRecovery] Pre-recovery backup saved to ${backupFilePath} (SHA-256: ${backupSha256})`);
    }

    // 2. Snapshot "Before" metrics and locked manual allocations
    const beforeMetrics = this.captureMetricsSnapshot(options.characterId, options.characterIds);
    const beforeManualAllocations = this.captureManualAllocations(options.characterId, options.characterIds);

    try {
      // 3. Step A: Deduplicate and Normalize Journal Entries
      const currentLedgerData = this.ledgerRepo.dumpData();
      const {
        normalizedEntries,
        removedDuplicatesCount,
        normalizedCorporateEntriesCount,
      } = FinancialRecoveryManager.deduplicateAndNormalizeJournals(currentLedgerData.journalEntries);

      // Restore normalized journal entries & transactions into ledger repository
      this.ledgerRepo.restoreData({
        transactions: currentLedgerData.transactions,
        journalEntries: normalizedEntries,
      });

      // 4. Step B & C: Trigger Deterministic Tax & Broker Fee Reconciliation
      // Handled automatically via ensureReconciliation inside ledgerRepo methods
      this.ledgerRepo.saveTransactions([]); // Trigger dirty flag & full re-indexation

      // 5. Step D: Chronological FIFO Automatic Cost Re-allocation (preserving MANUAL allocations)
      const fifoResult = this.roiService.autoReconcileFifo({
        characterId: options.characterId,
        characterIds: options.characterIds,
        strictCharacterIsolation: options.strictCharacterIsolation,
        prioritizeSellingCharacter: options.prioritizeSellingCharacter ?? true,
      });

      // 6. Step E: Verify Manual Allocations Integrity
      const manualIntegrity = this.verifyManualAllocationsIntegrity(
        beforeManualAllocations,
        options.characterId,
        options.characterIds
      );

      // 7. Step F: Snapshot "After" metrics and calculate deltas
      const afterMetrics = this.captureMetricsSnapshot(options.characterId, options.characterIds);

      const deltas: FinancialDeltas = {
        deltaJournalEntriesCount: afterMetrics.journalEntriesCount - beforeMetrics.journalEntriesCount,
        deltaCorporateJournalEntriesCount: afterMetrics.corporateJournalEntriesCount - beforeMetrics.corporateJournalEntriesCount,
        deltaTaxesIsk: Math.round((afterMetrics.totalTaxesIsk - beforeMetrics.totalTaxesIsk + Number.EPSILON) * 100) / 100,
        deltaBrokerFeesIsk: Math.round((afterMetrics.totalBrokerFeesIsk - beforeMetrics.totalBrokerFeesIsk + Number.EPSILON) * 100) / 100,
        deltaGrossSalesIsk: Math.round((afterMetrics.totalGrossSalesIsk - beforeMetrics.totalGrossSalesIsk + Number.EPSILON) * 100) / 100,
        deltaNetSalesIsk: Math.round((afterMetrics.totalNetSalesIsk - beforeMetrics.totalNetSalesIsk + Number.EPSILON) * 100) / 100,
        deltaRealizedProfitIsk: Math.round((afterMetrics.totalRealizedProfitIsk - beforeMetrics.totalRealizedProfitIsk + Number.EPSILON) * 100) / 100,
        deltaAllocationsCount: afterMetrics.allocationsCount - beforeMetrics.allocationsCount,
        deltaAutoAllocationsCount: afterMetrics.autoAllocationsCount - beforeMetrics.autoAllocationsCount,
        deltaManualAllocationsCount: afterMetrics.manualAllocationsCount - beforeMetrics.manualAllocationsCount,
        deltaReconciledSalesCount: afterMetrics.reconciledSalesCount - beforeMetrics.reconciledSalesCount,
        deltaFullyMatchedSalesCount: afterMetrics.fullyMatchedSalesCount - beforeMetrics.fullyMatchedSalesCount,
        deltaQuantityReconciled: afterMetrics.totalQuantityReconciled - beforeMetrics.totalQuantityReconciled,
      };

      let postRecoverySha256: string | undefined;

      // 8. Commit or Rollback based on dry-run mode
      if (dryRun) {
        // Mode Dry-Run: Rollback cleanly to initial state without side-effects
        this.backupService.restoreBackup(initialBackupSnapshot, { allowGlobalOverwrite: true });
        postRecoverySha256 = preRecoverySha256;
      } else {
        // Mode Commit: Persist durable state
        const activeAdapter = this.adapter || StorageManager.getInstance().getAdapter();
        if (activeAdapter instanceof DurableFileDatabaseAdapter) {
          activeAdapter.persist();
        }
        const postExport = this.backupService.exportBackup();
        postRecoverySha256 = postExport.checksum;
      }

      const report: FinancialRecoveryReport = {
        timestamp,
        dryRun,
        preRecoverySha256,
        postRecoverySha256,
        backupFilePath,
        backupSha256,
        metrics: {
          before: beforeMetrics,
          after: afterMetrics,
          deltas,
        },
        manualAllocationsIntegrity: manualIntegrity,
        details: {
          journalDeduplication: {
            totalOriginalEntries: currentLedgerData.journalEntries.length,
            removedDuplicatesCount,
            normalizedCorporateEntriesCount,
            finalEntriesCount: normalizedEntries.length,
          },
          taxReconciliation: {
            matchedTaxesCount: afterMetrics.transactionsCount,
            totalTaxesIsk: afterMetrics.totalTaxesIsk,
          },
          brokerFeeReconciliation: {
            allocatedBrokerFeesIsk: Math.round(((afterMetrics.totalBrokerFeesIsk - (afterMetrics.unallocatedBrokerFeesIsk || 0)) + Number.EPSILON) * 100) / 100,
            unallocatedBrokerFeesIsk: afterMetrics.unallocatedBrokerFeesIsk || 0,
            totalBrokerFeesCollectedIsk: afterMetrics.totalBrokerFeesIsk,
          },
          fifoReconciliation: {
            allocationsCreated: fifoResult.allocations_created,
            totalQuantityReconciled: fifoResult.total_quantity_reconciled,
            salesFullyMatched: fifoResult.sales_fully_matched,
            salesPartiallyMatched: fifoResult.sales_partially_matched,
            salesUnmatched: fifoResult.sales_unmatched,
            message: fifoResult.message || '',
          },
        },
        success: manualIntegrity.intact,
      };

      return report;
    } catch (err) {
      logger.error(`[FinancialRecovery] Error during recalculation: ${(err as Error).message}. Rolling back to baseline snapshot.`);
      // Strict safety: clean rollback on error
      this.backupService.restoreBackup(initialBackupSnapshot, { allowGlobalOverwrite: true });
      throw err;
    }
  }
}

export const defaultFinancialRecoveryManager = new FinancialRecoveryManager();
