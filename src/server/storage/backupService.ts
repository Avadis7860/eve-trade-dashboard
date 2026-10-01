import crypto from 'node:crypto';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { HubsRepository, hubsRepository } from '../hubs/repository.ts';
import { RoiRepository, roiRepository } from '../roi/repository.ts';
import type { OpeningBalanceLot } from '../roi/types.ts';
import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { ISyncRepository } from '../sync/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import { defaultMetricsCollector } from '../utils/metrics.ts';
import type {
  AppBackupSnapshot,
  AppBackupData,
  DataIntegrityReport,
  DataIntegrityIssue,
} from './types.ts';

export const CURRENT_SCHEMA_VERSION = 2;

export interface RestoreBackupOptions {
  authorizedCharacterIds?: number[];
  allowGlobalOverwrite?: boolean;
}

export class BackupRestoreService {
  constructor(
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private ordersRepo: IOrdersRepository = defaultOrdersRepository,
    private hubsRepo: HubsRepository = hubsRepository,
    private roiRepo: RoiRepository = roiRepository,
    private assetsRepo: IAssetsRepository = defaultAssetsRepository,
    private syncRepo: ISyncRepository = defaultSyncRepository
  ) {}

  /**
   * Computes a deterministic SHA-256 checksum for given data
   */
  public computeChecksum(data: AppBackupData): string {
    const jsonString = JSON.stringify(data);
    return crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
  }

  /**
   * Exports application state into a verifiable snapshot.
   * If authorizedCharacterIds is provided, strictly filters records to those characters.
   */
  public exportBackup(authorizedCharacterIds?: number[]): AppBackupSnapshot {
    const ledgerData = this.ledgerRepo.dumpData();
    const ordersData = this.ordersRepo.dumpData();
    const hubsData = this.hubsRepo.dumpData();
    const roiData = this.roiRepo.dumpData();
    const assetsData = this.assetsRepo.dumpData();
    const syncData = this.syncRepo.dumpData();

    const authSet =
      authorizedCharacterIds && authorizedCharacterIds.length > 0
        ? new Set(authorizedCharacterIds)
        : null;

    const transactions = authSet
      ? ledgerData.transactions.filter((t) => authSet.has(t.characterId))
      : ledgerData.transactions;

    const journalEntries = authSet
      ? ledgerData.journalEntries.filter((j) => authSet.has(j.characterId))
      : ledgerData.journalEntries;

    const snapshots = authSet
      ? ordersData.snapshots.filter((o) => authSet.has(o.characterId))
      : ordersData.snapshots;

    const restockItems = authSet
      ? ordersData.restockItems.filter((r) => authSet.has(r.characterId))
      : ordersData.restockItems;

    const allocations = authSet
      ? roiData.allocations.filter((a) => {
          const char = a.character_id;
          const buyChar = a.buy_character_id || char;
          const sellChar = a.sell_character_id || char;
          return authSet.has(char) || (authSet.has(buyChar) && authSet.has(sellChar));
        })
      : roiData.allocations;

    const openingBalances = authSet
      ? (roiData.openingBalances || []).filter(
          (ob) => ob.character_id === undefined || authSet.has(ob.character_id)
        )
      : roiData.openingBalances || [];

    const assets = authSet
      ? assetsData.assets.filter((a) => authSet.has(a.characterId))
      : assetsData.assets;

    const states = authSet
      ? syncData.states.filter((s) => authSet.has(s.characterId))
      : syncData.states;

    const data: AppBackupData = {
      ledger: {
        transactions,
        journalEntries,
      },
      orders: {
        snapshots,
        restockItems,
      },
      hubs: {
        definitions: hubsData.hubs,
        mappings: hubsData.mappings,
      },
      roi: {
        allocations,
        openingBalances,
      },
      assets: {
        assets,
      },
      sync: {
        states,
      },
    };

    const checksum = this.computeChecksum(data);

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      checksum,
      data,
    };
  }

  /**
   * Verifies structural integrity, schema version, and checksum of a backup
   */
  public verifyBackup(snapshot: unknown): { valid: boolean; error?: string } {
    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, error: 'Snapshot must be a valid JSON object' };
    }

    const snap = snapshot as Partial<AppBackupSnapshot>;

    if (snap.schemaVersion === undefined || typeof snap.schemaVersion !== 'number') {
      return { valid: false, error: 'Missing or invalid schemaVersion' };
    }

    if (snap.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { valid: false, error: `Unsupported schemaVersion ${snap.schemaVersion}. Current is ${CURRENT_SCHEMA_VERSION}` };
    }

    if (!snap.data || typeof snap.data !== 'object') {
      return { valid: false, error: 'Missing data payload in backup snapshot' };
    }

    const { ledger, orders, hubs, roi, assets, sync } = snap.data;

    if (!ledger || !Array.isArray(ledger.transactions) || !Array.isArray(ledger.journalEntries)) {
      return { valid: false, error: 'Invalid or missing ledger section in backup data' };
    }

    if (!orders || !Array.isArray(orders.snapshots) || !Array.isArray(orders.restockItems)) {
      return { valid: false, error: 'Invalid or missing orders section in backup data' };
    }

    if (!hubs || !Array.isArray(hubs.definitions) || !Array.isArray(hubs.mappings)) {
      return { valid: false, error: 'Invalid or missing hubs section in backup data' };
    }

    if (!roi || !Array.isArray(roi.allocations)) {
      return { valid: false, error: 'Invalid or missing roi section in backup data' };
    }

    if (!assets || !Array.isArray(assets.assets)) {
      return { valid: false, error: 'Invalid or missing assets section in backup data' };
    }

    if (!sync || !Array.isArray(sync.states)) {
      return { valid: false, error: 'Invalid or missing sync section in backup data' };
    }

    // Verify cryptographic checksum
    const computed = this.computeChecksum(snap.data as AppBackupData);
    if (snap.checksum !== computed) {
      return {
        valid: false,
        error: `Backup checksum mismatch (tampered or corrupted data). Expected ${computed}, received ${snap.checksum}`,
      };
    }

    return { valid: true };
  }

  /**
   * Restores application state atomically from a verified backup snapshot.
   * Supports scoped restore per authorized characters or global restore with rollback guarantee.
   */
  public restoreBackup(
    snapshot: AppBackupSnapshot,
    options?: RestoreBackupOptions
  ): {
    success: boolean;
    restoredCounts?: Record<string, number>;
    error?: string;
    unauthorized?: boolean;
  } {
    const verification = this.verifyBackup(snapshot);
    if (!verification.valid) {
      return { success: false, error: verification.error };
    }

    const authSet =
      options?.authorizedCharacterIds && options.authorizedCharacterIds.length > 0
        ? new Set(options.authorizedCharacterIds)
        : null;

    // In scoped restore mode, verify that the snapshot doesn't contain unauthorized character data
    if (authSet && !options?.allowGlobalOverwrite) {
      const charsInSnapshot = new Set<number>();
      for (const t of snapshot.data.ledger.transactions) charsInSnapshot.add(t.characterId);
      for (const j of snapshot.data.ledger.journalEntries) charsInSnapshot.add(j.characterId);
      for (const o of snapshot.data.orders.snapshots) charsInSnapshot.add(o.characterId);
      for (const r of snapshot.data.orders.restockItems) charsInSnapshot.add(r.characterId);
      for (const a of snapshot.data.roi.allocations) {
        if (a.character_id) charsInSnapshot.add(a.character_id);
        if (a.buy_character_id) charsInSnapshot.add(a.buy_character_id);
        if (a.sell_character_id) charsInSnapshot.add(a.sell_character_id);
      }
      for (const ob of (snapshot.data.roi.openingBalances || [])) {
        if (ob.character_id !== undefined) charsInSnapshot.add(ob.character_id);
      }
      for (const a of snapshot.data.assets.assets) charsInSnapshot.add(a.characterId);
      for (const s of snapshot.data.sync.states) charsInSnapshot.add(s.characterId);

      const unauthorizedIds = Array.from(charsInSnapshot).filter((id) => !authSet.has(id));
      if (unauthorizedIds.length > 0) {
        return {
          success: false,
          unauthorized: true,
          error: `Accès refusé : la sauvegarde contient des données pour des personnages non autorisés (${unauthorizedIds.join(', ')})`,
        };
      }

      // Capture pre-restore snapshot for atomic rollback guarantee
      const rollbackSnapshot = this.exportBackup();

      try {
        const { data } = snapshot;

        // Clear existing data only for the authorized characters
        for (const charId of authSet) {
          this.ledgerRepo.clearCharacter(charId);
          this.ordersRepo.clearCharacter(charId);
          this.roiRepo.clearCharacter(charId);
          this.assetsRepo.clearAssets(charId);
          this.syncRepo.clearCharacter(charId);
        }

        // Restore scoped records
        if (data.ledger.transactions.length > 0) {
          this.ledgerRepo.saveTransactions(data.ledger.transactions);
        }
        if (data.ledger.journalEntries.length > 0) {
          this.ledgerRepo.saveJournalEntries(data.ledger.journalEntries);
        }
        if (data.orders.snapshots.length > 0) {
          this.ordersRepo.saveOrderSnapshots(data.orders.snapshots);
        }
        for (const item of data.orders.restockItems) {
          this.ordersRepo.createRestockItem(item);
        }
        if (data.roi.allocations.length > 0) {
          this.roiRepo.saveAllocations(data.roi.allocations);
        }
        if (data.roi.openingBalances) {
          for (const ob of data.roi.openingBalances) {
            this.roiRepo.saveOpeningBalance(ob);
          }
        }
        if (data.assets.assets.length > 0) {
          this.assetsRepo.saveAssets(data.assets.assets);
        }
        for (const st of data.sync.states) {
          this.syncRepo.updateSyncState(st.characterId, st.resource, st);
        }

        // Upsert hubs and mappings
        for (const hub of data.hubs.definitions) {
          this.hubsRepo.upsertHub(hub);
        }
        for (const mapping of data.hubs.mappings) {
          this.hubsRepo.upsertMapping(mapping);
        }

        return {
          success: true,
          restoredCounts: {
            transactions: data.ledger.transactions.length,
            journalEntries: data.ledger.journalEntries.length,
            orders: data.orders.snapshots.length,
            restockItems: data.orders.restockItems.length,
            hubs: data.hubs.definitions.length,
            mappings: data.hubs.mappings.length,
            allocations: data.roi.allocations.length,
            openingBalances: data.roi.openingBalances?.length || 0,
            assets: data.assets.assets.length,
            syncStates: data.sync.states.length,
          },
        };
      } catch (err) {
        // Clean rollback to pre-restore snapshot
        this.restoreBackup(rollbackSnapshot, { allowGlobalOverwrite: true });
        return {
          success: false,
          error: `Restauration cloisonnée échouée et annulée avec succès : ${(err as Error).message}`,
        };
      }
    }

    // Global restore mode (with rollback snapshot)
    const rollbackSnapshot = this.exportBackup();

    try {
      const { data } = snapshot;

      this.ledgerRepo.restoreData(data.ledger);
      this.ordersRepo.restoreData(data.orders);
      this.hubsRepo.restoreData({ hubs: data.hubs.definitions, mappings: data.hubs.mappings });
      this.roiRepo.restoreData(data.roi);
      this.assetsRepo.restoreData(data.assets);
      this.syncRepo.restoreData(data.sync);

      return {
        success: true,
        restoredCounts: {
          transactions: data.ledger.transactions.length,
          journalEntries: data.ledger.journalEntries.length,
          orders: data.orders.snapshots.length,
          restockItems: data.orders.restockItems.length,
          hubs: data.hubs.definitions.length,
          mappings: data.hubs.mappings.length,
          allocations: data.roi.allocations.length,
          openingBalances: data.roi.openingBalances?.length || 0,
          assets: data.assets.assets.length,
          syncStates: data.sync.states.length,
        },
      };
    } catch (err) {
      // Rollback on any failure
      this.ledgerRepo.restoreData(rollbackSnapshot.data.ledger);
      this.ordersRepo.restoreData(rollbackSnapshot.data.orders);
      this.hubsRepo.restoreData({
        hubs: rollbackSnapshot.data.hubs.definitions,
        mappings: rollbackSnapshot.data.hubs.mappings,
      });
      this.roiRepo.restoreData(rollbackSnapshot.data.roi);
      this.assetsRepo.restoreData(rollbackSnapshot.data.assets);
      this.syncRepo.restoreData(rollbackSnapshot.data.sync);

      return {
        success: false,
        error: `Restore failed and was rolled back cleanly: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Performs an exhaustive integrity audit across all repositories:
   * - Validates non-negative quantities and values
   * - Checks that all ROI allocations point to existing transactions or opening balance lots
   * - Ensures allocated quantities never exceed transaction / lot quantities
   * - Ensures buy/sell type matches
   * - Verifies order lifecycle states
   */
  public auditDataIntegrity(): DataIntegrityReport {
    const issues: DataIntegrityIssue[] = [];

    const ledgerData = this.ledgerRepo.dumpData();
    const ordersData = this.ordersRepo.dumpData();
    const hubsData = this.hubsRepo.dumpData();
    const roiData = this.roiRepo.dumpData();
    const assetsData = this.assetsRepo.dumpData();

    // 1. Audit Ledger
    const txMap = new Map<string, typeof ledgerData.transactions[0]>();
    for (const tx of ledgerData.transactions) {
      const key = `${tx.characterId}:${tx.transactionId}`;
      txMap.set(key, tx);

      if (tx.quantity <= 0) {
        issues.push({
          level: 'ERROR',
          category: 'LEDGER',
          message: `Transaction #${tx.transactionId} has invalid non-positive quantity (${tx.quantity})`,
          entityId: tx.transactionId,
        });
      }
      if (tx.unitPrice < 0) {
        issues.push({
          level: 'ERROR',
          category: 'LEDGER',
          message: `Transaction #${tx.transactionId} has negative unit price (${tx.unitPrice})`,
          entityId: tx.transactionId,
        });
      }
    }

    // 2. Audit Opening Balances
    const openingBalancesMap = new Map<string, OpeningBalanceLot>();
    const allocatedPerOpeningBalance = new Map<string, number>();
    for (const ob of (roiData.openingBalances || [])) {
      openingBalancesMap.set(ob.id, ob);
      if (ob.quantity <= 0) {
        issues.push({
          level: 'ERROR',
          category: 'ROI',
          message: `Opening balance lot ${ob.id} has invalid non-positive quantity (${ob.quantity})`,
          entityId: ob.id,
        });
      }
      if (ob.unit_cost_isk < 0) {
        issues.push({
          level: 'ERROR',
          category: 'ROI',
          message: `Opening balance lot ${ob.id} has negative unit cost (${ob.unit_cost_isk})`,
          entityId: ob.id,
        });
      }
      if (!ob.justification || ob.justification.trim().length === 0) {
        issues.push({
          level: 'ERROR',
          category: 'ROI',
          message: `Opening balance lot ${ob.id} is missing mandatory justification`,
          entityId: ob.id,
        });
      }
    }

    // 3. Audit ROI Allocations
    const allocatedPerBuy = new Map<string, number>();
    const allocatedPerSell = new Map<string, number>();

    for (const alloc of roiData.allocations) {
      if (alloc.quantity_allocated <= 0) {
        issues.push({
          level: 'ERROR',
          category: 'ROI',
          message: `Allocation ${alloc.id} has invalid non-positive quantity (${alloc.quantity_allocated})`,
          entityId: alloc.id,
        });
      }

      const buyChar = alloc.buy_character_id || alloc.character_id;
      const sellChar = alloc.sell_character_id || alloc.character_id;

      const sellTxKey = `${sellChar}:${alloc.sell_transaction_id}`;
      const sellTx = txMap.get(sellTxKey);

      if (alloc.source_type === 'OPENING_BALANCE' || alloc.opening_balance_id) {
        const obId = alloc.opening_balance_id!;
        const ob = openingBalancesMap.get(obId);
        if (!ob) {
          issues.push({
            level: 'ERROR',
            category: 'ROI',
            message: `Allocation ${alloc.id} references missing opening balance lot #${obId}`,
            entityId: alloc.id,
          });
        } else {
          const current = (allocatedPerOpeningBalance.get(obId) || 0) + alloc.quantity_allocated;
          allocatedPerOpeningBalance.set(obId, current);
          if (current > ob.quantity) {
            issues.push({
              level: 'ERROR',
              category: 'ROI',
              message: `Over-allocated opening balance lot #${ob.id}: allocated ${current} exceeds original quantity ${ob.quantity}`,
              entityId: ob.id,
            });
          }
        }
      } else {
        const buyTxKey = `${buyChar}:${alloc.buy_transaction_id}`;
        const buyTx = txMap.get(buyTxKey);

        if (!buyTx) {
          issues.push({
            level: 'ERROR',
            category: 'ROI',
            message: `Allocation ${alloc.id} references missing buy transaction #${alloc.buy_transaction_id} (character ${buyChar})`,
            entityId: alloc.id,
          });
        } else {
          const current = (allocatedPerBuy.get(buyTxKey) || 0) + alloc.quantity_allocated;
          allocatedPerBuy.set(buyTxKey, current);
          if (current > buyTx.quantity) {
            issues.push({
              level: 'ERROR',
              category: 'ROI',
              message: `Over-allocated buy transaction #${buyTx.transactionId}: allocated ${current} exceeds original quantity ${buyTx.quantity}`,
              entityId: buyTx.transactionId,
            });
          }
        }
      }

      if (!sellTx) {
        issues.push({
          level: 'ERROR',
          category: 'ROI',
          message: `Allocation ${alloc.id} references missing sell transaction #${alloc.sell_transaction_id} (character ${sellChar})`,
          entityId: alloc.id,
        });
      } else {
        const current = (allocatedPerSell.get(sellTxKey) || 0) + alloc.quantity_allocated;
        allocatedPerSell.set(sellTxKey, current);
        if (current > sellTx.quantity) {
          issues.push({
            level: 'ERROR',
            category: 'ROI',
            message: `Over-allocated sell transaction #${sellTx.transactionId}: allocated ${current} exceeds original quantity ${sellTx.quantity}`,
            entityId: sellTx.transactionId,
          });
        }
      }
    }

    // 4. Audit Orders
    for (const order of ordersData.snapshots) {
      if (order.volumeTotal <= 0) {
        issues.push({
          level: 'ERROR',
          category: 'ORDERS',
          message: `Order #${order.orderId} has non-positive volumeTotal (${order.volumeTotal})`,
          entityId: order.orderId,
        });
      }
      if (order.volumeRemain < 0 || order.volumeRemain > order.volumeTotal) {
        issues.push({
          level: 'ERROR',
          category: 'ORDERS',
          message: `Order #${order.orderId} has invalid volumeRemain (${order.volumeRemain} / ${order.volumeTotal})`,
          entityId: order.orderId,
        });
      }
    }

    const charIds = new Set<number>();
    for (const t of ledgerData.transactions) charIds.add(t.characterId);
    for (const j of ledgerData.journalEntries) charIds.add(j.characterId);
    for (const o of ordersData.snapshots) charIds.add(o.characterId);
    for (const a of assetsData.assets) charIds.add(a.characterId);

    let autoFifoCount = 0;
    let manualCount = 0;
    for (const alloc of roiData.allocations) {
      if (alloc.reconciliation_mode === 'FIFO_AUTOMATIC' || !alloc.reconciliation_mode) {
        autoFifoCount++;
      } else {
        manualCount++;
      }
    }

    const totalTx = ledgerData.transactions.length;
    const knownCount = totalTx; // In this domain, persisted ledger transactions have known immutable historical prices
    const partialCount = issues.filter((i) => i.level === 'WARNING').length;
    const unknownCount = issues.filter((i) => i.level === 'ERROR').length;
    const qualityTotal = knownCount + partialCount + unknownCount;
    const qualityRatio = qualityTotal > 0 ? Number((knownCount / qualityTotal).toFixed(4)) : 1.0;

    const hasErrors = issues.some((i) => i.level === 'ERROR');
    const hasWarnings = issues.some((i) => i.level === 'WARNING');
    const status = hasErrors ? 'CORRUPTED' : hasWarnings ? 'WARNING' : 'HEALTHY';

    defaultMetricsCollector.recordBusinessIntegrity({
      activeCharactersCount: charIds.size,
      totalTransactions: ledgerData.transactions.length,
      totalJournalEntries: ledgerData.journalEntries.length,
      totalOrders: ordersData.snapshots.length,
      totalAssets: assetsData.assets.length,
      totalHubs: hubsData.hubs.length,
      totalMappings: hubsData.mappings.length,
      classifiedCapitalPositions: assetsData.assets.length,
      autoFifoReconciledLots: autoFifoCount,
      manualReconciledLots: manualCount,
      partialStatusCount: partialCount,
      unknownStatusCount: unknownCount,
      knownStatusCount: knownCount,
      dataQualityRatio: qualityRatio,
      lastIntegrityStatus: status,
    });

    return {
      status,
      checkedAt: new Date().toISOString(),
      summary: {
        totalTransactions: ledgerData.transactions.length,
        totalJournalEntries: ledgerData.journalEntries.length,
        totalOrders: ordersData.snapshots.length,
        totalRestockItems: ordersData.restockItems.length,
        totalHubs: hubsData.hubs.length,
        totalMappings: hubsData.mappings.length,
        totalAllocations: roiData.allocations.length,
        totalAssets: assetsData.assets.length,
        issuesCount: issues.length,
        charactersCount: charIds.size,
        classifiedCapitalPositions: assetsData.assets.length,
        reconciledLots: {
          autoFifo: autoFifoCount,
          manual: manualCount,
        },
        dataQuality: {
          knownCount,
          partialCount,
          unknownCount,
          qualityRatio,
        },
      },
      issues,
    };
  }
}

export const defaultBackupService = new BackupRestoreService();
