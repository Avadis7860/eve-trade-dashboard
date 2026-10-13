/**
 * Phase P03 — Colonies Planétaires & Flux de Matières PI
 * Types de domaine, contrats d'invariance et structures de données
 */

export type PiMaterialTier = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'UNKNOWN';

export type PiPinCategory =
  | 'COMMAND_CENTER'
  | 'EXTRACTOR'
  | 'BASIC_PROCESSOR'
  | 'ADVANCED_PROCESSOR'
  | 'HIGH_TECH_PROCESSOR'
  | 'STORAGE'
  | 'SPACEPORT'
  | 'OTHER';

export interface PiPinContentItem {
  typeId: number;
  typeName?: string;
  amount: number;
  tier: PiMaterialTier;
  volumeM3?: number;
  unitVolumeM3?: number;
  estimatedUnitValue: number | null; // null si INCONNU (JAMAIS 0.00 ISK sans preuve)
  estimatedTotalValue: number | null;
  valuationStatus: 'KNOWN' | 'UNKNOWN';
}

export interface PiPinModel {
  pinId: number;
  typeId: number;
  typeName?: string;
  category: PiPinCategory;
  schematicId?: number;
  schematicName?: string;
  cycleTimeSeconds?: number;
  quantityPerCycle?: number;
  productTypeId?: number;
  productTypeName?: string;
  hourlyOutputUnits?: number;
  hourlyOutputVolumeM3?: number;
  latitude: number;
  longitude: number;
  installTime?: string;
  expiryTime?: string;
  lastCycleStart?: string;
  capacityM3?: number;
  usedVolumeM3?: number;
  contents: PiPinContentItem[];
  isActive: boolean;
}

export interface PiRouteModel {
  routeId: number;
  sourcePinId: number;
  destinationPinId: number;
  contentTypeId: number;
  contentTypeName?: string;
  quantity: number;
  waypoints?: number[];
}

export interface PiLinkModel {
  sourcePinId: number;
  destinationPinId: number;
  linkLevel: number;
}

export interface PiPinDepletionForecast {
  pinId: number;
  category: PiPinCategory;
  typeId: number;
  typeName?: string;
  currentAmount: number;
  consumptionPerHour: number;
  productionPerHour: number;
  netRatePerHour: number;
  hoursUntilDepletion: number | null; // null si production nette positive ou nulle
  hoursUntilFull: number | null; // null si consommation nette ou stockage non plafonné
  estimatedDepletionDate: string | null; // ISO string
}

export interface PiColonySummary {
  characterId: number;
  characterName?: string;
  planetId: number;
  planetName?: string;
  planetType: string;
  solarSystemId: number;
  solarSystemName?: string;
  upgradeLevel: number;
  numPins: number;
  lastUpdate: string;
  observedAt: number;

  // Stocks immobilisés dans la colonie
  totalStockUnits: number;
  totalStockVolumeM3: number;
  totalCapacityM3: number;
  storageUtilizationPercent: number;
  estimatedStockValueIsk: number | null;
  valuationStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';

  // Cadences horaires
  activeExtractorsCount: number;
  activeProcessorsCount: number;
  hourlyExtractionUnits: number;
  hourlyExtractionVolumeM3: number;
  hourlyProductionUnits: number;
  hourlyProductionVolumeM3: number;

  // Alertes
  hasExpiringExtractors: boolean;
  hasDepletingInputs: boolean;
  earliestExpiryTime: string | null;
}

export interface PiColonyDetail extends PiColonySummary {
  pins: PiPinModel[];
  routes: PiRouteModel[];
  links: PiLinkModel[];
  depletionForecasts: PiPinDepletionForecast[];
}

export interface PiAggregatedStockItem {
  characterId: number;
  characterName?: string;
  planetId: number;
  planetName?: string;
  solarSystemId: number;
  solarSystemName?: string;
  pinId: number;
  pinCategory: PiPinCategory;
  typeId: number;
  typeName: string;
  tier: PiMaterialTier;
  quantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  estimatedUnitValue: number | null;
  estimatedTotalValue: number | null;
  valuationStatus: 'KNOWN' | 'UNKNOWN';
}

export interface PiCustomsOfficeInfo {
  officeId: number;
  solarSystemId: number;
  corporationTaxRate: number;
  allianceTaxRate: number;
  standingTaxRate: number;
  effectiveTaxRate: number; // e.g. SCC (0.10) + corp tax (0.05) = 0.15 (15%)
  observedAt: number;
}

export interface PiExportTaxCalculation {
  typeId: number;
  typeName: string;
  tier: PiMaterialTier;
  quantity: number;
  baseCustomsUnitValue: number;
  sccTaxRate: number; // Taux standard CCP (10%)
  pocoTaxRate: number; // Taux fixé par le propriétaire du POCO
  totalTaxRate: number;
  sccTaxIsk: number;
  pocoTaxIsk: number;
  totalExportTaxIsk: number;
  allocatedUnitTaxIsk: number;
}

export interface PiProductionRatesReport {
  asOf: number;
  totalColoniesCount: number;
  totalActiveExtractors: number;
  totalActiveProcessors: number;
  totalHourlyExtractionUnits: number;
  totalHourlyExtractionVolumeM3: number;
  totalHourlyProductionUnits: number;
  totalHourlyProductionVolumeM3: number;
  totalEstimatedStockValueIsk: number | null;
  stockValuationStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  extractionsByType: Array<{
    typeId: number;
    typeName: string;
    unitsPerHour: number;
    volumeM3PerHour: number;
  }>;
  productionsByType: Array<{
    typeId: number;
    typeName: string;
    tier: PiMaterialTier;
    unitsPerHour: number;
    volumeM3PerHour: number;
  }>;
}
