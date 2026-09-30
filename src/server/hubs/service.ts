import { hubsRepository, HubsRepository } from './repository';
import { HubDefinition, HubLocationMapping, HubResolvedLocation } from './types';
import { universeService } from '../universe/service';

export class HubsService {
  constructor(private repo: HubsRepository = hubsRepository) {}

  listHubs(): HubDefinition[] {
    return this.repo.listHubs();
  }

  getHub(id: string): HubDefinition | undefined {
    return this.repo.getHub(id);
  }

  createOrUpdateHub(hub: Omit<HubDefinition, 'created_at' | 'is_system_default'> & { id?: string }): HubDefinition {
    const id = hub.id || `custom-hub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const existing = this.repo.getHub(id);
    
    const record: HubDefinition = {
      id,
      name: hub.name.trim(),
      system_name: hub.system_name?.trim(),
      is_system_default: existing ? existing.is_system_default : false,
      notes: hub.notes?.trim(),
      created_at: existing ? existing.created_at : new Date().toISOString(),
    };

    this.repo.upsertHub(record);
    return record;
  }

  deleteHub(id: string): { success: boolean; reason?: string } {
    const existing = this.repo.getHub(id);
    if (!existing) {
      return { success: false, reason: 'Hub introuvable' };
    }
    if (existing.is_system_default) {
      return { success: false, reason: 'Impossible de supprimer un hub système par défaut' };
    }
    const deleted = this.repo.deleteHub(id);
    return { success: deleted };
  }

  listMappings(): HubLocationMapping[] {
    return this.repo.listMappings();
  }

  setMapping(locationId: number, locationName: string, hubId: string, notes?: string): HubLocationMapping {
    const mapping: HubLocationMapping = {
      location_id: locationId,
      location_name: locationName || universeService.resolveStationName(locationId),
      hub_id: hubId,
      notes: notes?.trim(),
      updated_at: new Date().toISOString(),
    };
    this.repo.upsertMapping(mapping);
    return mapping;
  }

  removeMapping(locationId: number): boolean {
    return this.repo.deleteMapping(locationId);
  }

  /**
   * Automatically discovers and registers hubs and mappings from observed transactions.
   * If a location matches a major hub (Jita, Amarr, Dodixie, Rens, Hek, Perimeter), it links to that hub.
   * Otherwise, it creates an auto-discovered hub named after the solar system or station.
   */
  autoDiscoverHubsFromTransactions(transactions: Array<{ locationId: number; locationName?: string }>): {
    discoveredHubs: number;
    discoveredMappings: number;
  } {
    let discoveredHubs = 0;
    let discoveredMappings = 0;

    const seenLocations = new Map<number, string>();
    for (const tx of transactions) {
      if (!tx.locationId || seenLocations.has(tx.locationId)) continue;
      const name = tx.locationName || universeService.resolveStationName(tx.locationId);
      seenLocations.set(tx.locationId, name);
    }

    for (const [locationId, locationName] of seenLocations.entries()) {
      if (this.repo.getMapping(locationId)) continue;

      const lower = locationName.toLowerCase();
      let targetHubId: string | undefined;

      if (lower.includes('jita') || lower.includes('perimeter')) {
        targetHubId = 'hub-jita';
      } else if (lower.includes('amarr')) {
        targetHubId = 'hub-amarr';
      } else if (lower.includes('dodixie')) {
        targetHubId = 'hub-dodixie';
      } else if (lower.includes('rens')) {
        targetHubId = 'hub-rens';
      } else if (lower.includes('hek')) {
        targetHubId = 'hub-hek';
      }

      if (!targetHubId) {
        // Extract system name if available: "System RomanNumeral - ..." or "System - ..."
        const systemMatch = locationName.match(/^([A-Za-z0-9'-]+)(?:\s+[IVXLCDM]+)?\s*[-]/);
        const systemName = systemMatch ? systemMatch[1] : undefined;
        const hubId = `hub-auto-${locationId}`;
        const hubName = systemName ? `${systemName} Hub` : locationName;

        this.repo.upsertHub({
          id: hubId,
          name: hubName,
          system_name: systemName,
          is_system_default: false,
          notes: `Hub auto-détecté depuis l'emplacement #${locationId}`,
          created_at: new Date().toISOString(),
        });
        targetHubId = hubId;
        discoveredHubs++;
      }

      this.setMapping(locationId, locationName, targetHubId, 'Mapping auto-découvert depuis transactions');
      discoveredMappings++;
    }

    return { discoveredHubs, discoveredMappings };
  }

  /**
   * Resolves a location ID to its associated trade hub.
   * If not explicitly mapped, returns 'UNKNOWN_HUB' with is_known_hub: false.
   * Strict Domain Rule: Unknown location NEVER silently defaults to Jita or any other hub.
   */
  resolveLocationToHub(locationId: number, fallbackLocationName?: string): HubResolvedLocation {
    const locationName = fallbackLocationName || universeService.resolveStationName(locationId);
    const mapping = this.repo.getMapping(locationId);

    if (mapping) {
      const hub = this.repo.getHub(mapping.hub_id);
      if (hub) {
        return {
          location_id: locationId,
          location_name: locationName,
          hub_id: hub.id,
          hub_name: hub.name,
          is_known_hub: true,
        };
      }
    }

    return {
      location_id: locationId,
      location_name: locationName,
      hub_id: 'UNKNOWN_HUB',
      hub_name: 'Emplacement non classé (UNKNOWN_HUB)',
      is_known_hub: false,
    };
  }
}

export const hubsService = new HubsService();
