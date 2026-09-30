import type { SyncState, SyncResourceType, FullCharacterSyncStatus } from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export interface ISyncRepository {
  getSyncState(characterId: number, resource: SyncResourceType): SyncState;
  updateSyncState(characterId: number, resource: SyncResourceType, updates: Partial<SyncState>): SyncState;
  getFullStatus(characterId: number): FullCharacterSyncStatus;
  clearCharacter(characterId: number): void;
  dumpData(): { states: SyncState[] };
  restoreData(data: { states: SyncState[] }): void;
}

export class PersistentSyncRepository implements ISyncRepository {
  private states: Map<string, SyncState> = new Map();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.sync) {
        this.restoreData(state.data.sync, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.sync = {
        states: Array.from(this.states.values()),
      };
      this.adapter.persist();
    }
  }

  private makeKey(characterId: number, resource: SyncResourceType): string {
    return `${characterId}:${resource}`;
  }

  public getSyncState(characterId: number, resource: SyncResourceType): SyncState {
    const key = this.makeKey(characterId, resource);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const defaultState: SyncState = {
      characterId,
      resource,
      status: 'IDLE',
      totalRecords: 0,
      newRecordsInLastSync: 0,
      asOf: Date.now(),
    };

    this.states.set(key, defaultState);
    this.syncToStorage();
    return defaultState;
  }

  public updateSyncState(
    characterId: number,
    resource: SyncResourceType,
    updates: Partial<SyncState>
  ): SyncState {
    const current = this.getSyncState(characterId, resource);
    const updated: SyncState = {
      ...current,
      ...updates,
      characterId,
      resource,
      asOf: Date.now(),
    };
    this.states.set(this.makeKey(characterId, resource), updated);
    this.syncToStorage();
    return updated;
  }

  public getFullStatus(characterId: number): FullCharacterSyncStatus {
    const transactions = this.getSyncState(characterId, 'wallet_transactions');
    const journal = this.getSyncState(characterId, 'wallet_journal');
    const orders = this.getSyncState(characterId, 'character_orders');

    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const lastCompleted = Math.max(
      transactions.lastSyncCompletedAt || 0,
      orders.lastSyncCompletedAt || 0
    );
    const isFresh = lastCompleted > 0 && Date.now() - lastCompleted < TEN_MINUTES_MS;
    const freshness = lastCompleted === 0 ? 'UNKNOWN' : isFresh ? 'FRESH' : 'STALE';

    return {
      characterId,
      transactions,
      journal,
      orders,
      asOf: Date.now(),
      freshness,
    };
  }

  public clearCharacter(characterId: number): void {
    for (const [key, state] of this.states.entries()) {
      if (state.characterId === characterId) {
        this.states.delete(key);
      }
    }
    this.syncToStorage();
  }

  public dumpData(): { states: SyncState[] } {
    return {
      states: Array.from(this.states.values()),
    };
  }

  public restoreData(data: { states: SyncState[] }, sync = true): void {
    this.states.clear();
    for (const s of data.states) {
      this.states.set(this.makeKey(s.characterId, s.resource), s);
    }
    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemorySyncRepository extends PersistentSyncRepository {}
export const defaultSyncRepository = new PersistentSyncRepository(StorageManager.getInstance().getAdapter());
