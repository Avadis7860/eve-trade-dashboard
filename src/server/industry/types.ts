/**
 * Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)
 * Modèles de domaine et contrats TypeScript pour les jobs d'industrie,
 * la nomenclature des composants (BOM) et la modélisation du capital en cours (WIP_INVENTORY_CAPITAL).
 */

export enum IndustryActivityId {
  MANUFACTURING = 1,
  TE_RESEARCH = 3,
  ME_RESEARCH = 4,
  COPYING = 5,
  INVENTION = 8,
  REACTIONS = 9,
}

export type IndustryJobStatus =
  | 'active'
  | 'paused'
  | 'ready'
  | 'delivered'
  | 'cancelled'
  | 'reverted';

export type IndustryJobSource = 'CHARACTER' | 'CORPORATION';

export type IndustryCostBasisStatus = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';

export type IndustryFeeReconciliationStatus =
  | 'EXACT_MATCH'
  | 'CORRELATED_BIJECTIVE'
  | 'UNMATCHED';

export interface IndustryJobFeeReconciliation {
  status: IndustryFeeReconciliationStatus;
  matchedJournalId?: number;
  matchedCanonicalId?: string;
  journalAmountIsk?: number; // ISK débité du portefeuille (valeur négative dans journal)
  jobCostIsk: number; // Frais d'installation du job (positif)
  discrepancyIsk: number;
  justification: string;
}

export interface IndustryJob {
  jobId: number;
  installerId: number;
  installerName?: string;
  facilityId: number;
  stationId: number;
  activityId: number;
  activityName: string;
  blueprintId: number;
  blueprintTypeId: number;
  blueprintTypeName?: string;
  blueprintLocationId: number;
  outputLocationId: number;
  productTypeId?: number;
  productTypeName?: string;
  status: IndustryJobStatus;
  duration: number; // Durée totale en secondes
  startDate: string; // ISO 8601 UTC
  endDate: string; // ISO 8601 UTC
  pauseDate?: string;
  completedDate?: string;
  completedCharacterId?: number;
  runs: number;
  successfulRuns?: number;
  cost?: number; // Frais d'installation payés au lancement (ISK)
  licensedRuns?: number;
  probability?: number;
  source: IndustryJobSource;
  characterId: number; // Personnage observant / propriétaire
  corporationId?: number; // Corporation si job corpos
  observedAt: number;
  installationFeeReconciliation?: IndustryJobFeeReconciliation;
}

export interface BomMaterialInput {
  typeId: number;
  typeName: string;
  quantityPerRun: number;
  totalQuantity: number;
  unitCostIsk: number | null; // null si UNKNOWN
  totalCostIsk: number | null;
  costBasisStatus: IndustryCostBasisStatus;
}

export interface BomProductOutput {
  typeId: number;
  typeName: string;
  quantityPerRun: number;
  totalQuantity: number;
  estimatedUnitValueIsk: number | null;
}

export interface IndustryJobBom {
  jobId: number;
  blueprintTypeId: number;
  blueprintTypeName: string;
  activityId: number;
  activityName: string;
  runs: number;
  product: BomProductOutput;
  materials: BomMaterialInput[];
  totalInputCostIsk: number | null;
  installationCostIsk: number;
  totalWipCostIsk: number | null;
  wipStatus: IndustryCostBasisStatus;
}

export interface BlueprintDefinition {
  blueprintTypeId: number;
  blueprintTypeName: string;
  productTypeId: number;
  productTypeName: string;
  productQuantityPerRun: number;
  activityId: number;
  materials: Array<{
    typeId: number;
    typeName: string;
    quantity: number; // par run
  }>;
}

export interface IndustryWipJobSummary {
  jobId: number;
  characterId: number;
  corporationId?: number;
  source: IndustryJobSource;
  activityId: number;
  activityName: string;
  productTypeId?: number;
  productTypeName?: string;
  runs: number;
  startDate: string;
  endDate: string;
  remainingSeconds: number;
  installationCostIsk: number;
  inputsCostIsk: number | null;
  totalWipCostIsk: number | null;
  wipStatus: IndustryCostBasisStatus;
  status: IndustryJobStatus;
}

export interface IndustryWipCapitalSummary {
  asOf: number;
  activeJobsCount: number;
  totalWipCommittedIsk: number; // Somme des frais de pose + intrants connus
  totalInstallationFeesIsk: number;
  totalInputsCostIsk: number;
  wipStatus: IndustryCostBasisStatus;
  jobs: IndustryWipJobSummary[];
}

export interface IndustryJobFilters {
  characterId?: number;
  characterIds?: number[];
  corporationId?: number;
  installerId?: number;
  status?: IndustryJobStatus | string;
  activityId?: number;
  productTypeId?: number;
  blueprintTypeId?: number;
  source?: IndustryJobSource;
}

export interface IndustryFeeReconciliationSummary {
  totalJobsWithCost: number;
  totalFeeIsk: number;
  matchedFeeIsk: number;
  unmatchedFeeIsk: number;
  matchRatio: number; // 0..100 %
  exactMatchesCount: number;
  correlatedMatchesCount: number;
  unmatchedCount: number;
}

export interface IndustryOverviewSummary {
  asOf: number;
  totalJobsCount: number;
  activeJobsCount: number;
  readyJobsCount: number;
  deliveredJobsCount: number;
  pausedJobsCount: number;
  cancelledJobsCount: number;
  characterJobsCount: number;
  corporationJobsCount: number;
  jobsByActivity: Record<string, number>;
  wipSummary: IndustryWipCapitalSummary;
  reconciliationSummary: IndustryFeeReconciliationSummary;
  upcomingCompletions: IndustryJob[];
}

export function getIndustryActivityName(activityId: number): string {
  switch (activityId) {
    case IndustryActivityId.MANUFACTURING:
      return 'Manufacturing';
    case IndustryActivityId.TE_RESEARCH:
      return 'Time Efficiency Research';
    case IndustryActivityId.ME_RESEARCH:
      return 'Material Efficiency Research';
    case IndustryActivityId.COPYING:
      return 'Copying';
    case IndustryActivityId.INVENTION:
      return 'Invention';
    case IndustryActivityId.REACTIONS:
      return 'Reactions';
    default:
      return `Activity #${activityId}`;
  }
}
