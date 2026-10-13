/**
 * Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)
 * Service métier orchestrant le cycle de vie des jobs, la nomenclature BOM,
 * la corrélation déterministe des frais d'installation et la modélisation du capital WIP.
 */

import type {
  IndustryJob,
  IndustryJobFilters,
  IndustryJobSource,
  IndustryJobBom,
  BomMaterialInput,
  BomProductOutput,
  IndustryWipCapitalSummary,
  IndustryWipJobSummary,
  IndustryOverviewSummary,
  IndustryFeeReconciliationSummary,
  BlueprintDefinition,
} from './types.ts';
import { getIndustryActivityName } from './types.ts';
import { IIndustryRepository, defaultIndustryRepository } from './repository.ts';
import type { RawEsiIndustryJob } from '../esi/types.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { STANDARD_MINING_OPPORTUNITY_PRICES } from '../mining/service.ts';
import { roundIsk } from '../roi/calculator.ts';

/**
 * Référentiel statique de nomenclatures de fabrication (Bill of Materials) courantes.
 * Permet une résolution déterministe de la composition des composants sans appel externe.
 */
export const STANDARD_BLUEPRINTS: Record<number, BlueprintDefinition> = {
  // 688: Caracal Blueprint -> Product 621: Caracal (Cruiser Caldari)
  688: {
    blueprintTypeId: 688,
    blueprintTypeName: 'Caracal Blueprint',
    productTypeId: 621,
    productTypeName: 'Caracal',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 380000 },
      { typeId: 35, typeName: 'Pyerite', quantity: 110000 },
      { typeId: 36, typeName: 'Mexallon', quantity: 32000 },
      { typeId: 37, typeName: 'Isogen', quantity: 5800 },
      { typeId: 38, typeName: 'Nocxium', quantity: 1400 },
      { typeId: 39, typeName: 'Zydrine', quantity: 280 },
      { typeId: 40, typeName: 'Megacyte', quantity: 95 },
    ],
  },
  // 684: Rifter Blueprint -> Product 587: Rifter (Frigate Minmatar)
  684: {
    blueprintTypeId: 684,
    blueprintTypeName: 'Rifter Blueprint',
    productTypeId: 587,
    productTypeName: 'Rifter',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 18500 },
      { typeId: 35, typeName: 'Pyerite', quantity: 5200 },
      { typeId: 36, typeName: 'Mexallon', quantity: 1600 },
      { typeId: 37, typeName: 'Isogen', quantity: 210 },
      { typeId: 38, typeName: 'Nocxium', quantity: 28 },
    ],
  },
  // 685: Tristan Blueprint -> Product 593: Tristan (Frigate Gallente)
  685: {
    blueprintTypeId: 685,
    blueprintTypeName: 'Tristan Blueprint',
    productTypeId: 593,
    productTypeName: 'Tristan',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 17800 },
      { typeId: 35, typeName: 'Pyerite', quantity: 5400 },
      { typeId: 36, typeName: 'Mexallon', quantity: 1550 },
      { typeId: 37, typeName: 'Isogen', quantity: 220 },
      { typeId: 38, typeName: 'Nocxium', quantity: 26 },
    ],
  },
  // 686: Kestrel Blueprint -> Product 602: Kestrel (Frigate Caldari)
  686: {
    blueprintTypeId: 686,
    blueprintTypeName: 'Kestrel Blueprint',
    productTypeId: 602,
    productTypeName: 'Kestrel',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 18200 },
      { typeId: 35, typeName: 'Pyerite', quantity: 5100 },
      { typeId: 36, typeName: 'Mexallon', quantity: 1650 },
      { typeId: 37, typeName: 'Isogen', quantity: 200 },
      { typeId: 38, typeName: 'Nocxium', quantity: 30 },
    ],
  },
  // 178: Antidote Charges Blueprint -> Product 178: Antidote Charges
  1167: {
    blueprintTypeId: 1167,
    blueprintTypeName: 'Scourge Heavy Missile Blueprint',
    productTypeId: 209,
    productTypeName: 'Scourge Heavy Missile',
    productQuantityPerRun: 100,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 1150 },
      { typeId: 35, typeName: 'Pyerite', quantity: 280 },
      { typeId: 36, typeName: 'Mexallon', quantity: 45 },
    ],
  },
};

export class IndustryService {
  private repo: IIndustryRepository;
  private ledgerRepo: ILedgerRepository;
  private universeService: UniverseService;

  constructor(
    repo: IIndustryRepository = defaultIndustryRepository,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    universeService: UniverseService = defaultUniverseService
  ) {
    this.repo = repo;
    this.ledgerRepo = ledgerRepo;
    this.universeService = universeService;
  }

  /**
   * Ingeste une liste de jobs bruts ESI pour un personnage ou une corporation.
   * Enrichit les noms d'articles et d'activités et exécute automatiquement la réconciliation fiscale.
   */
  public async ingestRawJobs(
    characterId: number,
    rawJobs: RawEsiIndustryJob[],
    source: IndustryJobSource = 'CHARACTER',
    corporationId?: number
  ): Promise<{ inserted: number; updated: number; jobs: IndustryJob[] }> {
    const enrichedJobs: IndustryJob[] = [];

    for (const raw of rawJobs) {
      const activityName = getIndustryActivityName(raw.activity_id);
      const blueprintTypeName = this.universeService.getNameSync(raw.blueprint_type_id, 'Type');
      const productTypeName = raw.product_type_id
        ? this.universeService.getNameSync(raw.product_type_id, 'Type')
        : undefined;
      const installerName = this.universeService.getNameSync(raw.installer_id, 'Character');

      const job: IndustryJob = {
        jobId: raw.job_id,
        installerId: raw.installer_id,
        installerName: installerName !== `Item #${raw.installer_id}` ? installerName : undefined,
        facilityId: raw.facility_id,
        stationId: raw.station_id,
        activityId: raw.activity_id,
        activityName,
        blueprintId: raw.blueprint_id,
        blueprintTypeId: raw.blueprint_type_id,
        blueprintTypeName: blueprintTypeName !== `Item #${raw.blueprint_type_id}` ? blueprintTypeName : undefined,
        blueprintLocationId: raw.blueprint_location_id,
        outputLocationId: raw.output_location_id,
        productTypeId: raw.product_type_id,
        productTypeName: productTypeName !== `Item #${raw.product_type_id}` ? productTypeName : undefined,
        status: (raw.status as IndustryJob['status']) || 'active',
        duration: raw.duration,
        startDate: raw.start_date,
        endDate: raw.end_date,
        pauseDate: raw.pause_date,
        completedDate: raw.completed_date,
        completedCharacterId: raw.completed_character_id,
        runs: raw.runs,
        successfulRuns: raw.successful_runs,
        cost: raw.cost !== undefined ? Number(raw.cost) : undefined,
        licensedRuns: raw.licensed_runs,
        probability: raw.probability !== undefined ? Number(raw.probability) : undefined,
        source,
        characterId,
        corporationId,
        observedAt: Date.now(),
      };

      enrichedJobs.push(job);
    }

    const res = await this.repo.saveJobs(enrichedJobs);

    // Exécuter la réconciliation des frais de pose après l'enregistrement
    await this.reconcileJobInstallationFees(characterId);

    return {
      inserted: res.inserted,
      updated: res.updated,
      jobs: enrichedJobs,
    };
  }

  /**
   * Corrélation déterministe des frais d'installation de jobs avec les écritures du journal de portefeuille.
   * Rapproche le coût du job (cost) avec les entrées 'industry_job_tax' pour éviter tout double comptage.
   */
  public async reconcileJobInstallationFees(
    characterId?: number,
    characterIds?: number[]
  ): Promise<IndustryFeeReconciliationSummary> {
    const jobs = this.repo.getJobs({ characterId, characterIds });
    const effectiveCharIds = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : Array.from(new Set(jobs.map((j) => j.characterId)));

    // Récupérer toutes les écritures de journal de type industry_job_tax
    const candidateJournalEntries = [];
    for (const charId of effectiveCharIds) {
      const { items } = await this.ledgerRepo.getJournalEntries(charId, 1, 2000);
      for (const jn of items) {
        if (
          jn.refType === 'industry_job_tax' ||
          jn.refType === 'facility_tax' ||
          jn.refType === 'job_tax' ||
          jn.contextIdType === 'industry_job_id'
        ) {
          candidateJournalEntries.push(jn);
        }
      }
    }

    // Suivi d'unicité 1-to-1 pour les écritures de journal déjà allouées
    const usedJournalKeys = new Set<string>();

    let totalJobsWithCost = 0;
    let totalFeeIsk = 0;
    let matchedFeeIsk = 0;
    let exactMatchesCount = 0;
    let correlatedMatchesCount = 0;
    let unmatchedCount = 0;

    for (const job of jobs) {
      const jobCost = job.cost ?? 0;
      if (jobCost <= 0) continue;

      totalJobsWithCost++;
      totalFeeIsk += jobCost;

      // 1. Recherche par contextId exact (match direct ESI)
      const exactMatch = candidateJournalEntries.find((jn) => {
        const jnKey = jn.id || `${jn.characterId}:${jn.journalId}`;
        return (
          !usedJournalKeys.has(jnKey) &&
          jn.contextId !== undefined &&
          Number(jn.contextId) === job.jobId
        );
      });

      if (exactMatch) {
        const jnKey = exactMatch.id || `${exactMatch.characterId}:${exactMatch.journalId}`;
        usedJournalKeys.add(jnKey);
        const jnAmount = Math.abs(exactMatch.amount || 0);
        const discrepancy = roundIsk(Math.abs(jobCost - jnAmount));

        this.repo.updateJobFeeReconciliation(job.jobId, {
          status: 'EXACT_MATCH',
          matchedJournalId: exactMatch.journalId,
          matchedCanonicalId: exactMatch.id,
          journalAmountIsk: exactMatch.amount,
          jobCostIsk: jobCost,
          discrepancyIsk: discrepancy,
          justification: `Matched exactly with journal entry #${exactMatch.journalId} (context_id == ${job.jobId})`,
        });

        matchedFeeIsk += jobCost;
        exactMatchesCount++;
        continue;
      }

      // 2. Recherche par corrélation bijective (même personnage, date proche +/- 300s, montant identique)
      const jobStartTime = new Date(job.startDate).getTime();
      const correlatedMatch = candidateJournalEntries.find((jn) => {
        const jnKey = jn.id || `${jn.characterId}:${jn.journalId}`;
        if (usedJournalKeys.has(jnKey)) return false;
        if (jn.characterId !== job.characterId && jn.firstPartyId !== job.installerId) return false;

        const jnTime = new Date(jn.date).getTime();
        const timeDiffSeconds = Math.abs(jobStartTime - jnTime) / 1000;
        const jnAmount = Math.abs(jn.amount || 0);
        const amountDiff = Math.abs(jobCost - jnAmount);

        // Doit concorder à moins de 300s et moins de 1 ISK d'écart
        return timeDiffSeconds <= 300 && amountDiff < 1.0;
      });

      if (correlatedMatch) {
        const jnKey = correlatedMatch.id || `${correlatedMatch.characterId}:${correlatedMatch.journalId}`;
        usedJournalKeys.add(jnKey);
        const jnAmount = Math.abs(correlatedMatch.amount || 0);
        const discrepancy = roundIsk(Math.abs(jobCost - jnAmount));

        this.repo.updateJobFeeReconciliation(job.jobId, {
          status: 'CORRELATED_BIJECTIVE',
          matchedJournalId: correlatedMatch.journalId,
          matchedCanonicalId: correlatedMatch.id,
          journalAmountIsk: correlatedMatch.amount,
          jobCostIsk: jobCost,
          discrepancyIsk: discrepancy,
          justification: `Bijectively correlated with journal entry #${correlatedMatch.journalId} by timestamp and fee amount`,
        });

        matchedFeeIsk += jobCost;
        correlatedMatchesCount++;
        continue;
      }

      // 3. Sans écriture trouvée -> UNMATCHED
      this.repo.updateJobFeeReconciliation(job.jobId, {
        status: 'UNMATCHED',
        jobCostIsk: jobCost,
        discrepancyIsk: jobCost,
        justification: `No matching industry_job_tax journal entry found in the observed ledger window`,
      });
      unmatchedCount++;
    }

    const totalFee = roundIsk(totalFeeIsk);
    const matchedFee = roundIsk(matchedFeeIsk);
    const unmatchedFee = roundIsk(totalFee - matchedFee);
    const matchRatio = totalFee > 0 ? Number(((matchedFee / totalFee) * 100).toFixed(2)) : 100;

    return {
      totalJobsWithCost,
      totalFeeIsk: totalFee,
      matchedFeeIsk: matchedFee,
      unmatchedFeeIsk: unmatchedFee,
      matchRatio,
      exactMatchesCount,
      correlatedMatchesCount,
      unmatchedCount,
    };
  }

  /**
   * Résout la nomenclature (Bill of Materials - BOM) d'un job d'industrie.
   */
  public getJobBom(jobOrId: number | IndustryJob): IndustryJobBom {
    const job = typeof jobOrId === 'number' ? this.repo.getJobById(jobOrId) : jobOrId;
    if (!job) {
      throw new Error(`Job #${jobOrId} not found`);
    }

    const runs = job.runs || 1;
    const blueprintDef = STANDARD_BLUEPRINTS[job.blueprintTypeId];

    let materials: BomMaterialInput[] = [];
    let product: BomProductOutput;
    let wipStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' = 'KNOWN';

    if (blueprintDef) {
      product = {
        typeId: blueprintDef.productTypeId,
        typeName: blueprintDef.productTypeName,
        quantityPerRun: blueprintDef.productQuantityPerRun,
        totalQuantity: blueprintDef.productQuantityPerRun * runs,
        estimatedUnitValueIsk: STANDARD_MINING_OPPORTUNITY_PRICES[blueprintDef.productTypeId] ?? null,
      };

      materials = blueprintDef.materials.map((m) => {
        const unitPrice = STANDARD_MINING_OPPORTUNITY_PRICES[m.typeId] ?? null;
        const totalQty = m.quantity * runs;
        const totalCost = unitPrice !== null ? roundIsk(unitPrice * totalQty) : null;
        const costBasisStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' = unitPrice !== null ? 'KNOWN' : 'UNKNOWN';

        if (costBasisStatus === 'UNKNOWN') {
          wipStatus = 'PARTIAL';
        }

        return {
          typeId: m.typeId,
          typeName: m.typeName,
          quantityPerRun: m.quantity,
          totalQuantity: totalQty,
          unitCostIsk: unitPrice,
          totalCostIsk: totalCost,
          costBasisStatus,
        };
      });
    } else {
      // Estimation générique basée sur les identifiants ESI
      const prodTypeId = job.productTypeId || job.blueprintTypeId;
      const prodName = job.productTypeName || this.universeService.getNameSync(prodTypeId, 'Type');

      product = {
        typeId: prodTypeId,
        typeName: prodName,
        quantityPerRun: 1,
        totalQuantity: runs,
        estimatedUnitValueIsk: STANDARD_MINING_OPPORTUNITY_PRICES[prodTypeId] ?? null,
      };

      // Si blueprint inconnu du catalogue statique, statut UNKNOWN pour les intrants
      materials = [];
      wipStatus = 'UNKNOWN';
    }

    const hasKnownMaterials = materials.some((m) => m.totalCostIsk !== null);
    const totalInputCostIsk = hasKnownMaterials
      ? roundIsk(materials.reduce((acc, m) => acc + (m.totalCostIsk || 0), 0))
      : null;

    const installationCostIsk = job.cost ? roundIsk(job.cost) : 0;
    const totalWipCostIsk = totalInputCostIsk !== null
      ? roundIsk(totalInputCostIsk + installationCostIsk)
      : installationCostIsk > 0
      ? installationCostIsk
      : null;

    return {
      jobId: job.jobId,
      blueprintTypeId: job.blueprintTypeId,
      blueprintTypeName: job.blueprintTypeName || `Blueprint #${job.blueprintTypeId}`,
      activityId: job.activityId,
      activityName: job.activityName,
      runs,
      product,
      materials,
      totalInputCostIsk,
      installationCostIsk,
      totalWipCostIsk,
      wipStatus,
    };
  }

  /**
   * Calcule le capital immobilisé en cours de fabrication (WIP_INVENTORY_CAPITAL).
   * Formule : WIP = sum_{jobs actifs} (Coût des intrants engagés + Frais de pose du job)
   */
  public getWipCapital(characterId?: number, characterIds?: number[]): IndustryWipCapitalSummary {
    const activeJobs = this.repo.getActiveJobs(characterId, characterIds);
    const now = Date.now();

    const jobSummaries: IndustryWipJobSummary[] = [];
    let totalInstallationFees = 0;
    let totalInputsCost = 0;
    let hasUnknownOrPartial = false;

    for (const job of activeJobs) {
      const bom = this.getJobBom(job);
      const remainingSeconds = Math.max(
        0,
        Math.floor((new Date(job.endDate).getTime() - now) / 1000)
      );

      const instCost = bom.installationCostIsk;
      const inputsCost = bom.totalInputCostIsk;
      const totalJobWip = bom.totalWipCostIsk;

      totalInstallationFees += instCost;
      if (inputsCost !== null) {
        totalInputsCost += inputsCost;
      } else {
        hasUnknownOrPartial = true;
      }

      if (bom.wipStatus !== 'KNOWN') {
        hasUnknownOrPartial = true;
      }

      jobSummaries.push({
        jobId: job.jobId,
        characterId: job.characterId,
        corporationId: job.corporationId,
        source: job.source,
        activityId: job.activityId,
        activityName: job.activityName,
        productTypeId: job.productTypeId,
        productTypeName: job.productTypeName,
        runs: job.runs,
        startDate: job.startDate,
        endDate: job.endDate,
        remainingSeconds,
        installationCostIsk: instCost,
        inputsCostIsk: inputsCost,
        totalWipCostIsk: totalJobWip,
        wipStatus: bom.wipStatus,
        status: job.status,
      });
    }

    const totalInstallationFeesIsk = roundIsk(totalInstallationFees);
    const totalInputsCostIsk = roundIsk(totalInputsCost);
    const totalWipCommittedIsk = roundIsk(totalInstallationFeesIsk + totalInputsCostIsk);

    const wipStatus: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' =
      activeJobs.length === 0
        ? 'KNOWN'
        : hasUnknownOrPartial
        ? totalInputsCostIsk > 0
          ? 'PARTIAL'
          : 'UNKNOWN'
        : 'KNOWN';

    return {
      asOf: now,
      activeJobsCount: activeJobs.length,
      totalWipCommittedIsk,
      totalInstallationFeesIsk,
      totalInputsCostIsk,
      wipStatus,
      jobs: jobSummaries.sort((a, b) => a.remainingSeconds - b.remainingSeconds),
    };
  }

  /**
   * Synthèse complète du grand livre industriel.
   */
  public async getSummary(characterId?: number, characterIds?: number[]): Promise<IndustryOverviewSummary> {
    const jobs = this.repo.getJobs({ characterId, characterIds });
    const now = Date.now();

    let activeJobsCount = 0;
    let readyJobsCount = 0;
    let deliveredJobsCount = 0;
    let pausedJobsCount = 0;
    let cancelledJobsCount = 0;
    let characterJobsCount = 0;
    let corporationJobsCount = 0;

    const jobsByActivity: Record<string, number> = {};

    for (const job of jobs) {
      if (job.status === 'active') activeJobsCount++;
      else if (job.status === 'ready') readyJobsCount++;
      else if (job.status === 'delivered') deliveredJobsCount++;
      else if (job.status === 'paused') pausedJobsCount++;
      else if (job.status === 'cancelled') cancelledJobsCount++;

      if (job.source === 'CHARACTER') characterJobsCount++;
      else if (job.source === 'CORPORATION') corporationJobsCount++;

      const actName = job.activityName || `Activity #${job.activityId}`;
      jobsByActivity[actName] = (jobsByActivity[actName] || 0) + 1;
    }

    const wipSummary = this.getWipCapital(characterId, characterIds);
    const reconciliationSummary = await this.reconcileJobInstallationFees(characterId, characterIds);

    // Échéances à venir (jobs actifs triés par fin de cycle)
    const upcomingCompletions = jobs
      .filter((j) => j.status === 'active')
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

    return {
      asOf: now,
      totalJobsCount: jobs.length,
      activeJobsCount,
      readyJobsCount,
      deliveredJobsCount,
      pausedJobsCount,
      cancelledJobsCount,
      characterJobsCount,
      corporationJobsCount,
      jobsByActivity,
      wipSummary,
      reconciliationSummary,
      upcomingCompletions,
    };
  }

  /**
   * Récupère les jobs filtrés.
   */
  public getJobs(filters?: IndustryJobFilters): IndustryJob[] {
    return this.repo.getJobs(filters);
  }

  /**
   * Récupère un job par ID.
   */
  public getJobById(jobId: number): IndustryJob | undefined {
    return this.repo.getJobById(jobId);
  }
}

export const defaultIndustryService = new IndustryService();
