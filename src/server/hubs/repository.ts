import { HubDefinition, HubLocationMapping } from './types';

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

  constructor() {
    this.resetToDefaults();
  }

  resetToDefaults(): void {
    this.hubs.clear();
    for (const h of DEFAULT_HUBS) {
      this.hubs.set(h.id, { ...h });
    }

    this.mappings.clear();
    for (const m of DEFAULT_MAPPINGS) {
      this.mappings.set(m.location_id, { ...m });
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
  }

  deleteHub(id: string): boolean {
    const hub = this.hubs.get(id);
    if (!hub || hub.is_system_default) {
      return false; // Can not delete system defaults
    }
    this.hubs.delete(id);
    // Unlink any mappings pointing to this hub
    for (const [locId, mapping] of this.mappings.entries()) {
      if (mapping.hub_id === id) {
        this.mappings.delete(locId);
      }
    }
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
  }

  deleteMapping(locationId: number): boolean {
    return this.mappings.delete(locationId);
  }
}

export const hubsRepository = new HubsRepository();
