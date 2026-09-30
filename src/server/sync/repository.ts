import type { SyncState, SyncResourceType, FullCharacterSyncStatus } from './types.ts';

export interface ISyncRepository {
  getSyncState(characterId: number, resource: SyncResourceType): SyncState;
  updateSyncState(characterId: number, resource: SyncResourceType, updates: Partial<SyncState>): SyncState;
  getFullStatus(characterId: number): FullCharacterSyncStatus;
  clearCharacter(characterId: number): void;
}

export class InMemorySyncRepository implements ISyncRepository {
  private states: Map<string, SyncState> = new Map();

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
    return updated;
  }

  public getFullStatus(characterId: number): FullCharacterSyncStatus {
    const transactions = this.getSyncState(characterId, 'wallet_transactions');
    const journal = this.getSyncState(characterId, 'wallet_journal');
    const orders = this.getSyncState(characterId, 'character_orders');

    // Freshness check (e.g. fresh if synced in last 10 minutes)
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
  }
}

export const defaultSyncRepository = new InMemorySyncRepository();
