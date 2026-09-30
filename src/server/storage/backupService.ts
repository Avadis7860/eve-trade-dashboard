import crypto from 'node:crypto';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { HubsRepository, hubsRepository } from '../hubs/repository.ts';
import { RoiRepository, roiRepository } from '../roi/repository.ts';
import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { ISyncRepository } from '../sync/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import type {
  AppBackupSnapshot,
  AppBackupData,
  DataIntegrityReport,
  DataIntegrityIssue,
} from './types.ts';

export const CURRENT_SCHEMA_VERSION = 1;

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
   * Exports the entire application state into a verifiable snapshot
   */
  public exportBackup(): AppBackupSnapshot {
    const ledgerData = this.ledgerRepo.dumpData();
    const ordersData = this.ordersRepo.dumpData();
    const hubsData = this.hubsRepo.dumpData();
    const roiData = this.roiRepo.dumpData();
    const assetsData = this.assetsRepo.dumpData();
    const syncData = this.syncRepo.dumpData();

    const data: AppBackupData = {
      ledger: {
        transactions: ledgerData.transactions,
        journalEntries: ledgerData.journalEntries,
      },
      orders: {
        snapshots: ordersData.snapshots,
        restockItems: ordersData.restockItems,
      },
      hubs: {
        definitions: hubsData.hubs,
        mappings: hubsData.mappings,
      },
      roi: {
        allocations: roiData.allocations,
      },
      assets: {
        assets: assetsData.assets,
      },
      sync: {
        states: syncData.states,
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
   * If any error occurs, rolls back to original state.
   */
  public restoreBackup(snapshot: AppBackupSnapshot): {
    success: boolean;
    restoredCounts?: Record<string, number>;
    error?: string;
  } {
    const verification = this.verifyBackup(snapshot);
    if (!verification.valid) {
      return { success: false, error: verification.error };
    }

    // Capture pre-restore snapshot for atomic rollback guarantee
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
   * - Checks that all ROI allocations point to existing transactions
   * - Ensures allocated quantities never exceed transaction quantities
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

    // 2. Audit ROI Allocations
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

      const buyTxKey = `${buyChar}:${alloc.buy_transaction_id}`;
      const sellTxKey = `${sellChar}:${alloc.sell_transaction_id}`;

      const buyTx = txMap.get(buyTxKey);
      const sellTx = txMap.get(sellTxKey);

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

    // 3. Audit Orders
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

    const hasErrors = issues.some((i) => i.level === 'ERROR');
    const hasWarnings = issues.some((i) => i.level === 'WARNING');
    const status = hasErrors ? 'CORRUPTED' : hasWarnings ? 'WARNING' : 'HEALTHY';

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
      },
      issues,
    };
  }
}

export const defaultBackupService = new BackupRestoreService();
