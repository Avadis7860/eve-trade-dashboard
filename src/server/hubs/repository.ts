import { HubDefinition, HubLocationMapping } from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

// Default EVE Online major trade hubs
const DEFAULT_HUBS: HubDefinition[] = [
  {
    id: 'hub-jita',
    name: 'Jita IV - Moon 4 - CNAP',
    system_name: 'Jita',
    is_system_default: true,
    notes: 'Hub commercial principal (The Forge)',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'hub-amarr',
    name: 'Amarr VIII (Oris) - Emperor Family Academy',
    system_name: 'Amarr',
    is_system_default: true,
    notes: 'Hub commercial secondaire (Domain)',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'hub-dodixie',
    name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    system_name: 'Dodixie',
    is_system_default: true,
    notes: 'Hub Gallente (Sinq Laison)',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'hub-rens',
    name: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    system_name: 'Rens',
    is_system_default: true,
    notes: 'Hub Minmatar (Heimatar)',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'hub-hek',
    name: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    system_name: 'Hek',
    is_system_default: true,
    notes: 'Hub Minmatar secondaire (Metropolis)',
    created_at: '2026-01-01T00:00:00Z',
  },
];

const DEFAULT_MAPPINGS: HubLocationMapping[] = [
  {
    location_id: 60003760,
    location_name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    hub_id: 'hub-jita',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    location_id: 60008494,
    location_name: 'Amarr VIII (Oris) - Emperor Family Academy',
    hub_id: 'hub-amarr',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    location_id: 60011866,
    location_name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    hub_id: 'hub-dodixie',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    location_id: 60004588,
    location_name: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    hub_id: 'hub-rens',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    location_id: 60005686,
    location_name: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    hub_id: 'hub-hek',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

export interface IHubsRepository {
  resetToDefaults(sync?: boolean): void;
  listHubs(): HubDefinition[];
  getHub(id: string): HubDefinition | undefined;
  upsertHub(hub: HubDefinition): void;
  deleteHub(id: string): boolean;
  listMappings(): HubLocationMapping[];
  getMapping(locationId: number): HubLocationMapping | undefined;
  upsertMapping(mapping: HubLocationMapping): void;
  deleteMapping(locationId: number): boolean;
  dumpData(): { hubs: HubDefinition[]; mappings: HubLocationMapping[] };
  restoreData(data: { hubs: HubDefinition[]; mappings: HubLocationMapping[] }, sync?: boolean): void;
}

export class PersistentHubsRepository implements IHubsRepository {
  private hubs = new Map<string, HubDefinition>();
  private mappings = new Map<number, HubLocationMapping>();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    this.resetToDefaults(false);
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.hubs && state.data.hubs.definitions.length > 0) {
        this.restoreData({
          hubs: state.data.hubs.definitions,
          mappings: state.data.hubs.mappings,
        }, false);
      } else {
        this.syncToStorage();
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.hubs = {
        definitions: Array.from(this.hubs.values()),
        mappings: Array.from(this.mappings.values()),
      };
      this.adapter.persist();
    }
  }

  resetToDefaults(sync = true): void {
    this.hubs.clear();
    for (const h of DEFAULT_HUBS) {
      this.hubs.set(h.id, { ...h });
    }

    this.mappings.clear();
    for (const m of DEFAULT_MAPPINGS) {
      this.mappings.set(m.location_id, { ...m });
    }

    if (sync) {
      this.syncToStorage();
    }
  }

  listHubs(): HubDefinition[] {
    return Array.from(this.hubs.values());
  }

  getHub(id: string): HubDefinition | undefined {
    return this.hubs.get(id);
  }

  upsertHub(hub: HubDefinition): void {
    this.hubs.set(hub.id, { ...hub });
    this.syncToStorage();
  }

  deleteHub(id: string): boolean {
    const hub = this.hubs.get(id);
    if (!hub || hub.is_system_default) {
      return false;
    }
    this.hubs.delete(id);
    for (const [locId, mapping] of this.mappings.entries()) {
      if (mapping.hub_id === id) {
        this.mappings.delete(locId);
      }
    }
    this.syncToStorage();
    return true;
  }

  listMappings(): HubLocationMapping[] {
    return Array.from(this.mappings.values());
  }

  getMapping(locationId: number): HubLocationMapping | undefined {
    return this.mappings.get(locationId);
  }

  upsertMapping(mapping: HubLocationMapping): void {
    this.mappings.set(mapping.location_id, { ...mapping });
    this.syncToStorage();
  }

  deleteMapping(locationId: number): boolean {
    const deleted = this.mappings.delete(locationId);
    if (deleted) {
      this.syncToStorage();
    }
    return deleted;
  }

  dumpData(): { hubs: HubDefinition[]; mappings: HubLocationMapping[] } {
    return {
      hubs: Array.from(this.hubs.values()),
      mappings: Array.from(this.mappings.values()),
    };
  }

  restoreData(data: { hubs: HubDefinition[]; mappings: HubLocationMapping[] }, sync = true): void {
    this.hubs.clear();
    this.mappings.clear();
    for (const hub of data.hubs) {
      this.hubs.set(hub.id, hub);
    }
    for (const mapping of data.mappings) {
      this.mappings.set(mapping.location_id, mapping);
    }
    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemoryHubsRepository extends PersistentHubsRepository {}

/**
 * PostgreSQL implementation of Hubs Repository with parameterized SQL queries
 * and relational integrity constraints.
 */
export class PostgresHubsRepository implements IHubsRepository {
  private fallbackMemory: PersistentHubsRepository;

  constructor(private adapter: IDatabaseAdapter) {
    this.fallbackMemory = new PersistentHubsRepository(null);
  }

  private mapRowToHub(row: Record<string, unknown>): HubDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      system_name: String(row.system_name),
      is_system_default: Boolean(row.is_system_default),
      notes: row.notes ? String(row.notes) : undefined,
      created_at: String(row.created_at),
    };
  }

  private mapRowToMapping(row: Record<string, unknown>): HubLocationMapping {
    return {
      location_id: Number(row.location_id),
      location_name: String(row.location_name),
      hub_id: String(row.hub_id),
      updated_at: String(row.updated_at),
    };
  }

  public resetToDefaults(sync = true): void {
    this.fallbackMemory.resetToDefaults(sync);
    this.resetToDefaultsAsync().catch(() => {});
  }

  public async resetToDefaultsAsync(): Promise<void> {
    await this.adapter.transaction(async (tx) => {
      await tx.execute('DELETE FROM hub_location_mappings');
      await tx.execute('DELETE FROM hubs');

      for (const h of DEFAULT_HUBS) {
        await tx.execute(
          `INSERT INTO hubs (id, name, system_name, is_system_default, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             system_name = EXCLUDED.system_name,
             is_system_default = EXCLUDED.is_system_default,
             notes = EXCLUDED.notes`,
          [h.id, h.name, h.system_name, h.is_system_default, h.notes || null, h.created_at]
        );
      }

      for (const m of DEFAULT_MAPPINGS) {
        await tx.execute(
          `INSERT INTO hub_location_mappings (location_id, location_name, hub_id, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (location_id) DO UPDATE SET
             location_name = EXCLUDED.location_name,
             hub_id = EXCLUDED.hub_id,
             updated_at = EXCLUDED.updated_at`,
          [m.location_id, m.location_name, m.hub_id, m.updated_at]
        );
      }
    });
  }

  public listHubs(): HubDefinition[] {
    return this.fallbackMemory.listHubs();
  }

  public async listHubsAsync(): Promise<HubDefinition[]> {
    const res = await this.adapter.query('SELECT * FROM hubs ORDER BY name ASC');
    return res.rows.map((r) => this.mapRowToHub(r));
  }

  public getHub(id: string): HubDefinition | undefined {
    return this.fallbackMemory.getHub(id);
  }

  public async getHubAsync(id: string): Promise<HubDefinition | undefined> {
    const res = await this.adapter.query('SELECT * FROM hubs WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToHub(res.rows[0]);
  }

  public upsertHub(hub: HubDefinition): void {
    this.fallbackMemory.upsertHub(hub);
    this.upsertHubAsync(hub).catch(() => {});
  }

  public async upsertHubAsync(hub: HubDefinition): Promise<void> {
    const sql = `
      INSERT INTO hubs (id, name, system_name, is_system_default, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        system_name = EXCLUDED.system_name,
        is_system_default = EXCLUDED.is_system_default,
        notes = EXCLUDED.notes
    `;
    await this.adapter.execute(sql, [
      hub.id,
      hub.name,
      hub.system_name,
      hub.is_system_default ?? false,
      hub.notes || null,
      hub.created_at || new Date().toISOString(),
    ]);
  }

  public deleteHub(id: string): boolean {
    const deleted = this.fallbackMemory.deleteHub(id);
    this.deleteHubAsync(id).catch(() => {});
    return deleted;
  }

  public async deleteHubAsync(id: string): Promise<boolean> {
    const hub = await this.getHubAsync(id);
    if (!hub || hub.is_system_default) {
      return false;
    }
    const res = await this.adapter.execute('DELETE FROM hubs WHERE id = $1', [id]);
    return res > 0;
  }

  public listMappings(): HubLocationMapping[] {
    return this.fallbackMemory.listMappings();
  }

  public async listMappingsAsync(): Promise<HubLocationMapping[]> {
    const res = await this.adapter.query('SELECT * FROM hub_location_mappings');
    return res.rows.map((r) => this.mapRowToMapping(r));
  }

  public getMapping(locationId: number): HubLocationMapping | undefined {
    return this.fallbackMemory.getMapping(locationId);
  }

  public async getMappingAsync(locationId: number): Promise<HubLocationMapping | undefined> {
    const res = await this.adapter.query('SELECT * FROM hub_location_mappings WHERE location_id = $1', [locationId]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToMapping(res.rows[0]);
  }

  public upsertMapping(mapping: HubLocationMapping): void {
    this.fallbackMemory.upsertMapping(mapping);
    this.upsertMappingAsync(mapping).catch(() => {});
  }

  public async upsertMappingAsync(mapping: HubLocationMapping): Promise<void> {
    const sql = `
      INSERT INTO hub_location_mappings (location_id, location_name, hub_id, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (location_id) DO UPDATE SET
        location_name = EXCLUDED.location_name,
        hub_id = EXCLUDED.hub_id,
        updated_at = EXCLUDED.updated_at
    `;
    await this.adapter.execute(sql, [
      mapping.location_id,
      mapping.location_name,
      mapping.hub_id,
      mapping.updated_at || new Date().toISOString(),
    ]);
  }

  public deleteMapping(locationId: number): boolean {
    const deleted = this.fallbackMemory.deleteMapping(locationId);
    this.deleteMappingAsync(locationId).catch(() => {});
    return deleted;
  }

  public async deleteMappingAsync(locationId: number): Promise<boolean> {
    const res = await this.adapter.execute('DELETE FROM hub_location_mappings WHERE location_id = $1', [locationId]);
    return res > 0;
  }

  public dumpData(): { hubs: HubDefinition[]; mappings: HubLocationMapping[] } {
    return this.fallbackMemory.dumpData();
  }

  public restoreData(data: { hubs: HubDefinition[]; mappings: HubLocationMapping[] }, sync = true): void {
    this.fallbackMemory.restoreData(data, sync);
  }
}

export type HubsRepository = IHubsRepository;
export const HubsRepository = PersistentHubsRepository;

export const defaultHubsRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresHubsRepository(StorageManager.getInstance().getAdapter())
  : new PersistentHubsRepository(StorageManager.getInstance().getAdapter());
export const hubsRepository = defaultHubsRepository;

