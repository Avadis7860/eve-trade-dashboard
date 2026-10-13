/**
 * Phase P02 — Registre Minier & Coûts d'Opportunité Farm / Mining
 * Moteur de calcul des volumes, valorisation d'extraction et intégration hermétique
 * Règle d'or : Les matières farmées ne coûtent jamais 0.00 ISK (UNKNOWN != 0.00).
 */

import type {
  MiningLedgerEntry,
  MiningLedgerFilterOptions,
  MiningLedgerSummary,
  MiningOpportunityReference,
  MiningTypeBreakdown,
  MiningSolarSystemBreakdown,
  MiningCharacterBreakdown,
  FarmDualProfitability,
  MiningValuationStatus,
} from './types.ts';
import { IMiningRepository, defaultMiningRepository } from './repository.ts';
import type { RawEsiMiningEntry } from '../esi/types.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { logger } from '../utils/logger.ts';

/**
 * Référentiel de prix standards indicatifs pour minerais et gaz EVE Online
 * Utilisé si aucun prix spécifique au hub ou surcharge n'est configuré.
 */
export const STANDARD_MINING_OPPORTUNITY_PRICES: Record<number, number> = {
  // Minéraux de base
  34: 4.25, // Tritanium
  35: 14.5, // Pyerite
  36: 95.0, // Mexallon
  37: 460.0, // Isogen
  38: 920.0, // Nocxium
  39: 2150.0, // Zydrine
  40: 4400.0, // Megacyte
  11399: 12500.0, // Morphite

  // Minerais bruts courants
  17459: 12.8, // Veldspar
  17460: 13.44, // Concentrated Veldspar
  17461: 14.08, // Dense Veldspar
  1228: 33.5, // Scordite
  17463: 35.17, // Condensed Scordite
  17464: 36.85, // Glossy Scordite
  1224: 68.0, // Pyroxeres
  17452: 71.4, // Solid Pyroxeres
  17453: 74.8, // Viscous Pyroxeres
  18: 57.5, // Plagioclase
  17455: 60.37, // Azure Plagioclase
  17456: 63.25, // Rich Plagioclase
  1227: 88.0, // Omber
  17867: 92.4, // Silvery Omber
  17868: 96.8, // Golden Omber
  20: 180.0, // Kernite
  174521: 189.0, // Luminous Kernite
  174522: 198.0, // Fiery Kernite
  1226: 330.0, // Jaspet
  1230: 560.0, // Hemorphite
  1229: 620.0, // Hedbergite
  1223: 870.0, // Gneiss
  1225: 1150.0, // Dark Ochre
  19: 2450.0, // Spodumain
  21: 3600.0, // Crokite
  12231: 4300.0, // Bistot
  22: 5900.0, // Arkonor
  11396: 18800.0, // Mercoxit

  // Gaz Fullero (W-space)
  30370: 4200.0, // Fullerite-C50
  30371: 7500.0, // Fullerite-C60
  30372: 9800.0, // Fullerite-C70
  30373: 14000.0, // Fullerite-C72
  30374: 19500.0, // Fullerite-C84
  30375: 38000.0, // Fullerite-C28
  30376: 68000.0, // Fullerite-C540
  30377: 95000.0, // Fullerite-C320
};

export class MiningService {
  private miningRepo: IMiningRepository;
  private universeService: UniverseService;

  constructor(
    miningRepo: IMiningRepository = defaultMiningRepository,
    universeService: UniverseService = defaultUniverseService
  ) {
    this.miningRepo = miningRepo;
    this.universeService = universeService;
  }

  /**
   * Obtient le prix d'opportunité unitaire estimé pour un typeId.
   * Si aucun prix n'est disponible, renvoie STRICTEMENT null (pas de 0.00).
   */
  public getEstimatedUnitValue(typeId: number): {
    estimatedUnitValue: number | null;
    status: 'KNOWN' | 'UNKNOWN';
    source: string;
  } {
    // 1. Référence enregistrée dans le repository (surcharge ou prix calculé)
    const customRef = this.miningRepo.getOpportunityReference(typeId);
    if (customRef && customRef.referencePrice > 0) {
      return {
        estimatedUnitValue: customRef.referencePrice,
        status: 'KNOWN',
        source: customRef.source,
      };
    }

    // 2. Référentiel de prix standards EVE Online
    const standardPrice = STANDARD_MINING_OPPORTUNITY_PRICES[typeId];
    if (standardPrice && standardPrice > 0) {
      return {
        estimatedUnitValue: standardPrice,
        status: 'KNOWN',
        source: 'FALLBACK_MINERAL_VALUE',
      };
    }

    // 3. Invariance stricte : si valeur inconnue, JAMAIS 0.00 ISK
    return {
      estimatedUnitValue: null,
      status: 'UNKNOWN',
      source: 'NONE',
    };
  }

  /**
   * Ingère les entrées brutes issues de l'ESI et les enrichit avec :
   * - la résolution de noms (système, minerai)
   * - le calcul du coût d'opportunité d'extraction
   * - la garantie hermétique realized_cash_cost_isk = 0.00 ISK
   */
  public async ingestRawMiningEntries(
    characterId: number,
    rawEntries: RawEsiMiningEntry[]
  ): Promise<{ inserted: number; updated: number; totalProcessed: number }> {
    if (!rawEntries || rawEntries.length === 0) {
      return { inserted: 0, updated: 0, totalProcessed: 0 };
    }

    // Récupérer les identifiants pour résolution de noms
    const typeIds = Array.from(new Set(rawEntries.map((e) => e.type_id)));
    const systemIds = Array.from(new Set(rawEntries.map((e) => e.solar_system_id)));

    let typeNames: Map<number, string> = new Map();
    let systemNames: Map<number, string> = new Map();

    try {
      if (this.universeService) {
        const [resolvedTypes, resolvedSystems] = await Promise.all([
          this.universeService.resolveNames(typeIds),
          this.universeService.resolveNames(systemIds),
        ]);
        typeNames = resolvedTypes;
        systemNames = resolvedSystems;
      }
    } catch (err) {
      logger.warn(`[MiningService] Name resolution warning: ${(err as Error).message}`);
    }

    const preparedEntries: Array<Omit<MiningLedgerEntry, 'id' | 'provenance' | 'realizedCashCostIsk'>> = [];

    for (const raw of rawEntries) {
      const typeId = raw.type_id;
      const quantity = Number(raw.quantity) || 0;
      const valInfo = this.getEstimatedUnitValue(typeId);

      const opportunityCostIsk =
        valInfo.estimatedUnitValue !== null
          ? Number((quantity * valInfo.estimatedUnitValue).toFixed(4))
          : null;

      preparedEntries.push({
        characterId,
        date: raw.date,
        solarSystemId: raw.solar_system_id,
        solarSystemName: systemNames.get(raw.solar_system_id) || `System #${raw.solar_system_id}`,
        typeId,
        typeName: typeNames.get(typeId) || `Type #${typeId}`,
        quantity,
        estimatedUnitValue: valInfo.estimatedUnitValue,
        opportunityCostIsk,
        costBasisStatus: valInfo.status,
        createdAt: Date.now(),
      });
    }

    const result = await this.miningRepo.saveMiningEntries(characterId, preparedEntries);
    return {
      inserted: result.inserted,
      updated: result.updated,
      totalProcessed: rawEntries.length,
    };
  }

  /**
   * Récupère le grand livre minier filtré
   */
  public async getLedger(
    characterIds: number[],
    filters?: MiningLedgerFilterOptions
  ): Promise<{ entries: MiningLedgerEntry[]; total: number; asOf: number }> {
    const entries = this.miningRepo.getMiningEntriesForCharacters(characterIds, filters);
    return {
      entries,
      total: entries.length,
      asOf: Date.now(),
    };
  }

  /**
   * Calcule la synthèse globale du grand livre minier avec décomposition
   * multidimensionnelle (par type, par système solaire, par personnage).
   */
  public async getSummary(
    characterIds: number[],
    filters?: MiningLedgerFilterOptions
  ): Promise<MiningLedgerSummary> {
    const entries = this.miningRepo.getMiningEntriesForCharacters(characterIds, filters);

    let totalQuantity = 0;
    let knownValueQuantity = 0;
    let unknownValueQuantity = 0;
    let totalOpportunityCostIsk: number | null = 0;
    let hasKnown = false;
    let hasUnknown = false;

    const dates = new Set<string>();
    const typeMap = new Map<number, {
      typeName?: string;
      quantity: number;
      opportunityCostIsk: number | null;
      estimatedUnitValue: number | null;
      hasKnown: boolean;
      hasUnknown: boolean;
    }>();
    const systemMap = new Map<number, {
      solarSystemName?: string;
      quantity: number;
      opportunityCostIsk: number | null;
    }>();
    const characterMap = new Map<number, {
      characterName?: string;
      quantity: number;
      opportunityCostIsk: number | null;
    }>();

    for (const entry of entries) {
      totalQuantity += entry.quantity;
      dates.add(entry.date);

      if (entry.opportunityCostIsk !== null) {
        hasKnown = true;
        knownValueQuantity += entry.quantity;
        totalOpportunityCostIsk = (totalOpportunityCostIsk ?? 0) + entry.opportunityCostIsk;
      } else {
        hasUnknown = true;
        unknownValueQuantity += entry.quantity;
      }

      // Par type
      const existingType = typeMap.get(entry.typeId) || {
        typeName: entry.typeName,
        quantity: 0,
        opportunityCostIsk: null,
        estimatedUnitValue: entry.estimatedUnitValue,
        hasKnown: false,
        hasUnknown: false,
      };
      existingType.quantity += entry.quantity;
      if (entry.opportunityCostIsk !== null) {
        existingType.hasKnown = true;
        existingType.opportunityCostIsk = (existingType.opportunityCostIsk ?? 0) + entry.opportunityCostIsk;
      } else {
        existingType.hasUnknown = true;
      }
      typeMap.set(entry.typeId, existingType);

      // Par système
      const existingSys = systemMap.get(entry.solarSystemId) || {
        solarSystemName: entry.solarSystemName,
        quantity: 0,
        opportunityCostIsk: null,
      };
      existingSys.quantity += entry.quantity;
      if (entry.opportunityCostIsk !== null) {
        existingSys.opportunityCostIsk = (existingSys.opportunityCostIsk ?? 0) + entry.opportunityCostIsk;
      }
      systemMap.set(entry.solarSystemId, existingSys);

      // Par personnage
      const existingChar = characterMap.get(entry.characterId) || {
        characterName: `Character #${entry.characterId}`,
        quantity: 0,
        opportunityCostIsk: null,
      };
      existingChar.quantity += entry.quantity;
      if (entry.opportunityCostIsk !== null) {
        existingChar.opportunityCostIsk = (existingChar.opportunityCostIsk ?? 0) + entry.opportunityCostIsk;
      }
      characterMap.set(entry.characterId, existingChar);
    }

    let valuationStatus: MiningValuationStatus = 'KNOWN';
    if (entries.length === 0) {
      valuationStatus = 'KNOWN';
      totalOpportunityCostIsk = 0;
    } else if (hasKnown && hasUnknown) {
      valuationStatus = 'PARTIAL';
    } else if (!hasKnown && hasUnknown) {
      valuationStatus = 'UNKNOWN';
      totalOpportunityCostIsk = null;
    }

    const byType: MiningTypeBreakdown[] = Array.from(typeMap.entries()).map(([typeId, val]) => ({
      typeId,
      typeName: val.typeName,
      quantity: val.quantity,
      estimatedUnitValue: val.estimatedUnitValue,
      opportunityCostIsk: val.opportunityCostIsk,
      valuationStatus: (val.hasUnknown && !val.hasKnown ? 'UNKNOWN' : 'KNOWN') as 'KNOWN' | 'UNKNOWN',
      percentageOfTotalQuantity: totalQuantity > 0 ? Number(((val.quantity / totalQuantity) * 100).toFixed(2)) : 0,
    })).sort((a, b) => b.quantity - a.quantity);

    const bySolarSystem: MiningSolarSystemBreakdown[] = Array.from(systemMap.entries()).map(
      ([solarSystemId, val]) => ({
        solarSystemId,
        solarSystemName: val.solarSystemName,
        quantity: val.quantity,
        opportunityCostIsk: val.opportunityCostIsk,
      })
    ).sort((a, b) => b.quantity - a.quantity);

    const byCharacter: MiningCharacterBreakdown[] = Array.from(characterMap.entries()).map(
      ([characterId, val]) => ({
        characterId,
        characterName: val.characterName,
        quantity: val.quantity,
        opportunityCostIsk: val.opportunityCostIsk,
      })
    ).sort((a, b) => b.quantity - a.quantity);

    return {
      totalQuantity,
      totalEntries: entries.length,
      activeDaysCount: dates.size,
      totalOpportunityCostIsk: totalOpportunityCostIsk !== null ? Number(totalOpportunityCostIsk.toFixed(2)) : null,
      valuationStatus,
      knownValueQuantity,
      unknownValueQuantity,
      uniqueTypesCount: typeMap.size,
      uniqueSolarSystemsCount: systemMap.size,
      byType,
      bySolarSystem,
      byCharacter,
      asOf: Date.now(),
    };
  }

  /**
   * Calcul dual de rentabilité : ROI commercial pur (basé sur le coût d'opportunité)
   * versus marge de trésorerie brute de farm (génération de liquidité par le temps de jeu).
   */
  public calculateDualProfitability(params: {
    typeId: number;
    typeName?: string;
    quantity: number;
    salePriceIsk: number;
    taxesIsk?: number;
    opportunityUnitPriceOverride?: number;
  }): FarmDualProfitability {
    const { typeId, typeName, quantity, salePriceIsk, taxesIsk = 0, opportunityUnitPriceOverride } = params;

    let unitValue: number | null = null;
    if (opportunityUnitPriceOverride !== undefined && opportunityUnitPriceOverride > 0) {
      unitValue = opportunityUnitPriceOverride;
    } else {
      const val = this.getEstimatedUnitValue(typeId);
      unitValue = val.estimatedUnitValue;
    }

    const opportunityCostIsk = unitValue !== null ? Number((quantity * unitValue).toFixed(2)) : null;

    let commercialProfitIsk: number | null = null;
    let commercialRoiPercent: number | null = null;

    if (opportunityCostIsk !== null) {
      commercialProfitIsk = Number((salePriceIsk - opportunityCostIsk - taxesIsk).toFixed(2));
      if (opportunityCostIsk > 0) {
        commercialRoiPercent = Number(((commercialProfitIsk / opportunityCostIsk) * 100).toFixed(2));
      }
    }

    const cashMarginIsk = Number((salePriceIsk - taxesIsk).toFixed(2));

    return {
      typeId,
      typeName,
      quantity,
      salePriceIsk,
      taxesIsk,
      opportunityCostIsk,
      commercialProfitIsk,
      commercialRoiPercent,
      realizedCashCostIsk: 0,
      cashMarginIsk,
      cashMarginPercent: 100,
      valuationStatus: opportunityCostIsk !== null ? 'KNOWN' : 'UNKNOWN',
    };
  }

  public setOpportunityPrice(typeId: number, price: number, source: MiningOpportunityReference['source'] = 'USER_OVERRIDE'): void {
    this.miningRepo.setOpportunityReference({
      typeId,
      referencePrice: price,
      source,
      updatedAt: Date.now(),
    });
  }

  public getOpportunityCosts(): MiningOpportunityReference[] {
    const custom = this.miningRepo.getAllOpportunityReferences();
    const map = new Map<number, MiningOpportunityReference>();

    // Remplir d'abord avec les prix standards
    for (const [tIdStr, price] of Object.entries(STANDARD_MINING_OPPORTUNITY_PRICES)) {
      const typeId = Number(tIdStr);
      map.set(typeId, {
        typeId,
        referencePrice: price,
        source: 'FALLBACK_MINERAL_VALUE',
        updatedAt: 0,
      });
    }

    // Écraser avec les custom refs
    for (const ref of custom) {
      map.set(ref.typeId, ref);
    }

    return Array.from(map.values());
  }

  /**
   * Recalcule les valorisations d'opportunité des entrées existantes
   */
  public async recalculateValuations(characterIds?: number[]): Promise<number> {
    const entries = this.miningRepo.getMiningEntries(characterIds ? { characterIds } : undefined);
    let updatedCount = 0;

    const byChar = new Map<number, Array<Omit<MiningLedgerEntry, 'id' | 'provenance' | 'realizedCashCostIsk'>>>();

    for (const entry of entries) {
      const val = this.getEstimatedUnitValue(entry.typeId);
      const opportunityCostIsk =
        val.estimatedUnitValue !== null ? Number((entry.quantity * val.estimatedUnitValue).toFixed(4)) : null;

      const list = byChar.get(entry.characterId) || [];
      list.push({
        characterId: entry.characterId,
        date: entry.date,
        solarSystemId: entry.solarSystemId,
        solarSystemName: entry.solarSystemName,
        typeId: entry.typeId,
        typeName: entry.typeName,
        quantity: entry.quantity,
        estimatedUnitValue: val.estimatedUnitValue,
        opportunityCostIsk,
        costBasisStatus: val.status,
        createdAt: entry.createdAt,
      });
      byChar.set(entry.characterId, list);
    }

    for (const [charId, list] of byChar.entries()) {
      const res = await this.miningRepo.saveMiningEntries(charId, list);
      updatedCount += res.updated;
    }

    return updatedCount;
  }
}

export const defaultMiningService = new MiningService();
