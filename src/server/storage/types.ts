import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import type { CharacterOrderSnapshot, RestockItem } from '../orders/types.ts';
import type { HubDefinition, HubLocationMapping } from '../hubs/types.ts';
import type { ExplicitCostAllocation, OpeningBalanceLot } from '../roi/types.ts';
import type { CharacterAsset } from '../assets/types.ts';
import type { SyncState } from '../sync/types.ts';
import type { WalletBalanceSnapshot } from '../capital/types.ts';

export interface AppBackupData {
  ledger: {
    transactions: CharacterTransaction[];
    journalEntries: CharacterWalletJournalEntry[];
    walletSnapshots?: WalletBalanceSnapshot[];
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
    openingBalances?: OpeningBalanceLot[];
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
  category: 'LEDGER' | 'ORDERS' | 'ROI' | 'ASSETS' | 'HUBS' | 'SYNC' | 'STORAGE';
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
    charactersCount?: number;
    classifiedCapitalPositions?: number;
    reconciledLots?: {
      autoFifo: number;
      manual: number;
    };
    dataQuality?: {
      knownCount: number;
      partialCount: number;
      unknownCount: number;
      qualityRatio: number;
    };
  };
  issues: DataIntegrityIssue[];
}

export interface SchemaMigration {
  version: number;
  name: string;
  upSql: string;
  downSql?: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseAdapter {
  init(): Promise<void> | void;
  close(): Promise<void> | void;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> | QueryResult<T>;
  execute(sql: string, params?: unknown[]): Promise<number> | number;
  transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T> | T): Promise<T> | T;
  getAppliedMigrationVersions(): Promise<number[]> | number[];
  recordMigration(version: number, name?: string): Promise<void> | void;
  clearCharacterData(characterId: number): Promise<void> | void;
  isHealthy(): Promise<boolean> | boolean;
}

export type StorageEngineType = 'postgres' | 'file' | 'memory';

export interface StorageConfig {
  engine: StorageEngineType;
  databaseUrl?: string;
  storagePath?: string;
}
