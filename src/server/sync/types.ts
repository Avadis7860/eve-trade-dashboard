import type { EsiCompleteness } from '../esi/types.ts';

/**
 * Sync domain types and contracts
 */

export type SyncResourceType =
  | 'wallet_transactions'
  | 'wallet_journal'
  | 'character_orders'
  | 'character_assets'
  | 'corporation_assets'
  | 'character_wallet'
  | 'corporation_wallets';

export type SyncStatusState = 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN' | 'ABSENT';

export interface SyncState {
  characterId: number;
  resource: SyncResourceType;
  status: SyncStatusState;
  coverageStatus?: EsiCompleteness;
  hasMore?: boolean;
  lastSyncStartedAt?: number;
  lastSyncCompletedAt?: number;
  lastSuccessfulId?: number; // Cursor from_id for transactions pagination
  lastPage?: number; // Cursor page for x-pages pagination
  totalRecords: number;
  newRecordsInLastSync: number;
  itemsCount?: number;
  errorMessage?: string;
  asOf: number;
}

export interface FullCharacterSyncStatus {
  characterId: number;
  transactions: SyncState;
  journal: SyncState;
  orders: SyncState;
  assets?: SyncState;
  wallet?: SyncState;
  asOf: number;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

export interface SyncResult {
  resource: SyncResourceType;
  characterId: number;
  status: SyncStatusState;
  coverageStatus?: EsiCompleteness;
  hasMore?: boolean;
  itemsFetched: number;
  newItemsPersisted: number;
  totalPersisted: number;
  lastSuccessfulId?: number;
  lastPage?: number;
  durationMs: number;
  error?: string;
  asOf: number;
}

export interface SyncAllResult {
  transactions: SyncResult;
  journal: SyncResult;
  orders: SyncResult;
  assets: SyncResult;
  wallet?: SyncResult;
  corpWallets?: SyncResult;
  corpAssets?: SyncResult;
}
