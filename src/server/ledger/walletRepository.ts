import type { WalletBalanceSnapshot } from '../capital/types.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import { StorageManager } from '../storage/database.ts';

export interface IWalletRepository {
  saveWalletSnapshots(snapshots: WalletBalanceSnapshot[]): void;
  saveWalletSnapshot(snapshot: WalletBalanceSnapshot): void;
  getAllWalletSnapshots(): WalletBalanceSnapshot[];
  getCharacterWallet(characterId: number): WalletBalanceSnapshot | null;
  getCorporationWallets(corporationId?: number): WalletBalanceSnapshot[];
  clearCharacterData(characterId: number): void;
  clearAll(): void;
}

export class WalletRepository implements IWalletRepository {
  private snapshots: Map<string, WalletBalanceSnapshot> = new Map();
  private dbAdapter: IDatabaseAdapter | null = null;

  constructor(dbAdapter?: IDatabaseAdapter | null) {
    if (dbAdapter !== undefined) {
      this.dbAdapter = dbAdapter;
    } else {
      try {
        this.dbAdapter = StorageManager.getInstance().getAdapter();
      } catch {
        this.dbAdapter = null;
      }
    }
    if (this.dbAdapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (!this.dbAdapter) return;
    try {
      const res = this.dbAdapter.query<Record<string, unknown>>(
        'SELECT id, type, character_id, character_name, corporation_id, corporation_name, division, division_name, balance, observed_at, observed_by_character_id, source FROM wallet_snapshots'
      );
      const rows = res instanceof Promise ? [] : (res && res.rows ? res.rows : []);
      for (const row of rows) {
        const item: WalletBalanceSnapshot = {
          id: String(row.id),
          type: row.type === 'CORPORATION' ? 'CORPORATION' : 'CHARACTER',
          characterId: row.character_id ? Number(row.character_id) : undefined,
          characterName: row.character_name ? String(row.character_name) : undefined,
          corporationId: row.corporation_id ? Number(row.corporation_id) : undefined,
          corporationName: row.corporation_name ? String(row.corporation_name) : undefined,
          division: row.division ? Number(row.division) : undefined,
          divisionName: row.division_name ? String(row.division_name) : undefined,
          balance: Number(row.balance) || 0,
          observedAt: Number(row.observed_at) || Date.now(),
          observedByCharacterId: Number(row.observed_by_character_id) || 0,
          source: String(row.source || ''),
          isIncludedInLiquid: true,
        };
        this.snapshots.set(item.id, item);
      }
    } catch {
      // Table may not exist yet if before migration, ignore and use memory
    }
  }

  private syncToStorage(snapshot: WalletBalanceSnapshot): void {
    if (!this.dbAdapter) return;
    try {
      this.dbAdapter.execute(
        `INSERT INTO wallet_snapshots (
          id, type, character_id, character_name, corporation_id, corporation_name,
          division, division_name, balance, observed_at, observed_by_character_id, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          balance = EXCLUDED.balance,
          observed_at = EXCLUDED.observed_at,
          observed_by_character_id = EXCLUDED.observed_by_character_id,
          character_name = COALESCE(EXCLUDED.character_name, wallet_snapshots.character_name),
          corporation_name = COALESCE(EXCLUDED.corporation_name, wallet_snapshots.corporation_name),
          division_name = COALESCE(EXCLUDED.division_name, wallet_snapshots.division_name)`,
        [
          snapshot.id,
          snapshot.type,
          snapshot.characterId ?? null,
          snapshot.characterName ?? null,
          snapshot.corporationId ?? null,
          snapshot.corporationName ?? null,
          snapshot.division ?? null,
          snapshot.divisionName ?? null,
          snapshot.balance,
          snapshot.observedAt,
          snapshot.observedByCharacterId,
          snapshot.source,
        ]
      );
    } catch {
      // Fallback in-memory
    }
  }

  public saveWalletSnapshots(snapshots: WalletBalanceSnapshot[]): void {
    for (const snap of snapshots) {
      this.saveWalletSnapshot(snap);
    }
  }

  public saveWalletSnapshot(snapshot: WalletBalanceSnapshot): void {
    const existing = this.snapshots.get(snapshot.id);
    const merged: WalletBalanceSnapshot = {
      ...existing,
      ...snapshot,
      characterName: snapshot.characterName || existing?.characterName,
      corporationName: snapshot.corporationName || existing?.corporationName,
      divisionName: snapshot.divisionName || existing?.divisionName,
    };
    this.snapshots.set(snapshot.id, merged);
    this.syncToStorage(merged);
  }

  public getAllWalletSnapshots(): WalletBalanceSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  public getCharacterWallet(characterId: number): WalletBalanceSnapshot | null {
    const key = `char:${characterId}`;
    return this.snapshots.get(key) || null;
  }

  public getCorporationWallets(corporationId?: number): WalletBalanceSnapshot[] {
    const results: WalletBalanceSnapshot[] = [];
    for (const item of this.snapshots.values()) {
      if (item.type === 'CORPORATION') {
        if (corporationId === undefined || item.corporationId === corporationId) {
          results.push(item);
        }
      }
    }
    // Sort by division
    results.sort((a, b) => (a.division || 0) - (b.division || 0));
    return results;
  }

  public clearCharacterData(characterId: number): void {
    const toDelete: string[] = [];
    for (const [id, item] of this.snapshots.entries()) {
      if (item.characterId === characterId || item.observedByCharacterId === characterId) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.snapshots.delete(id);
    }
    if (this.dbAdapter) {
      try {
        this.dbAdapter.execute(
          'DELETE FROM wallet_snapshots WHERE character_id = $1 OR observed_by_character_id = $1',
          [characterId]
        );
      } catch {
        // Ignore
      }
    }
  }

  public clearAll(): void {
    this.snapshots.clear();
    if (this.dbAdapter) {
      try {
        this.dbAdapter.execute('DELETE FROM wallet_snapshots');
      } catch {
        // Ignore
      }
    }
  }
}

export const defaultWalletRepository: IWalletRepository = new WalletRepository();
