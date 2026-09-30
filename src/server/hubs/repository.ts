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

export class HubsRepository {
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

export const hubsRepository = new HubsRepository(StorageManager.getInstance().getAdapter());
