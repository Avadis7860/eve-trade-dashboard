import type { SyncState, SyncResourceType, FullCharacterSyncStatus } from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export interface DistributedLeaseRecord {
  scopeKey: string;
  instanceId: string;
  acquiredAt: number;
  expiresAt: number;
  heartbeatAt: number;
}

export interface ISyncRepository {
  getSyncState(characterId: number, resource: SyncResourceType): SyncState;
  getSyncStateAsync(characterId: number, resource: SyncResourceType): Promise<SyncState>;
  updateSyncState(characterId: number, resource: SyncResourceType, updates: Partial<SyncState>): SyncState;
  updateSyncStateAsync(characterId: number, resource: SyncResourceType, updates: Partial<SyncState>): Promise<SyncState>;
  getFullStatus(characterId: number): FullCharacterSyncStatus;
  getFullStatusAsync(characterId: number): Promise<FullCharacterSyncStatus>;
  clearCharacter(characterId: number): void;
  clearCharacterAsync(characterId: number): Promise<void>;
  dumpData(): { states: SyncState[] };
  restoreData(data: { states: SyncState[] }): void;

  // Distributed Leases (Phase G03)
  tryAcquireLease(scopeKey: string, instanceId: string, ttlMs: number): boolean;
  tryAcquireLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean>;
  renewLease(scopeKey: string, instanceId: string, ttlMs: number): boolean;
  renewLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean>;
  releaseLease(scopeKey: string, instanceId: string): void;
  releaseLeaseAsync(scopeKey: string, instanceId: string): Promise<void>;
  getLease(scopeKey: string): DistributedLeaseRecord | null;
  getLeaseAsync(scopeKey: string): Promise<DistributedLeaseRecord | null>;
  getActiveLeasesAsync(): Promise<DistributedLeaseRecord[]>;
}

export class PersistentSyncRepository implements ISyncRepository {
  private states: Map<string, SyncState> = new Map();
  private leases: Map<string, DistributedLeaseRecord> = new Map();

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

  public async getSyncStateAsync(characterId: number, resource: SyncResourceType): Promise<SyncState> {
    return this.getSyncState(characterId, resource);
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

  public async updateSyncStateAsync(
    characterId: number,
    resource: SyncResourceType,
    updates: Partial<SyncState>
  ): Promise<SyncState> {
    return this.updateSyncState(characterId, resource, updates);
  }

  public getFullStatus(characterId: number): FullCharacterSyncStatus {
    const transactions = this.getSyncState(characterId, 'wallet_transactions');
    const journal = this.getSyncState(characterId, 'wallet_journal');
    const orders = this.getSyncState(characterId, 'character_orders');
    const assets = this.getSyncState(characterId, 'character_assets');
    const wallet = this.getSyncState(characterId, 'character_wallet');

    const streams: Array<{ state: SyncState; ttlMs: number }> = [
      { state: transactions, ttlMs: 10 * 60 * 1000 },
      { state: journal, ttlMs: 10 * 60 * 1000 },
      { state: orders, ttlMs: 10 * 60 * 1000 },
      { state: assets, ttlMs: 60 * 60 * 1000 },
      { state: wallet, ttlMs: 10 * 60 * 1000 },
    ];

    const hasError = streams.some((s) => s.state.status === 'ERROR');
    const isTransitory = streams.some((s) => s.state.status === 'PARTIAL' || s.state.status === 'SYNCING');

    let freshness: 'FRESH' | 'STALE' | 'UNKNOWN' | 'PARTIAL';
    if (hasError || isTransitory) {
      freshness = 'PARTIAL';
    } else {
      const completedStreams = streams.filter((s) => (s.state.lastSyncCompletedAt || 0) > 0);
      if (completedStreams.length === 0) {
        freshness = 'UNKNOWN';
      } else {
        const anyStale = completedStreams.some((s) => Date.now() - (s.state.lastSyncCompletedAt || 0) > s.ttlMs);
        freshness = anyStale ? 'STALE' : 'FRESH';
      }
    }

    return {
      characterId,
      transactions,
      journal,
      orders,
      assets,
      wallet,
      asOf: Date.now(),
      freshness,
    };
  }

  public async getFullStatusAsync(characterId: number): Promise<FullCharacterSyncStatus> {
    return this.getFullStatus(characterId);
  }

  public clearCharacter(characterId: number): void {
    for (const [key, state] of this.states.entries()) {
      if (state.characterId === characterId) {
        this.states.delete(key);
      }
    }
    this.syncToStorage();
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    this.clearCharacter(characterId);
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

  public tryAcquireLease(scopeKey: string, instanceId: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(scopeKey);
    if (existing && existing.expiresAt > now && existing.instanceId !== instanceId) {
      return false;
    }
    const lease: DistributedLeaseRecord = {
      scopeKey,
      instanceId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
      heartbeatAt: now,
    };
    this.leases.set(scopeKey, lease);
    return true;
  }

  public async tryAcquireLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean> {
    return this.tryAcquireLease(scopeKey, instanceId, ttlMs);
  }

  public renewLease(scopeKey: string, instanceId: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(scopeKey);
    if (!existing || existing.instanceId !== instanceId) {
      return false;
    }
    existing.expiresAt = now + ttlMs;
    existing.heartbeatAt = now;
    this.leases.set(scopeKey, existing);
    return true;
  }

  public async renewLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean> {
    return this.renewLease(scopeKey, instanceId, ttlMs);
  }

  public releaseLease(scopeKey: string, instanceId: string): void {
    const existing = this.leases.get(scopeKey);
    if (existing && existing.instanceId === instanceId) {
      this.leases.delete(scopeKey);
    }
  }

  public async releaseLeaseAsync(scopeKey: string, instanceId: string): Promise<void> {
    this.releaseLease(scopeKey, instanceId);
  }

  public getLease(scopeKey: string): DistributedLeaseRecord | null {
    const now = Date.now();
    const existing = this.leases.get(scopeKey);
    if (!existing) return null;
    if (existing.expiresAt <= now) {
      this.leases.delete(scopeKey);
      return null;
    }
    return { ...existing };
  }

  public async getLeaseAsync(scopeKey: string): Promise<DistributedLeaseRecord | null> {
    return this.getLease(scopeKey);
  }

  public async getActiveLeasesAsync(): Promise<DistributedLeaseRecord[]> {
    const now = Date.now();
    const active: DistributedLeaseRecord[] = [];
    for (const [key, lease] of this.leases.entries()) {
      if (lease.expiresAt > now) {
        active.push({ ...lease });
      } else {
        this.leases.delete(key);
      }
    }
    return active;
  }
}

export class InMemorySyncRepository extends PersistentSyncRepository {}

/**
 * PostgreSQL implementation of Sync Repository with parameterized SQL queries
 * and ACID state updates.
 */
export class PostgresSyncRepository implements ISyncRepository {
  private fallbackMemory: PersistentSyncRepository;

  constructor(private adapter: IDatabaseAdapter) {
    this.fallbackMemory = new PersistentSyncRepository(null);
  }

  private mapRowToSyncState(row: Record<string, unknown>): SyncState {
    let divisionStatuses: SyncState['divisionStatuses'];
    if (row.division_statuses) {
      try {
        divisionStatuses = typeof row.division_statuses === 'string'
          ? JSON.parse(row.division_statuses)
          : (row.division_statuses as SyncState['divisionStatuses']);
      } catch {
        divisionStatuses = undefined;
      }
    }

    return {
      characterId: Number(row.character_id),
      resource: row.resource as SyncState['resource'],
      status: row.status as SyncState['status'],
      coverageStatus: row.coverage_status ? (row.coverage_status as SyncState['coverageStatus']) : undefined,
      hasMore: row.has_more !== null && row.has_more !== undefined ? Boolean(row.has_more) : undefined,
      itemsCount: row.items_count !== null && row.items_count !== undefined ? Number(row.items_count) : undefined,
      lastSyncStartedAt: row.last_sync_started_at !== null && row.last_sync_started_at !== undefined ? Number(row.last_sync_started_at) : undefined,
      lastSyncCompletedAt: row.last_sync_completed_at !== null && row.last_sync_completed_at !== undefined ? Number(row.last_sync_completed_at) : undefined,
      lastSuccessfulId: row.last_cursor_from_id !== null && row.last_cursor_from_id !== undefined ? Number(row.last_cursor_from_id) : undefined,
      lastPage: row.last_page_processed !== null && row.last_page_processed !== undefined ? Number(row.last_page_processed) : undefined,
      divisionStatuses,
      totalRecords: Number(row.total_records || 0),
      newRecordsInLastSync: Number(row.new_records_in_last_sync || 0),
      errorMessage: row.last_error_message ? String(row.last_error_message) : undefined,
      asOf: Number(row.as_of || Date.now()),
    };
  }

  public getSyncState(characterId: number, resource: SyncResourceType): SyncState {
    return this.fallbackMemory.getSyncState(characterId, resource);
  }

  public async getSyncStateAsync(characterId: number, resource: SyncResourceType): Promise<SyncState> {
    const res = await this.adapter.query(
      'SELECT * FROM sync_states WHERE character_id = $1 AND resource = $2',
      [characterId, resource]
    );
    if (res.rows.length > 0) {
      const mapped = this.mapRowToSyncState(res.rows[0]);
      this.fallbackMemory.updateSyncState(characterId, resource, mapped);
      return mapped;
    }

    const defaultState: SyncState = {
      characterId,
      resource,
      status: 'IDLE',
      coverageStatus: 'UNKNOWN',
      hasMore: false,
      itemsCount: 0,
      totalRecords: 0,
      newRecordsInLastSync: 0,
      asOf: Date.now(),
    };

    await this.adapter.execute(
      `INSERT INTO sync_states (character_id, resource, status, coverage_status, has_more, items_count, total_records, new_records_in_last_sync, as_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (character_id, resource) DO NOTHING`,
      [characterId, resource, defaultState.status, defaultState.coverageStatus, defaultState.hasMore, defaultState.itemsCount, defaultState.totalRecords, defaultState.newRecordsInLastSync, defaultState.asOf]
    );

    this.fallbackMemory.updateSyncState(characterId, resource, defaultState);
    return defaultState;
  }

  public updateSyncState(
    characterId: number,
    resource: SyncResourceType,
    updates: Partial<SyncState>
  ): SyncState {
    const updated = this.fallbackMemory.updateSyncState(characterId, resource, updates);
    this.updateSyncStateAsync(characterId, resource, updates).catch(() => {});
    return updated;
  }

  public async updateSyncStateAsync(
    characterId: number,
    resource: SyncResourceType,
    updates: Partial<SyncState>
  ): Promise<SyncState> {
    const current = await this.getSyncStateAsync(characterId, resource);
    const updated: SyncState = {
      ...current,
      ...updates,
      characterId,
      resource,
      asOf: Date.now(),
    };

    const sql = `
      INSERT INTO sync_states (
        character_id, resource, status, coverage_status, has_more, items_count,
        last_sync_started_at, last_sync_completed_at, last_cursor_from_id,
        last_page_processed, total_records, new_records_in_last_sync,
        division_statuses, last_error_message, as_of
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (character_id, resource) DO UPDATE SET
        status = EXCLUDED.status,
        coverage_status = EXCLUDED.coverage_status,
        has_more = EXCLUDED.has_more,
        items_count = EXCLUDED.items_count,
        last_sync_started_at = EXCLUDED.last_sync_started_at,
        last_sync_completed_at = EXCLUDED.last_sync_completed_at,
        last_cursor_from_id = EXCLUDED.last_cursor_from_id,
        last_page_processed = EXCLUDED.last_page_processed,
        total_records = EXCLUDED.total_records,
        new_records_in_last_sync = EXCLUDED.new_records_in_last_sync,
        division_statuses = EXCLUDED.division_statuses,
        last_error_message = EXCLUDED.last_error_message,
        as_of = EXCLUDED.as_of
    `;
    const params = [
      updated.characterId,
      updated.resource,
      updated.status,
      updated.coverageStatus ?? null,
      updated.hasMore ?? false,
      updated.itemsCount ?? updated.totalRecords ?? 0,
      updated.lastSyncStartedAt ?? null,
      updated.lastSyncCompletedAt ?? null,
      updated.lastSuccessfulId ?? null,
      updated.lastPage ?? null,
      updated.totalRecords,
      updated.newRecordsInLastSync,
      updated.divisionStatuses ? JSON.stringify(updated.divisionStatuses) : null,
      updated.errorMessage ?? null,
      updated.asOf,
    ];
    await this.adapter.execute(sql, params);
    this.fallbackMemory.updateSyncState(characterId, resource, updated);
    return updated;
  }

  public getFullStatus(characterId: number): FullCharacterSyncStatus {
    return this.fallbackMemory.getFullStatus(characterId);
  }

  public async getFullStatusAsync(characterId: number): Promise<FullCharacterSyncStatus> {
    const transactions = await this.getSyncStateAsync(characterId, 'wallet_transactions');
    const journal = await this.getSyncStateAsync(characterId, 'wallet_journal');
    const orders = await this.getSyncStateAsync(characterId, 'character_orders');
    const assets = await this.getSyncStateAsync(characterId, 'character_assets');
    const wallet = await this.getSyncStateAsync(characterId, 'character_wallet');

    const streams: Array<{ state: SyncState; ttlMs: number }> = [
      { state: transactions, ttlMs: 10 * 60 * 1000 },
      { state: journal, ttlMs: 10 * 60 * 1000 },
      { state: orders, ttlMs: 10 * 60 * 1000 },
      { state: assets, ttlMs: 60 * 60 * 1000 },
      { state: wallet, ttlMs: 10 * 60 * 1000 },
    ];

    const hasError = streams.some((s) => s.state.status === 'ERROR');
    const isTransitory = streams.some((s) => s.state.status === 'PARTIAL' || s.state.status === 'SYNCING');

    let freshness: 'FRESH' | 'STALE' | 'UNKNOWN' | 'PARTIAL';
    if (hasError || isTransitory) {
      freshness = 'PARTIAL';
    } else {
      const completedStreams = streams.filter((s) => (s.state.lastSyncCompletedAt || 0) > 0);
      if (completedStreams.length === 0) {
        freshness = 'UNKNOWN';
      } else {
        const anyStale = completedStreams.some((s) => Date.now() - (s.state.lastSyncCompletedAt || 0) > s.ttlMs);
        freshness = anyStale ? 'STALE' : 'FRESH';
      }
    }

    return {
      characterId,
      transactions,
      journal,
      orders,
      assets,
      wallet,
      asOf: Date.now(),
      freshness,
    };
  }

  public clearCharacter(characterId: number): void {
    this.fallbackMemory.clearCharacter(characterId);
    this.clearCharacterAsync(characterId).catch(() => {});
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    this.fallbackMemory.clearCharacter(characterId);
    await this.adapter.execute('DELETE FROM sync_states WHERE character_id = $1', [characterId]);
  }

  public dumpData(): { states: SyncState[] } {
    return this.fallbackMemory.dumpData();
  }

  public restoreData(data: { states: SyncState[] }): void {
    this.fallbackMemory.restoreData(data);
    for (const s of data.states) {
      this.updateSyncStateAsync(s.characterId, s.resource, s).catch(() => {});
    }
  }

  public async tryAcquireLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const sql = `
      INSERT INTO esi_sync_leases (scope_key, instance_id, acquired_at, expires_at, heartbeat_at)
      VALUES ($1, $2, $3, $4, $3)
      ON CONFLICT (scope_key) DO UPDATE
      SET instance_id = EXCLUDED.instance_id,
          acquired_at = EXCLUDED.acquired_at,
          expires_at = EXCLUDED.expires_at,
          heartbeat_at = EXCLUDED.heartbeat_at
      WHERE esi_sync_leases.expires_at < $3 OR esi_sync_leases.instance_id = EXCLUDED.instance_id
      RETURNING scope_key;
    `;
    const res = await this.adapter.query(sql, [scopeKey, instanceId, now, expiresAt]);
    const acquired = res.rows.length > 0;
    if (acquired) {
      this.fallbackMemory.tryAcquireLease(scopeKey, instanceId, ttlMs);
    }
    return acquired;
  }

  public tryAcquireLease(scopeKey: string, instanceId: string, ttlMs: number): boolean {
    const res = this.fallbackMemory.tryAcquireLease(scopeKey, instanceId, ttlMs);
    this.tryAcquireLeaseAsync(scopeKey, instanceId, ttlMs).catch(() => {});
    return res;
  }

  public async renewLeaseAsync(scopeKey: string, instanceId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const sql = `
      UPDATE esi_sync_leases
      SET expires_at = $3,
          heartbeat_at = $4
      WHERE scope_key = $1 AND instance_id = $2
      RETURNING scope_key;
    `;
    const res = await this.adapter.query(sql, [scopeKey, instanceId, expiresAt, now]);
    const renewed = res.rows.length > 0;
    if (renewed) {
      this.fallbackMemory.renewLease(scopeKey, instanceId, ttlMs);
    }
    return renewed;
  }

  public renewLease(scopeKey: string, instanceId: string, ttlMs: number): boolean {
    const res = this.fallbackMemory.renewLease(scopeKey, instanceId, ttlMs);
    this.renewLeaseAsync(scopeKey, instanceId, ttlMs).catch(() => {});
    return res;
  }

  public async releaseLeaseAsync(scopeKey: string, instanceId: string): Promise<void> {
    this.fallbackMemory.releaseLease(scopeKey, instanceId);
    const sql = `
      DELETE FROM esi_sync_leases
      WHERE scope_key = $1 AND instance_id = $2;
    `;
    await this.adapter.execute(sql, [scopeKey, instanceId]);
  }

  public releaseLease(scopeKey: string, instanceId: string): void {
    this.fallbackMemory.releaseLease(scopeKey, instanceId);
    this.releaseLeaseAsync(scopeKey, instanceId).catch(() => {});
  }

  public async getLeaseAsync(scopeKey: string): Promise<DistributedLeaseRecord | null> {
    const now = Date.now();
    const sql = `
      SELECT scope_key, instance_id, acquired_at, expires_at, heartbeat_at
      FROM esi_sync_leases
      WHERE scope_key = $1 AND expires_at > $2;
    `;
    const res = await this.adapter.query<Record<string, unknown>>(sql, [scopeKey, now]);
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      scopeKey: String(row.scope_key),
      instanceId: String(row.instance_id),
      acquiredAt: Number(row.acquired_at),
      expiresAt: Number(row.expires_at),
      heartbeatAt: Number(row.heartbeat_at),
    };
  }

  public getLease(scopeKey: string): DistributedLeaseRecord | null {
    return this.fallbackMemory.getLease(scopeKey);
  }

  public async getActiveLeasesAsync(): Promise<DistributedLeaseRecord[]> {
    const now = Date.now();
    const sql = `
      SELECT scope_key, instance_id, acquired_at, expires_at, heartbeat_at
      FROM esi_sync_leases
      WHERE expires_at > $1;
    `;
    const res = await this.adapter.query<Record<string, unknown>>(sql, [now]);
    return res.rows.map((row) => ({
      scopeKey: String(row.scope_key),
      instanceId: String(row.instance_id),
      acquiredAt: Number(row.acquired_at),
      expiresAt: Number(row.expires_at),
      heartbeatAt: Number(row.heartbeat_at),
    }));
  }
}

export const defaultSyncRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresSyncRepository(StorageManager.getInstance().getAdapter())
  : new PersistentSyncRepository(StorageManager.getInstance().getAdapter());

