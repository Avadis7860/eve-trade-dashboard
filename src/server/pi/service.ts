/**
 * Phase P03 — Colonies Planétaires & Flux de Matières PI
 * Moteur de calcul des colonies, valorisation des stocks, cadences horaires et taxes de douanes POCO
 */

import type {
  RawEsiPlanet,
  RawEsiPlanetDetail,
} from '../esi/types.ts';
import type {
  PiAggregatedStockItem,
  PiColonyDetail,
  PiColonySummary,
  PiExportTaxCalculation,
  PiMaterialTier,
  PiPinCategory,
  PiPinContentItem,
  PiPinDepletionForecast,
  PiPinModel,
  PiProductionRatesReport,
  PiRouteModel,
} from './types.ts';
import {
  IPiRepository,
  defaultPiRepository,
  determinePinCategory,
  PI_TIER_VOLUMES,
} from './repository.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { roundIsk } from '../roi/calculator.ts';
import { logger } from '../utils/logger.ts';

/**
 * Valeurs douanières officielles CCP pour le calcul des taxes d'import/export POCO (Base Customs Value)
 */
export const PI_BASE_CUSTOMS_VALUES: Record<PiMaterialTier, number> = {
  P0: 5.0,
  P1: 400.0,
  P2: 7200.0,
  P3: 60000.0,
  P4: 1200000.0,
  UNKNOWN: 100.0,
};

/**
 * Taux standard de taxe SCC (10% par défaut dans EVE Online pour les exports planétaires)
 */
export const DEFAULT_SCC_EXPORT_TAX_RATE = 0.10;

/**
 * Capacités standards des pins planétaires ($m^3$)
 */
export const PIN_STANDARD_CAPACITIES_M3: Record<PiPinCategory, number> = {
  COMMAND_CENTER: 500,
  STORAGE: 12000,
  SPACEPORT: 10000,
  BASIC_PROCESSOR: 500,
  ADVANCED_PROCESSOR: 500,
  HIGH_TECH_PROCESSOR: 500,
  EXTRACTOR: 0,
  OTHER: 100,
};

/**
 * Référentiel des matières premières (P0) et produits (P1-P4) EVE Online
 */
export const KNOWN_PI_COMMODITIES: Record<number, { name: string; tier: PiMaterialTier; standardPrice: number }> = {
  // P0 - Raw Materials (0.01 m3)
  2073: { name: 'Microorganisms', tier: 'P0', standardPrice: 12.0 },
  2267: { name: 'Aqueous Liquids', tier: 'P0', standardPrice: 14.5 },
  2268: { name: 'Autotrophs', tier: 'P0', standardPrice: 11.0 },
  2270: { name: 'Felsic Magma', tier: 'P0', standardPrice: 13.0 },
  2272: { name: 'Microbial Colonies', tier: 'P0', standardPrice: 12.5 },
  2286: { name: 'Planktic Colonies', tier: 'P0', standardPrice: 10.5 },
  2287: { name: 'Complex Organisms', tier: 'P0', standardPrice: 15.0 },
  2288: { name: 'Carbon Compounds', tier: 'P0', standardPrice: 11.5 },
  2305: { name: 'Noble Gas', tier: 'P0', standardPrice: 16.0 },
  2306: { name: 'Reactive Gas', tier: 'P0', standardPrice: 14.0 },
  2307: { name: 'Suspended Plasma', tier: 'P0', standardPrice: 17.5 },
  2308: { name: 'Ionic Solutions', tier: 'P0', standardPrice: 15.5 },
  2309: { name: 'Base Metals', tier: 'P0', standardPrice: 9.5 },
  2310: { name: 'Heavy Metals', tier: 'P0', standardPrice: 18.0 },
  2311: { name: 'Noble Metals', tier: 'P0', standardPrice: 22.0 },
  25268: { name: 'Non-CS Crystals', tier: 'P0', standardPrice: 19.0 },

  // P1 - Processed Materials (0.38 m3)
  2389: { name: 'Plasmoids', tier: 'P1', standardPrice: 620.0 },
  2390: { name: 'Electrolytes', tier: 'P1', standardPrice: 580.0 },
  2392: { name: 'Oxidizing Compound', tier: 'P1', standardPrice: 610.0 },
  2393: { name: 'Bacteria', tier: 'P1', standardPrice: 640.0 },
  2395: { name: 'Proteins', tier: 'P1', standardPrice: 660.0 },
  2396: { name: 'Biofuels', tier: 'P1', standardPrice: 590.0 },
  2397: { name: 'Industrial Fibers', tier: 'P1', standardPrice: 630.0 },
  2398: { name: 'Reactive Metals', tier: 'P1', standardPrice: 520.0 },
  2399: { name: 'Precious Metals', tier: 'P1', standardPrice: 980.0 },
  2400: { name: 'Toxic Metals', tier: 'P1', standardPrice: 710.0 },
  2401: { name: 'Chiral Sugars', tier: 'P1', standardPrice: 650.0 },
  3645: { name: 'Water', tier: 'P1', standardPrice: 540.0 },
  3683: { name: 'Oxygen', tier: 'P1', standardPrice: 720.0 },
  3779: { name: 'Biomass', tier: 'P1', standardPrice: 700.0 },
  9832: { name: 'Coolant', tier: 'P1', standardPrice: 750.0 },
  9848: { name: 'Silicon', tier: 'P1', standardPrice: 680.0 },

  // P2 - Refined Commodities (1.50 m3)
  44: { name: 'Enriched Uranium', tier: 'P2', standardPrice: 9500.0 },
  2312: { name: 'Supertensile Plastics', tier: 'P2', standardPrice: 10200.0 },
  2317: { name: 'Oxides', tier: 'P2', standardPrice: 9800.0 },
  2319: { name: 'Test Cultures', tier: 'P2', standardPrice: 9400.0 },
  2321: { name: 'Polytextiles', tier: 'P2', standardPrice: 10500.0 },
  2327: { name: 'Microfiber Shielding', tier: 'P2', standardPrice: 11200.0 },
  2328: { name: 'Water-Cooled CPU', tier: 'P2', standardPrice: 12500.0 },
  2329: { name: 'Biocells', tier: 'P2', standardPrice: 9900.0 },
  2463: { name: 'Nanites', tier: 'P2', standardPrice: 11800.0 },
  3828: { name: 'Construction Blocks', tier: 'P2', standardPrice: 10800.0 },
  9836: { name: 'Consumer Electronics', tier: 'P2', standardPrice: 10100.0 },
  9842: { name: 'Mechanical Parts', tier: 'P2', standardPrice: 10400.0 },

  // P3 - Specialized Commodities (6.00 m3)
  2344: { name: 'Condensates', tier: 'P3', standardPrice: 72000.0 },
  2345: { name: 'Camera Drones', tier: 'P3', standardPrice: 84000.0 },
  2348: { name: 'Gel-Matrix Biopaste', tier: 'P3', standardPrice: 88000.0 },
  2349: { name: 'Supercomputers', tier: 'P3', standardPrice: 96000.0 },
  2351: { name: 'Cryoprotectant Solution', tier: 'P3', standardPrice: 75000.0 },
  2352: { name: 'Data Chips', tier: 'P3', standardPrice: 92000.0 },
  2354: { name: 'High-Tech Transmitters', tier: 'P3', standardPrice: 89000.0 },
  2358: { name: 'Biotech Research Reports', tier: 'P3', standardPrice: 81000.0 },
  2360: { name: 'Industrial Explosives', tier: 'P3', standardPrice: 79000.0 },
  2361: { name: 'Hermetic Membranes', tier: 'P3', standardPrice: 85000.0 },
  2366: { name: 'Guidance Systems', tier: 'P3', standardPrice: 91000.0 },
  2367: { name: 'Hazmat Detection Systems', tier: 'P3', standardPrice: 87000.0 },
  28974: { name: 'Planetary Vehicles', tier: 'P3', standardPrice: 98000.0 },

  // P4 - Advanced Commodities (52.00 m3)
  2867: { name: 'Broadcast Node', tier: 'P4', standardPrice: 2200000.0 },
  2868: { name: 'Integrity Response Drones', tier: 'P4', standardPrice: 2450000.0 },
  2869: { name: 'Nano-Factory', tier: 'P4', standardPrice: 2150000.0 },
  2870: { name: 'Organic Mortar Applicators', tier: 'P4', standardPrice: 2300000.0 },
  2871: { name: 'Recursive Computing Module', tier: 'P4', standardPrice: 2600000.0 },
  2872: { name: 'Self-Harmonizing Power Core', tier: 'P4', standardPrice: 2550000.0 },
  2875: { name: 'Wetware Mainframe', tier: 'P4', standardPrice: 2700000.0 },
  2876: { name: 'Sterile Conduits', tier: 'P4', standardPrice: 2100000.0 },
};

export class PiService {
  private piRepo: IPiRepository;
  private universeService: UniverseService;
  private ledgerRepo: ILedgerRepository;

  constructor(
    piRepo: IPiRepository = defaultPiRepository,
    universeService: UniverseService = defaultUniverseService,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository
  ) {
    this.piRepo = piRepo;
    this.universeService = universeService;
    this.ledgerRepo = ledgerRepo;
  }

  /**
   * Obtient les métadonnées et la valeur unitaire estimée pour un matériau PI
   */
  public getCommodityInfo(typeId: number): {
    name: string;
    tier: PiMaterialTier;
    unitVolumeM3: number;
    estimatedUnitValue: number | null;
    status: 'KNOWN' | 'UNKNOWN';
  } {
    const known = KNOWN_PI_COMMODITIES[typeId];
    if (known) {
      return {
        name: known.name,
        tier: known.tier,
        unitVolumeM3: PI_TIER_VOLUMES[known.tier] || 1.0,
        estimatedUnitValue: known.standardPrice,
        status: 'KNOWN',
      };
    }

    return {
      name: `Type #${typeId}`,
      tier: 'UNKNOWN',
      unitVolumeM3: 1.0,
      estimatedUnitValue: null,
      status: 'UNKNOWN',
    };
  }

  /**
   * Ingère les colonies et détails de pins reçus de l'ESI pour un personnage
   */
  public async ingestColoniesAndDetails(
    characterId: number,
    planets: RawEsiPlanet[],
    planetDetails: Record<number, RawEsiPlanetDetail>
  ): Promise<void> {
    await this.piRepo.saveColonies(characterId, planets);
    for (const [planetIdStr, detail] of Object.entries(planetDetails)) {
      const planetId = Number(planetIdStr);
      await this.piRepo.saveColonyDetail(characterId, planetId, detail);
    }
  }

  /**
   * Construit la synthèse complète de chaque colonie planétaire
   */
  public async getColonySummaries(
    characterId?: number,
    characterIds?: number[]
  ): Promise<PiColonySummary[]> {
    const rawColonies = this.piRepo.getColonies(characterId, characterIds);
    const summaries: PiColonySummary[] = [];

    // Résolution en masse des noms de systèmes et personnages
    const systemIds = Array.from(new Set(rawColonies.map((c) => c.solar_system_id)));
    const charIds = Array.from(new Set(rawColonies.map((c) => c.owner_id)));

    let systemNames = new Map<number, string>();
    let charNames = new Map<number, string>();

    try {
      if (this.universeService) {
        const [resolvedSys, resolvedChars] = await Promise.all([
          this.universeService.resolveNames(systemIds),
          this.universeService.resolveNames(charIds),
        ]);
        systemNames = resolvedSys;
        charNames = resolvedChars;
      }
    } catch (err) {
      logger.warn(`[PiService] Universe name resolution warning: ${(err as Error).message}`);
    }

    for (const col of rawColonies) {
      const detail = this.piRepo.getColonyDetail(col.owner_id, col.planet_id);

      let totalStockUnits = 0;
      let totalStockVolumeM3 = 0;
      let totalCapacityM3 = 0;
      let estimatedStockValueIsk: number | null = 0;
      let hasKnownValue = false;
      let hasUnknownValue = false;

      let activeExtractorsCount = 0;
      let activeProcessorsCount = 0;
      let hourlyExtractionUnits = 0;
      let hourlyExtractionVolumeM3 = 0;
      let hourlyProductionUnits = 0;
      let hourlyProductionVolumeM3 = 0;

      let hasExpiringExtractors = false;
      let earliestExpiryTime: string | null = null;

      if (detail && Array.isArray(detail.pins)) {
        for (const pin of detail.pins) {
          const cat = determinePinCategory(pin.type_id, {
            schematicId: pin.schematic_id,
            hasExtractor: !!pin.extractor_details,
          });

          // Capacité
          const pinCapacity = PIN_STANDARD_CAPACITIES_M3[cat] || 0;
          totalCapacityM3 += pinCapacity;

          // Extraction horaire
          if (cat === 'EXTRACTOR' && pin.extractor_details) {
            activeExtractorsCount++;
            const cycleSec = pin.extractor_details.cycle_time || 900;
            const qtyPerCycle = pin.extractor_details.qty_per_cycle || 0;
            const unitsPerHour = cycleSec > 0 ? (qtyPerCycle * 3600) / cycleSec : 0;
            hourlyExtractionUnits += unitsPerHour;
            hourlyExtractionVolumeM3 += unitsPerHour * 0.01; // P0 = 0.01 m3

            if (pin.expiry_time) {
              const expDate = new Date(pin.expiry_time).getTime();
              const now = Date.now();
              if (expDate <= now + 24 * 3600 * 1000) {
                hasExpiringExtractors = true;
              }
              if (!earliestExpiryTime || pin.expiry_time < earliestExpiryTime) {
                earliestExpiryTime = pin.expiry_time;
              }
            }
          }

          // Transformation industrielle horaire (usines)
          if (
            (cat === 'BASIC_PROCESSOR' ||
              cat === 'ADVANCED_PROCESSOR' ||
              cat === 'HIGH_TECH_PROCESSOR') &&
            pin.schematic_id
          ) {
            activeProcessorsCount++;
            // Un cycle d'usine standard = 1800s (30m) pour P1 ou 3600s (1h) pour P2/P3/P4
            const cyclesPerHour = cat === 'BASIC_PROCESSOR' ? 2 : 1;
            const outputUnitsPerCycle = cat === 'BASIC_PROCESSOR' ? 20 : 5;
            const outputTier: PiMaterialTier =
              cat === 'BASIC_PROCESSOR'
                ? 'P1'
                : cat === 'ADVANCED_PROCESSOR'
                ? 'P2'
                : 'P4';
            const prodUnitsPerHour = cyclesPerHour * outputUnitsPerCycle;
            hourlyProductionUnits += prodUnitsPerHour;
            hourlyProductionVolumeM3 += prodUnitsPerHour * (PI_TIER_VOLUMES[outputTier] || 1.0);
          }

          // Inventaire en stock
          if (Array.isArray(pin.contents)) {
            for (const item of pin.contents) {
              if (item.amount > 0) {
                const comm = this.getCommodityInfo(item.type_id);
                totalStockUnits += item.amount;
                totalStockVolumeM3 += item.amount * comm.unitVolumeM3;

                if (comm.estimatedUnitValue !== null) {
                  hasKnownValue = true;
                  estimatedStockValueIsk =
                    (estimatedStockValueIsk ?? 0) + item.amount * comm.estimatedUnitValue;
                } else {
                  hasUnknownValue = true;
                }
              }
            }
          }
        }
      }

      let valuationStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' = 'KNOWN';
      if (totalStockUnits === 0) {
        valuationStatus = 'KNOWN';
        estimatedStockValueIsk = 0;
      } else if (hasKnownValue && hasUnknownValue) {
        valuationStatus = 'PARTIAL';
        estimatedStockValueIsk = roundIsk(estimatedStockValueIsk ?? 0);
      } else if (!hasKnownValue && hasUnknownValue) {
        valuationStatus = 'UNKNOWN';
        estimatedStockValueIsk = null;
      } else {
        valuationStatus = 'KNOWN';
        estimatedStockValueIsk = roundIsk(estimatedStockValueIsk ?? 0);
      }

      const storageUtilizationPercent =
        totalCapacityM3 > 0
          ? Number(((totalStockVolumeM3 / totalCapacityM3) * 100).toFixed(2))
          : 0;

      summaries.push({
        characterId: col.owner_id,
        characterName: charNames.get(col.owner_id) || `Character #${col.owner_id}`,
        planetId: col.planet_id,
        planetName: `Planet #${col.planet_id}`,
        planetType: col.planet_type,
        solarSystemId: col.solar_system_id,
        solarSystemName: systemNames.get(col.solar_system_id) || `System #${col.solar_system_id}`,
        upgradeLevel: col.upgrade_level,
        numPins: col.num_pins,
        lastUpdate: col.last_update,
        observedAt: Date.now(),

        totalStockUnits,
        totalStockVolumeM3: Number(totalStockVolumeM3.toFixed(2)),
        totalCapacityM3,
        storageUtilizationPercent,
        estimatedStockValueIsk,
        valuationStatus,

        activeExtractorsCount,
        activeProcessorsCount,
        hourlyExtractionUnits: Number(hourlyExtractionUnits.toFixed(1)),
        hourlyExtractionVolumeM3: Number(hourlyExtractionVolumeM3.toFixed(2)),
        hourlyProductionUnits: Number(hourlyProductionUnits.toFixed(1)),
        hourlyProductionVolumeM3: Number(hourlyProductionVolumeM3.toFixed(2)),

        hasExpiringExtractors,
        hasDepletingInputs: false,
        earliestExpiryTime,
      });
    }

    return summaries;
  }

  /**
   * Inspection approfondie d'une colonie spécifique avec pins, routes, links et prévisions d'épuisement
   */
  public async getColonyDetail(
    characterId: number,
    planetId: number
  ): Promise<PiColonyDetail | null> {
    const rawColonies = this.piRepo.getColonies(characterId);
    const colony = rawColonies.find((c) => c.planet_id === planetId);
    if (!colony) return null;

    const rawDetail = this.piRepo.getColonyDetail(characterId, planetId);
    const summaryList = await this.getColonySummaries(characterId);
    const summary = summaryList.find((s) => s.planetId === planetId);
    if (!summary) return null;

    const pins: PiPinModel[] = [];
    const routes: PiRouteModel[] = [];
    const links = (rawDetail?.links || []).map((l) => ({
      sourcePinId: l.source_pin_id,
      destinationPinId: l.destination_pin_id,
      linkLevel: l.link_level,
    }));

    // Résolution des types
    const typeIdsToResolve = new Set<number>();
    if (rawDetail && Array.isArray(rawDetail.pins)) {
      for (const p of rawDetail.pins) {
        typeIdsToResolve.add(p.type_id);
        if (p.extractor_details?.product_type_id) {
          typeIdsToResolve.add(p.extractor_details.product_type_id);
        }
        if (p.contents) {
          for (const c of p.contents) typeIdsToResolve.add(c.type_id);
        }
      }
    }
    if (rawDetail && Array.isArray(rawDetail.routes)) {
      for (const r of rawDetail.routes) typeIdsToResolve.add(r.content_type_id);
    }

    let resolvedTypeNames = new Map<number, string>();
    try {
      if (this.universeService && typeIdsToResolve.size > 0) {
        resolvedTypeNames = await this.universeService.resolveNames(Array.from(typeIdsToResolve));
      }
    } catch {
      // Ignorer
    }

    // Traitement des routes
    if (rawDetail && Array.isArray(rawDetail.routes)) {
      for (const r of rawDetail.routes) {
        const comm = this.getCommodityInfo(r.content_type_id);
        routes.push({
          routeId: r.route_id,
          sourcePinId: r.source_pin_id,
          destinationPinId: r.destination_pin_id,
          contentTypeId: r.content_type_id,
          contentTypeName: resolvedTypeNames.get(r.content_type_id) || comm.name,
          quantity: r.quantity,
          waypoints: r.waypoints,
        });
      }
    }

    // Traitement des pins
    if (rawDetail && Array.isArray(rawDetail.pins)) {
      for (const p of rawDetail.pins) {
        const category = determinePinCategory(p.type_id, {
          schematicId: p.schematic_id,
          hasExtractor: !!p.extractor_details,
        });
        const capacityM3 = PIN_STANDARD_CAPACITIES_M3[category] || 0;

        let usedVolumeM3 = 0;
        const contents: PiPinContentItem[] = [];

        if (Array.isArray(p.contents)) {
          for (const c of p.contents) {
            const comm = this.getCommodityInfo(c.type_id);
            const volumeM3 = c.amount * comm.unitVolumeM3;
            usedVolumeM3 += volumeM3;

            const estTotal =
              comm.estimatedUnitValue !== null ? roundIsk(c.amount * comm.estimatedUnitValue) : null;

            contents.push({
              typeId: c.type_id,
              typeName: resolvedTypeNames.get(c.type_id) || comm.name,
              amount: c.amount,
              tier: comm.tier,
              volumeM3: Number(volumeM3.toFixed(2)),
              unitVolumeM3: comm.unitVolumeM3,
              estimatedUnitValue: comm.estimatedUnitValue,
              estimatedTotalValue: estTotal,
              valuationStatus: comm.status,
            });
          }
        }

        let hourlyOutputUnits: number | undefined;
        let hourlyOutputVolumeM3: number | undefined;

        if (category === 'EXTRACTOR' && p.extractor_details) {
          const cycleSec = p.extractor_details.cycle_time || 900;
          const qty = p.extractor_details.qty_per_cycle || 0;
          hourlyOutputUnits = cycleSec > 0 ? (qty * 3600) / cycleSec : 0;
          hourlyOutputVolumeM3 = hourlyOutputUnits * 0.01;
        }

        pins.push({
          pinId: p.pin_id,
          typeId: p.type_id,
          typeName: resolvedTypeNames.get(p.type_id) || `Pin #${p.pin_id}`,
          category,
          schematicId: p.schematic_id ?? p.factory_details?.schematic_id,
          cycleTimeSeconds: p.extractor_details?.cycle_time,
          quantityPerCycle: p.extractor_details?.qty_per_cycle,
          productTypeId: p.extractor_details?.product_type_id,
          productTypeName: p.extractor_details?.product_type_id
            ? resolvedTypeNames.get(p.extractor_details.product_type_id)
            : undefined,
          hourlyOutputUnits: hourlyOutputUnits !== undefined ? Number(hourlyOutputUnits.toFixed(1)) : undefined,
          hourlyOutputVolumeM3: hourlyOutputVolumeM3 !== undefined ? Number(hourlyOutputVolumeM3.toFixed(2)) : undefined,
          latitude: p.latitude,
          longitude: p.longitude,
          installTime: p.install_time,
          expiryTime: p.expiry_time,
          lastCycleStart: p.last_cycle_start,
          capacityM3,
          usedVolumeM3: Number(usedVolumeM3.toFixed(2)),
          contents,
          isActive: true,
        });
      }
    }

    // Calcul des prévisions d'épuisement pour les pins de stockage alimentant des usines
    const depletionForecasts: PiPinDepletionForecast[] = [];
    for (const pin of pins) {
      if (pin.category === 'STORAGE' || pin.category === 'SPACEPORT' || pin.category === 'COMMAND_CENTER') {
        for (const item of pin.contents) {
          // Calcul des routes sortantes de ce pin pour cet item (consommation usine)
          const outgoingRoutes = routes.filter(
            (r) => r.sourcePinId === pin.pinId && r.contentTypeId === item.typeId
          );
          const incomingRoutes = routes.filter(
            (r) => r.destinationPinId === pin.pinId && r.contentTypeId === item.typeId
          );

          const outgoingHourly = outgoingRoutes.reduce((acc, r) => acc + (r.quantity || 0), 0);
          const incomingHourly = incomingRoutes.reduce((acc, r) => acc + (r.quantity || 0), 0);
          const netRate = incomingHourly - outgoingHourly;

          let hoursUntilDepletion: number | null = null;
          let estimatedDepletionDate: string | null = null;

          if (netRate < 0 && item.amount > 0) {
            hoursUntilDepletion = Number((item.amount / Math.abs(netRate)).toFixed(1));
            const msUntil = hoursUntilDepletion * 3600 * 1000;
            estimatedDepletionDate = new Date(Date.now() + msUntil).toISOString();
          }

          let hoursUntilFull: number | null = null;
          if (netRate > 0 && pin.capacityM3 && pin.capacityM3 > 0) {
            const comm = this.getCommodityInfo(item.typeId);
            const remainingM3 = Math.max(0, pin.capacityM3 - (pin.usedVolumeM3 || 0));
            const netM3PerHour = netRate * comm.unitVolumeM3;
            if (netM3PerHour > 0) {
              hoursUntilFull = Number((remainingM3 / netM3PerHour).toFixed(1));
            }
          }

          if (outgoingHourly > 0 || incomingHourly > 0) {
            depletionForecasts.push({
              pinId: pin.pinId,
              category: pin.category,
              typeId: item.typeId,
              typeName: item.typeName,
              currentAmount: item.amount,
              consumptionPerHour: outgoingHourly,
              productionPerHour: incomingHourly,
              netRatePerHour: netRate,
              hoursUntilDepletion,
              hoursUntilFull,
              estimatedDepletionDate,
            });
          }
        }
      }
    }

    return {
      ...summary,
      pins,
      routes,
      links,
      depletionForecasts,
    };
  }

  /**
   * Extrait tous les stocks planétaires consolidés pour le domaine de capital
   * (Alimente `PLANETARY_COLONY_STOCK`)
   */
  public async getAggregatedStocks(
    characterIds?: number[]
  ): Promise<PiAggregatedStockItem[]> {
    const rawStocks = this.piRepo.getAggregatedStocksByCharacter(undefined, characterIds);

    // Résolution en masse des noms de types et systèmes
    const typeIds = Array.from(new Set(rawStocks.map((s) => s.typeId)));
    const systemIds = Array.from(new Set(rawStocks.map((s) => s.solarSystemId)));
    const charIds = Array.from(new Set(rawStocks.map((s) => s.characterId)));

    let typeNames = new Map<number, string>();
    let sysNames = new Map<number, string>();
    let charNames = new Map<number, string>();

    try {
      if (this.universeService) {
        const [rTypes, rSys, rChars] = await Promise.all([
          this.universeService.resolveNames(typeIds),
          this.universeService.resolveNames(systemIds),
          this.universeService.resolveNames(charIds),
        ]);
        typeNames = rTypes;
        sysNames = rSys;
        charNames = rChars;
      }
    } catch {
      // Ignorer
    }

    return rawStocks.map((stock) => {
      const comm = this.getCommodityInfo(stock.typeId);
      const estTotal =
        comm.estimatedUnitValue !== null ? roundIsk(stock.quantity * comm.estimatedUnitValue) : null;

      return {
        ...stock,
        typeName: typeNames.get(stock.typeId) || comm.name,
        characterName: charNames.get(stock.characterId) || `Character #${stock.characterId}`,
        solarSystemName: sysNames.get(stock.solarSystemId) || `System #${stock.solarSystemId}`,
        planetName: `Planet #${stock.planetId}`,
        tier: comm.tier,
        unitVolumeM3: comm.unitVolumeM3,
        totalVolumeM3: Number((stock.quantity * comm.unitVolumeM3).toFixed(2)),
        estimatedUnitValue: comm.estimatedUnitValue,
        estimatedTotalValue: estTotal,
        valuationStatus: comm.status,
      };
    });
  }

  /**
   * Calcule le rapport global des cadences de production et d'extraction de la flotte
   */
  public async getProductionRatesReport(
    characterIds?: number[]
  ): Promise<PiProductionRatesReport> {
    const summaries = await this.getColonySummaries(undefined, characterIds);

    const totalColoniesCount = summaries.length;
    let totalActiveExtractors = 0;
    let totalActiveProcessors = 0;
    let totalHourlyExtractionUnits = 0;
    let totalHourlyExtractionVolumeM3 = 0;
    let totalHourlyProductionUnits = 0;
    let totalHourlyProductionVolumeM3 = 0;
    let totalEstimatedStockValueIsk: number | null = 0;
    let hasKnown = false;
    let hasUnknown = false;

    const extractionsMap = new Map<number, { name: string; units: number; volume: number }>();
    const productionsMap = new Map<number, { name: string; tier: PiMaterialTier; units: number; volume: number }>();

    for (const s of summaries) {
      totalActiveExtractors += s.activeExtractorsCount;
      totalActiveProcessors += s.activeProcessorsCount;
      totalHourlyExtractionUnits += s.hourlyExtractionUnits;
      totalHourlyExtractionVolumeM3 += s.hourlyExtractionVolumeM3;
      totalHourlyProductionUnits += s.hourlyProductionUnits;
      totalHourlyProductionVolumeM3 += s.hourlyProductionVolumeM3;

      if (s.estimatedStockValueIsk !== null) {
        hasKnown = true;
        totalEstimatedStockValueIsk = (totalEstimatedStockValueIsk ?? 0) + s.estimatedStockValueIsk;
      } else {
        hasUnknown = true;
      }
    }

    let stockValuationStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' = 'KNOWN';
    if (summaries.length === 0) {
      stockValuationStatus = 'KNOWN';
      totalEstimatedStockValueIsk = 0;
    } else if (hasKnown && hasUnknown) {
      stockValuationStatus = 'PARTIAL';
      totalEstimatedStockValueIsk = roundIsk(totalEstimatedStockValueIsk ?? 0);
    } else if (!hasKnown && hasUnknown) {
      stockValuationStatus = 'UNKNOWN';
      totalEstimatedStockValueIsk = null;
    } else {
      stockValuationStatus = 'KNOWN';
      totalEstimatedStockValueIsk = roundIsk(totalEstimatedStockValueIsk ?? 0);
    }

    const extractionsByType = Array.from(extractionsMap.entries()).map(([typeId, val]) => ({
      typeId,
      typeName: val.name,
      unitsPerHour: Number(val.units.toFixed(1)),
      volumeM3PerHour: Number(val.volume.toFixed(2)),
    }));

    const productionsByType = Array.from(productionsMap.entries()).map(([typeId, val]) => ({
      typeId,
      typeName: val.name,
      tier: val.tier,
      unitsPerHour: Number(val.units.toFixed(1)),
      volumeM3PerHour: Number(val.volume.toFixed(2)),
    }));

    return {
      asOf: Date.now(),
      totalColoniesCount,
      totalActiveExtractors,
      totalActiveProcessors,
      totalHourlyExtractionUnits: Number(totalHourlyExtractionUnits.toFixed(1)),
      totalHourlyExtractionVolumeM3: Number(totalHourlyExtractionVolumeM3.toFixed(2)),
      totalHourlyProductionUnits: Number(totalHourlyProductionUnits.toFixed(1)),
      totalHourlyProductionVolumeM3: Number(totalHourlyProductionVolumeM3.toFixed(2)),
      totalEstimatedStockValueIsk,
      stockValuationStatus,
      extractionsByType,
      productionsByType,
    };
  }

  /**
   * Calcule la taxe douanière d'exportation POCO pour un lot de matériaux planétaires
   * Invariance CCP : Taxe = BaseCustomsValue * (SCC_Rate + POCO_Rate) * Quantité
   */
  public calculateExportTax(params: {
    typeId: number;
    quantity: number;
    pocoTaxRate?: number; // e.g. 0.05 pour 5%
    solarSystemId?: number;
  }): PiExportTaxCalculation {
    const { typeId, quantity, solarSystemId } = params;
    const comm = this.getCommodityInfo(typeId);
    const baseValue = PI_BASE_CUSTOMS_VALUES[comm.tier] || 100.0;
    const sccTaxRate = DEFAULT_SCC_EXPORT_TAX_RATE; // 10%

    let pocoTaxRate = params.pocoTaxRate;
    if (pocoTaxRate === undefined && solarSystemId !== undefined) {
      const poco = this.piRepo.getCustomsOffice(solarSystemId);
      if (poco) {
        pocoTaxRate = poco.corporation_tax_rate ?? 0.05;
      }
    }
    if (pocoTaxRate === undefined) {
      pocoTaxRate = 0.05; // 5% par défaut si non spécifié
    }

    const totalTaxRate = Number((sccTaxRate + pocoTaxRate).toFixed(4));
    const sccTaxIsk = roundIsk(baseValue * sccTaxRate * quantity);
    const pocoTaxIsk = roundIsk(baseValue * pocoTaxRate * quantity);
    const totalExportTaxIsk = roundIsk(sccTaxIsk + pocoTaxIsk);
    const allocatedUnitTaxIsk = quantity > 0 ? Number((totalExportTaxIsk / quantity).toFixed(4)) : 0;

    return {
      typeId,
      typeName: comm.name,
      tier: comm.tier,
      quantity,
      baseCustomsUnitValue: baseValue,
      sccTaxRate,
      pocoTaxRate,
      totalTaxRate,
      sccTaxIsk,
      pocoTaxIsk,
      totalExportTaxIsk,
      allocatedUnitTaxIsk,
    };
  }

  /**
   * Impute déterministement les taxes d'exportation POCO issues du grand livre de portefeuille
   * (`ref_type: 'planetary_export_tax'`) aux lots exportés pour calculer le coût de revient unitaire TTC.
   */
  public imputeExportTaxesToLandedLots(
    characterId: number,
    batches: Array<{ typeId: number; quantity: number }>
  ): Array<{
    typeId: number;
    quantity: number;
    totalLandedTaxIsk: number;
    allocatedUnitTaxIsk: number;
    isTaxReconciledFromJournal: boolean;
  }> {
    // Récupérer les écritures du journal de portefeuille de type 'planetary_export_tax'
    const { items: journalItems } = this.ledgerRepo.getJournalEntries(characterId, 1, 200);
    const exportTaxEntries = journalItems.filter(
      (j) => j.refType === 'planetary_export_tax' || j.refType === 'planetary_tax'
    );

    const totalJournalTaxPaid = exportTaxEntries.reduce((acc, j) => acc + Math.abs(j.amount ?? 0), 0);

    const totalCalculatedTax = batches.reduce((acc, b) => {
      const calc = this.calculateExportTax({ typeId: b.typeId, quantity: b.quantity });
      return acc + calc.totalExportTaxIsk;
    }, 0);

    const results = [];
    for (const b of batches) {
      const calc = this.calculateExportTax({ typeId: b.typeId, quantity: b.quantity });

      let attributedTax = calc.totalExportTaxIsk;
      let reconciled = false;

      // Si le journal contient des taxes d'exportation réelles, proratiser proportionnellement
      if (totalJournalTaxPaid > 0 && totalCalculatedTax > 0) {
        attributedTax = roundIsk(totalJournalTaxPaid * (calc.totalExportTaxIsk / totalCalculatedTax));
        reconciled = true;
      }

      const unitTax = b.quantity > 0 ? Number((attributedTax / b.quantity).toFixed(4)) : 0;
      results.push({
        typeId: b.typeId,
        quantity: b.quantity,
        totalLandedTaxIsk: attributedTax,
        allocatedUnitTaxIsk: unitTax,
        isTaxReconciledFromJournal: reconciled,
      });
    }

    return results;
  }
}

export const defaultPiService = new PiService();
