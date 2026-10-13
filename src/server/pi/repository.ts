/**
 * Phase P03 — Colonies Planétaires & Flux de Matières PI
 * Dépôt de persistance dédié pour les colonies, pins, routes et bureaux de douane (POCO)
 */

import type {
  RawEsiPlanet,
  RawEsiPlanetDetail,
  RawEsiCustomsOffice,
} from '../esi/types.ts';
import type {
  PiAggregatedStockItem,
  PiMaterialTier,
  PiPinCategory,
} from './types.ts';
import { StorageManager } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import { logger } from '../utils/logger.ts';

export interface IPiRepository {
  saveColonies(
    characterId: number,
    colonies: RawEsiPlanet[]
  ): Promise<{ inserted: number; updated: number }>;
  saveColonyDetail(
    characterId: number,
    planetId: number,
    detail: RawEsiPlanetDetail
  ): Promise<void>;
  getColonies(characterId?: number, characterIds?: number[]): RawEsiPlanet[];
  getColonyDetail(characterId: number, planetId: number): RawEsiPlanetDetail | null;
  getAllColonyDetailsForCharacter(characterId: number): Record<number, RawEsiPlanetDetail>;
  getAggregatedStocksByCharacter(characterId?: number, characterIds?: number[]): PiAggregatedStockItem[];
  saveCustomsOffices(offices: RawEsiCustomsOffice[]): Promise<void>;
  getCustomsOffice(systemId: number): RawEsiCustomsOffice | undefined;
  getAllCustomsOffices(): RawEsiCustomsOffice[];
  deleteCharacterData(characterId: number): Promise<void>;
  clearAll(): void;
}

/**
 * Détermine la catégorie d'un pin à partir de son typeId et de ses détails
 */
export function determinePinCategory(typeId: number, detail?: { schematicId?: number; hasExtractor?: boolean }): PiPinCategory {
  // Extracteurs EVE Online
  if (detail?.hasExtractor || (typeId >= 2845 && typeId <= 2848) || typeId === 3060 || typeId === 3061 || typeId === 3062) {
    return 'EXTRACTOR';
  }
  // Centres de commandement (Command Centers)
  if (
    (typeId >= 2254 && typeId <= 2261) || // Command centers Mk I
    (typeId >= 2524 && typeId <= 2544)    // Upgraded Command Centers
  ) {
    return 'COMMAND_CENTER';
  }
  // Silos de stockage (Storage Facilities)
  if (typeId === 2256 || typeId === 2530 || typeId === 2542) {
    return 'STORAGE';
  }
  // Spatioports / Plateformes de lancement (Spaceports / Launchpads)
  if (typeId === 2543 || typeId === 2257 || typeId === 2531) {
    return 'SPACEPORT';
  }
  // Usines de transformation (Industry Facilities)
  if (typeId >= 2469 && typeId <= 2474) {
    return 'BASIC_PROCESSOR';
  }
  if (typeId >= 2475 && typeId <= 2480) {
    return 'ADVANCED_PROCESSOR';
  }
  if (typeId >= 2481 && typeId <= 2485) {
    return 'HIGH_TECH_PROCESSOR';
  }

  // Fallback si schematicId est présent
  if (detail?.schematicId) {
    return 'BASIC_PROCESSOR';
  }

  return 'OTHER';
}

/**
 * Volumes unitaires standards des matériaux planétaires ($m^3$)
 */
export const PI_TIER_VOLUMES: Record<PiMaterialTier, number> = {
  P0: 0.01,
  P1: 0.38,
  P2: 1.50,
  P3: 6.00,
  P4: 52.00,
  UNKNOWN: 1.00,
};

export class PiRepository implements IPiRepository {
  private inMemoryPlanets: Map<string, RawEsiPlanet> = new Map(); // key: `${characterId}:${planetId}`
  private inMemoryDetails: Map<string, RawEsiPlanetDetail> = new Map(); // key: `${characterId}:${planetId}`
  private inMemoryCustomsOffices: Map<number, RawEsiCustomsOffice> = new Map(); // key: systemId
  private adapter: IDatabaseAdapter;

  constructor(adapter?: IDatabaseAdapter) {
    this.adapter = adapter || StorageManager.getInstance().getAdapter();
    this.initFromStorage();
  }

  private makeKey(characterId: number, planetId: number): string {
    return `${characterId}:${planetId}`;
  }

  private initFromStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => {
          data?: {
            pi?: {
              colonies?: RawEsiPlanet[];
              planetDetails?: Record<string, RawEsiPlanetDetail>;
              customsOffices?: RawEsiCustomsOffice[];
            };
          };
        };
      };

      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        const storedPi = state?.data?.pi;
        if (storedPi) {
          if (Array.isArray(storedPi.colonies)) {
            for (const col of storedPi.colonies) {
              const charId = col.owner_id || 0;
              this.inMemoryPlanets.set(this.makeKey(charId, col.planet_id), col);
            }
          }
          if (storedPi.planetDetails && typeof storedPi.planetDetails === 'object') {
            for (const [key, detail] of Object.entries(storedPi.planetDetails)) {
              this.inMemoryDetails.set(key, detail);
            }
          }
          if (Array.isArray(storedPi.customsOffices)) {
            for (const poco of storedPi.customsOffices) {
              this.inMemoryCustomsOffices.set(poco.solar_system_id, poco);
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[PiRepository] Could not initialize from storage state: ${(err as Error).message}`);
    }
  }

  private syncToStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => {
          data: {
            pi?: {
              colonies: RawEsiPlanet[];
              planetDetails: Record<string, RawEsiPlanetDetail>;
              customsOffices: RawEsiCustomsOffice[];
            };
          };
        };
        persist?: () => void;
      };

      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        if (state && state.data) {
          const detailsObj: Record<string, RawEsiPlanetDetail> = {};
          for (const [k, v] of this.inMemoryDetails.entries()) {
            detailsObj[k] = v;
          }

          state.data.pi = {
            colonies: Array.from(this.inMemoryPlanets.values()),
            planetDetails: detailsObj,
            customsOffices: Array.from(this.inMemoryCustomsOffices.values()),
          };

          if (typeof adapterAny.persist === 'function') {
            adapterAny.persist();
          }
        }
      }
    } catch (err) {
      logger.error(`[PiRepository] Failed to sync PI state to storage: ${(err as Error).message}`);
    }
  }

  public async saveColonies(
    characterId: number,
    colonies: RawEsiPlanet[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const p of colonies) {
      const colWithOwner: RawEsiPlanet = { ...p, owner_id: characterId };
      const key = this.makeKey(characterId, p.planet_id);
      if (this.inMemoryPlanets.has(key)) {
        updated++;
      } else {
        inserted++;
      }
      this.inMemoryPlanets.set(key, colWithOwner);
    }

    this.syncToStorage();

    // Insertion SQL persistante si base de données relationnelle configurée
    try {
      const now = Date.now();
      for (const p of colonies) {
        await this.adapter.execute(
          `INSERT INTO pi_colonies (character_id, planet_id, solar_system_id, planet_type, upgrade_level, num_pins, last_update, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (character_id, planet_id)
           DO UPDATE SET solar_system_id = EXCLUDED.solar_system_id,
                         planet_type = EXCLUDED.planet_type,
                         upgrade_level = EXCLUDED.upgrade_level,
                         num_pins = EXCLUDED.num_pins,
                         last_update = EXCLUDED.last_update,
                         observed_at = EXCLUDED.observed_at`,
          [
            characterId,
            p.planet_id,
            p.solar_system_id,
            p.planet_type,
            p.upgrade_level,
            p.num_pins,
            p.last_update,
            now,
          ]
        );
      }
    } catch (sqlErr) {
      logger.debug(`[PiRepository] SQL colony upsert skipped: ${(sqlErr as Error).message}`);
    }

    return { inserted, updated };
  }

  public async saveColonyDetail(
    characterId: number,
    planetId: number,
    detail: RawEsiPlanetDetail
  ): Promise<void> {
    const key = this.makeKey(characterId, planetId);
    this.inMemoryDetails.set(key, detail);
    this.syncToStorage();

    // Upsert SQL des pins et routes
    try {
      const now = Date.now();
      if (Array.isArray(detail.pins)) {
        for (const pin of detail.pins) {
          const category = determinePinCategory(pin.type_id, {
            schematicId: pin.schematic_id,
            hasExtractor: !!pin.extractor_details,
          });
          const contentsStr = pin.contents ? JSON.stringify(pin.contents) : null;
          await this.adapter.execute(
            `INSERT INTO pi_pins (character_id, planet_id, pin_id, type_id, category, schematic_id, cycle_time, quantity_per_cycle, product_type_id, contents, expiry_time, last_cycle_start, install_time, latitude, longitude, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (character_id, planet_id, pin_id)
             DO UPDATE SET category = EXCLUDED.category,
                           schematic_id = EXCLUDED.schematic_id,
                           cycle_time = EXCLUDED.cycle_time,
                           quantity_per_cycle = EXCLUDED.quantity_per_cycle,
                           product_type_id = EXCLUDED.product_type_id,
                           contents = EXCLUDED.contents,
                           expiry_time = EXCLUDED.expiry_time,
                           last_cycle_start = EXCLUDED.last_cycle_start,
                           install_time = EXCLUDED.install_time,
                           latitude = EXCLUDED.latitude,
                           longitude = EXCLUDED.longitude,
                           observed_at = EXCLUDED.observed_at`,
            [
              characterId,
              planetId,
              pin.pin_id,
              pin.type_id,
              category,
              pin.schematic_id ?? pin.factory_details?.schematic_id ?? null,
              pin.extractor_details?.cycle_time ?? null,
              pin.extractor_details?.qty_per_cycle ?? null,
              pin.extractor_details?.product_type_id ?? null,
              contentsStr,
              pin.expiry_time ?? null,
              pin.last_cycle_start ?? null,
              pin.install_time ?? null,
              pin.latitude,
              pin.longitude,
              now,
            ]
          );
        }
      }

      if (Array.isArray(detail.routes)) {
        for (const r of detail.routes) {
          const waypointsStr = r.waypoints ? JSON.stringify(r.waypoints) : null;
          await this.adapter.execute(
            `INSERT INTO pi_routes (character_id, planet_id, route_id, source_pin_id, destination_pin_id, content_type_id, quantity, waypoints, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (character_id, planet_id, route_id)
             DO UPDATE SET source_pin_id = EXCLUDED.source_pin_id,
                           destination_pin_id = EXCLUDED.destination_pin_id,
                           content_type_id = EXCLUDED.content_type_id,
                           quantity = EXCLUDED.quantity,
                           waypoints = EXCLUDED.waypoints,
                           observed_at = EXCLUDED.observed_at`,
            [
              characterId,
              planetId,
              r.route_id,
              r.source_pin_id,
              r.destination_pin_id,
              r.content_type_id,
              r.quantity,
              waypointsStr,
              now,
            ]
          );
        }
      }
    } catch (sqlErr) {
      logger.debug(`[PiRepository] SQL pin/route upsert skipped: ${(sqlErr as Error).message}`);
    }
  }

  public getColonies(characterId?: number, characterIds?: number[]): RawEsiPlanet[] {
    let result = Array.from(this.inMemoryPlanets.values());
    if (characterId !== undefined) {
      result = result.filter((p) => p.owner_id === characterId);
    }
    if (characterIds && characterIds.length > 0) {
      const allowed = new Set(characterIds);
      result = result.filter((p) => allowed.has(p.owner_id));
    }
    return result;
  }

  public getColonyDetail(characterId: number, planetId: number): RawEsiPlanetDetail | null {
    return this.inMemoryDetails.get(this.makeKey(characterId, planetId)) || null;
  }

  public getAllColonyDetailsForCharacter(characterId: number): Record<number, RawEsiPlanetDetail> {
    const res: Record<number, RawEsiPlanetDetail> = {};
    for (const [key, detail] of this.inMemoryDetails.entries()) {
      const [charStr, planetStr] = key.split(':');
      if (Number(charStr) === characterId) {
        res[Number(planetStr)] = detail;
      }
    }
    return res;
  }

  /**
   * Extrait tous les stocks planétaires contenus dans les silos de stockage et spatioports
   * pour un personnage ou une flotte de personnages.
   * Ces stocks alimentent la classe de capital exclusive `PLANETARY_COLONY_STOCK`.
   */
  public getAggregatedStocksByCharacter(
    characterId?: number,
    characterIds?: number[]
  ): PiAggregatedStockItem[] {
    const colonies = this.getColonies(characterId, characterIds);
    const aggregated: PiAggregatedStockItem[] = [];

    for (const col of colonies) {
      const detail = this.getColonyDetail(col.owner_id, col.planet_id);
      if (!detail || !Array.isArray(detail.pins)) continue;

      for (const pin of detail.pins) {
        if (!pin.contents || pin.contents.length === 0) continue;

        const category = determinePinCategory(pin.type_id, {
          schematicId: pin.schematic_id,
          hasExtractor: !!pin.extractor_details,
        });

        // Les stocks de capital physique proviennent des silos, spatioports et centres de commande
        for (const item of pin.contents) {
          if (!item.amount || item.amount <= 0) continue;

          aggregated.push({
            characterId: col.owner_id,
            planetId: col.planet_id,
            solarSystemId: col.solar_system_id,
            pinId: pin.pin_id,
            pinCategory: category,
            typeId: item.type_id,
            typeName: `PI Item #${item.type_id}`,
            tier: 'UNKNOWN',
            quantity: item.amount,
            unitVolumeM3: 1.0,
            totalVolumeM3: item.amount,
            estimatedUnitValue: null,
            estimatedTotalValue: null,
            valuationStatus: 'UNKNOWN',
          });
        }
      }
    }

    return aggregated;
  }

  public async saveCustomsOffices(offices: RawEsiCustomsOffice[]): Promise<void> {
    for (const poco of offices) {
      this.inMemoryCustomsOffices.set(poco.solar_system_id, poco);
    }
    this.syncToStorage();

    try {
      const now = Date.now();
      for (const poco of offices) {
        await this.adapter.execute(
          `INSERT INTO pi_customs_offices (office_id, solar_system_id, corporation_tax_rate, alliance_tax_rate, standing_tax_rate, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (office_id)
           DO UPDATE SET corporation_tax_rate = EXCLUDED.corporation_tax_rate,
                         alliance_tax_rate = EXCLUDED.alliance_tax_rate,
                         standing_tax_rate = EXCLUDED.standing_tax_rate,
                         observed_at = EXCLUDED.observed_at`,
          [
            poco.office_id,
            poco.solar_system_id,
            poco.corporation_tax_rate ?? null,
            poco.alliance_tax_rate ?? null,
            poco.neutral_standing_tax_rate ?? null,
            now,
          ]
        );
      }
    } catch (sqlErr) {
      logger.debug(`[PiRepository] SQL POCO upsert skipped: ${(sqlErr as Error).message}`);
    }
  }

  public getCustomsOffice(systemId: number): RawEsiCustomsOffice | undefined {
    return this.inMemoryCustomsOffices.get(systemId);
  }

  public getAllCustomsOffices(): RawEsiCustomsOffice[] {
    return Array.from(this.inMemoryCustomsOffices.values());
  }

  public async deleteCharacterData(characterId: number): Promise<void> {
    for (const key of Array.from(this.inMemoryPlanets.keys())) {
      if (key.startsWith(`${characterId}:`)) {
        this.inMemoryPlanets.delete(key);
      }
    }
    for (const key of Array.from(this.inMemoryDetails.keys())) {
      if (key.startsWith(`${characterId}:`)) {
        this.inMemoryDetails.delete(key);
      }
    }
    this.syncToStorage();

    try {
      await this.adapter.execute('DELETE FROM pi_colonies WHERE character_id = $1', [characterId]);
      await this.adapter.execute('DELETE FROM pi_pins WHERE character_id = $1', [characterId]);
      await this.adapter.execute('DELETE FROM pi_routes WHERE character_id = $1', [characterId]);
    } catch {
      // Ignoré si adaptateur local
    }
  }

  public clearAll(): void {
    this.inMemoryPlanets.clear();
    this.inMemoryDetails.clear();
    this.inMemoryCustomsOffices.clear();
    this.syncToStorage();
  }
}

export const defaultPiRepository = new PiRepository();
