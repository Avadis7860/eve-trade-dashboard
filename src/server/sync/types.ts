/**
 * Sync domain types and contracts
 */

export type SyncResourceType = 'wallet_transactions' | 'wallet_journal' | 'character_orders';

export type SyncStatusState = 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN' | 'ABSENT';

export interface SyncState {
  characterId: number;
  resource: SyncResourceType;
  status: SyncStatusState;
  lastSyncStartedAt?: number;
  lastSyncCompletedAt?: number;
  lastSuccessfulId?: number; // Cursor from_id for transactions pagination
  lastPage?: number; // Cursor page for x-pages pagination
  totalRecords: number;
  newRecordsInLastSync: number;
  errorMessage?: string;
  asOf: number;
}

export interface FullCharacterSyncStatus {
  characterId: number;
  transactions: SyncState;
  journal: SyncState;
  orders: SyncState;
  asOf: number;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

export interface SyncResult {
  resource: SyncResourceType;
  characterId: number;
  status: SyncStatusState;
  itemsFetched: number;
  newItemsPersisted: number;
  totalPersisted: number;
  lastSuccessfulId?: number;
  durationMs: number;
  error?: string;
  asOf: number;
}
