/**
 * Phase P02 — Registre Minier & Coûts d'Opportunité Farm / Mining
 * Dépôt de persistance dédié pour le Grand Livre Minier (mining_ledger)
 * Ne dépend pas et ne modifie JAMAIS la table transactions.
 */

import type {
  MiningLedgerEntry,
  MiningLedgerFilterOptions,
  MiningOpportunityReference,
} from './types.ts';
import { StorageManager } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import { logger } from '../utils/logger.ts';

export interface IMiningRepository {
  saveMiningEntries(
    characterId: number,
    entries: Array<Omit<MiningLedgerEntry, 'id' | 'provenance' | 'realizedCashCostIsk'>>
  ): Promise<{ inserted: number; updated: number }>;
  getMiningEntries(filters?: MiningLedgerFilterOptions): MiningLedgerEntry[];
  getAllMiningEntries(characterId?: number): MiningLedgerEntry[];
  getMiningEntriesForCharacters(characterIds: number[], filters?: MiningLedgerFilterOptions): MiningLedgerEntry[];
  deleteMiningEntriesForCharacter(characterId: number): Promise<void> | void;
  clearAll(): void;
  setOpportunityReference(ref: MiningOpportunityReference): void;
  getOpportunityReference(typeId: number): MiningOpportunityReference | undefined;
  getAllOpportunityReferences(): MiningOpportunityReference[];
}

export class MiningRepository implements IMiningRepository {
  private inMemoryEntries: Map<string, MiningLedgerEntry> = new Map();
  private opportunityReferences: Map<number, MiningOpportunityReference> = new Map();
  private currentNextId = 1;
  private adapter: IDatabaseAdapter;

  constructor(adapter?: IDatabaseAdapter) {
    this.adapter = adapter || StorageManager.getInstance().getAdapter();
    this.initFromStorage();
  }

  private makeUniqueKey(characterId: number, date: string, solarSystemId: number, typeId: number): string {
    return `${characterId}:${date}:${solarSystemId}:${typeId}`;
  }

  private initFromStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => { data?: { mining?: { entries?: MiningLedgerEntry[] } } };
      };
      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        const stored = state?.data?.mining?.entries;
        if (Array.isArray(stored)) {
          for (const entry of stored) {
            const key = this.makeUniqueKey(entry.characterId, entry.date, entry.solarSystemId, entry.typeId);
            this.inMemoryEntries.set(key, {
              ...entry,
              provenance: 'FARMED',
              realizedCashCostIsk: 0,
            });
            if (entry.id && entry.id >= this.currentNextId) {
              this.currentNextId = entry.id + 1;
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[MiningRepository] Could not initialize from storage state: ${(err as Error).message}`);
    }
  }

  private syncToStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => { data: { mining?: { entries: MiningLedgerEntry[] } } };
        persist?: () => void;
      };
      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        if (state && state.data) {
          if (!state.data.mining) {
            state.data.mining = { entries: [] };
          }
          state.data.mining.entries = Array.from(this.inMemoryEntries.values());
          if (typeof adapterAny.persist === 'function') {
            adapterAny.persist();
          }
        }
      }
    } catch (err) {
      logger.error(`[MiningRepository] Failed to sync mining ledger to storage: ${(err as Error).message}`);
    }
  }

  /**
   * Persiste de manière idempotente des entrées de minage dans la table dédiée mining_ledger
   * Contrainte d'unicité respectée : (character_id, date, solar_system_id, type_id)
   */
  public async saveMiningEntries(
    characterId: number,
    entries: Array<Omit<MiningLedgerEntry, 'id' | 'provenance' | 'realizedCashCostIsk'>>
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const item of entries) {
      const key = this.makeUniqueKey(characterId, item.date, item.solarSystemId, item.typeId);
      const existing = this.inMemoryEntries.get(key);

      const entry: MiningLedgerEntry = {
        id: existing?.id ?? this.currentNextId++,
        characterId,
        date: item.date,
        solarSystemId: item.solarSystemId,
        solarSystemName: item.solarSystemName || existing?.solarSystemName,
        typeId: item.typeId,
        typeName: item.typeName || existing?.typeName,
        quantity: item.quantity,
        estimatedUnitValue: item.estimatedUnitValue !== undefined ? item.estimatedUnitValue : (existing?.estimatedUnitValue ?? null),
        opportunityCostIsk: item.opportunityCostIsk !== undefined ? item.opportunityCostIsk : (existing?.opportunityCostIsk ?? null),
        realizedCashCostIsk: 0,
        provenance: 'FARMED',
        costBasisStatus: item.costBasisStatus || (item.estimatedUnitValue !== null && item.estimatedUnitValue !== undefined ? 'KNOWN' : 'UNKNOWN'),
        createdAt: existing?.createdAt ?? item.createdAt ?? Date.now(),
      };

      if (existing) {
        this.inMemoryEntries.set(key, entry);
        updated++;
      } else {
        this.inMemoryEntries.set(key, entry);
        inserted++;
      }
    }

    this.syncToStorage();

    // Insertion idempotente dans PostgreSQL si adaptateur SQL actif
    try {
      for (const item of entries) {
        await this.adapter.execute(
          `INSERT INTO mining_ledger (character_id, date, solar_system_id, type_id, quantity, estimated_unit_value, opportunity_cost_isk)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (character_id, date, solar_system_id, type_id)
           DO UPDATE SET quantity = EXCLUDED.quantity,
                         estimated_unit_value = EXCLUDED.estimated_unit_value,
                         opportunity_cost_isk = EXCLUDED.opportunity_cost_isk`,
          [
            characterId,
            item.date,
            item.solarSystemId,
            item.typeId,
            item.quantity,
            item.estimatedUnitValue,
            item.opportunityCostIsk,
          ]
        );
      }
    } catch (sqlErr) {
      // Ignoré si DurableFileDatabaseAdapter ne gère pas les requêtes SQL arbitraires
      logger.debug(`[MiningRepository] SQL upsert skipped or not supported: ${(sqlErr as Error).message}`);
    }

    return { inserted, updated };
  }

  public getMiningEntries(filters?: MiningLedgerFilterOptions): MiningLedgerEntry[] {
    let result = Array.from(this.inMemoryEntries.values());

    if (filters?.characterId !== undefined) {
      result = result.filter((e) => e.characterId === filters.characterId);
    }
    if (filters?.characterIds && filters.characterIds.length > 0) {
      const allowed = new Set(filters.characterIds);
      result = result.filter((e) => allowed.has(e.characterId));
    }
    if (filters?.typeId !== undefined) {
      result = result.filter((e) => e.typeId === filters.typeId);
    }
    if (filters?.solarSystemId !== undefined) {
      result = result.filter((e) => e.solarSystemId === filters.solarSystemId);
    }
    if (filters?.startDate) {
      result = result.filter((e) => e.date >= filters.startDate!);
    }
    if (filters?.endDate) {
      result = result.filter((e) => e.date <= filters.endDate!);
    }

    // Tri antichronologique par défaut
    result.sort((a, b) => {
      const cmpDate = b.date.localeCompare(a.date);
      if (cmpDate !== 0) return cmpDate;
      return (b.id || 0) - (a.id || 0);
    });

    if (filters?.offset !== undefined && filters.offset > 0) {
      result = result.slice(filters.offset);
    }
    if (filters?.limit !== undefined && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  public getAllMiningEntries(characterId?: number): MiningLedgerEntry[] {
    return this.getMiningEntries(characterId !== undefined ? { characterId } : undefined);
  }

  public getMiningEntriesForCharacters(
    characterIds: number[],
    filters?: MiningLedgerFilterOptions
  ): MiningLedgerEntry[] {
    return this.getMiningEntries({ ...filters, characterIds });
  }

  public async deleteMiningEntriesForCharacter(characterId: number): Promise<void> {
    for (const [key, entry] of this.inMemoryEntries.entries()) {
      if (entry.characterId === characterId) {
        this.inMemoryEntries.delete(key);
      }
    }
    this.syncToStorage();
    try {
      await this.adapter.execute('DELETE FROM mining_ledger WHERE character_id = $1', [characterId]);
    } catch {
      // Ignoré si adaptateur local
    }
  }

  public clearAll(): void {
    this.inMemoryEntries.clear();
    this.opportunityReferences.clear();
    this.syncToStorage();
  }

  public setOpportunityReference(ref: MiningOpportunityReference): void {
    this.opportunityReferences.set(ref.typeId, { ...ref, updatedAt: Date.now() });
  }

  public getOpportunityReference(typeId: number): MiningOpportunityReference | undefined {
    return this.opportunityReferences.get(typeId);
  }

  public getAllOpportunityReferences(): MiningOpportunityReference[] {
    return Array.from(this.opportunityReferences.values());
  }
}

export const defaultMiningRepository = new MiningRepository();
