import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';

export interface UniverseNameEntry {
  id: number;
  name: string;
  category: string; // 'inventory_type' | 'station' | 'solar_system' | 'character' | 'corporation' | 'alliance' | 'structure'
}

/** Maximum 32-bit signed integer value allowed by ESI POST /universe/names/ */
export const MAX_ESI_INT32 = 2147483647;

/** Common well-known static mappings for fast offline resolution */
const WELL_KNOWN_NAMES: Record<number, { name: string; category: string }> = {
  // Major trade hubs
  60003760: { name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', category: 'station' },
  60008494: { name: 'Amarr VIII (Oris) - Emperor Family Academy', category: 'station' },
  60011866: { name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant', category: 'station' },
  60004588: { name: 'Rens VI - Moon 8 - Brutor Tribe Treasury', category: 'station' },
  60005686: { name: 'Hek VIII - Moon 12 - Boundless Creation Factory', category: 'station' },
  // Common minerals / items
  34: { name: 'Tritanium', category: 'inventory_type' },
  35: { name: 'Pyerite', category: 'inventory_type' },
  36: { name: 'Mexallon', category: 'inventory_type' },
  37: { name: 'Isogen', category: 'inventory_type' },
  38: { name: 'Nocxium', category: 'inventory_type' },
  39: { name: 'Zydrine', category: 'inventory_type' },
  40: { name: 'Megacyte', category: 'inventory_type' },
  11399: { name: 'Morphite', category: 'inventory_type' },
  44992: { name: 'PLEX', category: 'inventory_type' },
  40520: { name: 'Skill Injector', category: 'inventory_type' },
  40519: { name: 'Skill Extractor', category: 'inventory_type' },
};

export class UniverseService {
  private cache: Map<number, UniverseNameEntry> = new Map();
  private esiClient: EsiClient;

  constructor(esiClient: EsiClient = defaultEsiClient) {
    this.esiClient = esiClient;
    // Pre-populate with well known names
    for (const [idStr, entry] of Object.entries(WELL_KNOWN_NAMES)) {
      const id = Number(idStr);
      this.cache.set(id, { id, ...entry });
    }
  }

  /**
   * Checks whether an ID is an Upwell 64-bit structure ID (ID > 2^31 - 1)
   */
  public isStructureId(id: number): boolean {
    return typeof id === 'number' && id > MAX_ESI_INT32;
  }

  /**
   * Returns cached name or formatted ID fallback
   */
  public getNameSync(id: number, fallbackPrefix?: string): string {
    const cached = this.cache.get(id);
    if (cached) {
      return cached.name;
    }
    if (this.isStructureId(id)) {
      return `Structure #${id}`;
    }
    const prefix = fallbackPrefix || 'ID';
    return `${prefix} #${id}`;
  }

  /**
   * Resolves an array of IDs using cached names and batch requests to ESI /universe/names/
   * Safely isolates 64-bit Upwell structure IDs from 32-bit standard IDs to avoid ESI HTTP 400 errors.
   */
  public async resolveNames(ids: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const missingInt32Ids: number[] = [];

    // Check cache first and classify 64-bit structures
    for (const id of ids) {
      if (!id || typeof id !== 'number' || id <= 0 || !Number.isFinite(id)) continue;

      const cached = this.cache.get(id);
      if (cached) {
        result.set(id, cached.name);
        continue;
      }

      // If it's a 64-bit structure ID (> 2^31-1), ESI POST /universe/names/ will reject it with HTTP 400
      if (this.isStructureId(id)) {
        const structureName = `Structure #${id}`;
        this.cache.set(id, { id, name: structureName, category: 'structure' });
        result.set(id, structureName);
      } else if (id <= MAX_ESI_INT32) {
        missingInt32Ids.push(id);
      }
    }

    if (missingInt32Ids.length === 0) {
      return result;
    }

    // Deduplicate missing int32 IDs
    const uniqueMissing = Array.from(new Set(missingInt32Ids));
    const BATCH_SIZE = 200; // Smaller chunks (200 vs 500) prevent CCP ESI HTTP 504 Gateway Timeouts

    for (let i = 0; i < uniqueMissing.length; i += BATCH_SIZE) {
      const batch = uniqueMissing.slice(i, i + BATCH_SIZE);
      if (batch.length === 0) continue;

      try {
        const response = await this.esiClient.post<UniverseNameEntry[]>('/universe/names/', batch);
        if (Array.isArray(response.data)) {
          for (const item of response.data) {
            this.cache.set(item.id, item);
            result.set(item.id, item.name);
          }
        }
      } catch (err) {
        // In case of 504 timeout on a batch of 200, try smaller sub-batches of 50
        const isTimeout = (err as Error).message?.includes('504') || (err as Error).message?.includes('timeout');
        if (isTimeout && batch.length > 50) {
          const SUB_BATCH_SIZE = 50;
          for (let s = 0; s < batch.length; s += SUB_BATCH_SIZE) {
            const subBatch = batch.slice(s, s + SUB_BATCH_SIZE);
            try {
              const subResponse = await this.esiClient.post<UniverseNameEntry[]>('/universe/names/', subBatch);
              if (Array.isArray(subResponse.data)) {
                for (const item of subResponse.data) {
                  this.cache.set(item.id, item);
                  result.set(item.id, item.name);
                }
              }
            } catch (subErr) {
              console.warn('[UniverseService] Sub-batch resolution failed, falling back to static names:', (subErr as Error).message);
            }
          }
        } else {
          console.warn('[UniverseService] Failed to resolve batch names from ESI:', (err as Error).message);
        }
      }
    }

    // Fill remaining missing IDs with fallbacks
    for (const id of ids) {
      if (!result.has(id)) {
        const fallback = this.isStructureId(id) ? `Structure #${id}` : `ID #${id}`;
        result.set(id, fallback);
      }
    }

    return result;
  }

  /**
   * Sets or overrides a custom name for a specific ID in cache
   */
  public setCustomName(id: number, name: string, category: string): void {
    this.cache.set(id, { id, name, category });
  }

  /**
   * Resolves a station or structure ID synchronously from cache or fallback
   */
  public resolveStationName(id: number): string {
    return this.getNameSync(id, 'Station');
  }

  /**
   * Clears internal memory cache (retaining well known items)
   */
  public clearCache(): void {
    this.cache.clear();
    for (const [idStr, entry] of Object.entries(WELL_KNOWN_NAMES)) {
      const id = Number(idStr);
      this.cache.set(id, { id, ...entry });
    }
  }
}

export const defaultUniverseService = new UniverseService();
export const universeService = defaultUniverseService;
