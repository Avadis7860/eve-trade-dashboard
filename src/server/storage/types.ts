import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import type { CharacterOrderSnapshot, RestockItem } from '../orders/types.ts';
import type { HubDefinition, HubLocationMapping } from '../hubs/types.ts';
import type { ExplicitCostAllocation } from '../roi/types.ts';
import type { CharacterAsset } from '../assets/types.ts';
import type { SyncState } from '../sync/types.ts';

export interface AppBackupData {
  ledger: {
    transactions: CharacterTransaction[];
    journalEntries: CharacterWalletJournalEntry[];
  };
  orders: {
    snapshots: CharacterOrderSnapshot[];
    restockItems: RestockItem[];
  };
  hubs: {
    definitions: HubDefinition[];
    mappings: HubLocationMapping[];
  };
  roi: {
    allocations: ExplicitCostAllocation[];
  };
  assets: {
    assets: CharacterAsset[];
  };
  sync: {
    states: SyncState[];
  };
}

export interface AppBackupSnapshot {
  schemaVersion: number;
  exportedAt: string;
  checksum: string;
  data: AppBackupData;
}

export interface DataIntegrityIssue {
  level: 'ERROR' | 'WARNING';
  category: 'LEDGER' | 'ORDERS' | 'ROI' | 'ASSETS' | 'HUBS' | 'SYNC';
  message: string;
  entityId?: string | number;
}

export interface DataIntegrityReport {
  status: 'HEALTHY' | 'WARNING' | 'CORRUPTED';
  checkedAt: string;
  summary: {
    totalTransactions: number;
    totalJournalEntries: number;
    totalOrders: number;
    totalRestockItems: number;
    totalHubs: number;
    totalMappings: number;
    totalAllocations: number;
    totalAssets: number;
    issuesCount: number;
  };
  issues: DataIntegrityIssue[];
}
