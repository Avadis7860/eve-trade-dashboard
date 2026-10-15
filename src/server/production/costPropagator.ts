/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Sous-moteur spécialisé pour la propagation ascendante le long de l'arbre BOM (Bill of Materials)
 * et des schémas de Planetary Interaction, garantissant une traçabilité sans rupture.
 */

import type {
  ProductionCostAllocation,
  ProductionLineage,
  BomInputAllocation,
  BomInputSourceLot,
  ProductionCostBasisStatus,
  MultiTierCostBreakdown,
  CostBreakdownNode,
} from './types.ts';
import type { IndustryJob, BlueprintDefinition } from '../industry/types.ts';
import { STANDARD_BLUEPRINTS } from '../industry/service.ts';
import type { IIndustryRepository } from '../industry/repository.ts';
import { defaultIndustryRepository } from '../industry/repository.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { IMiningRepository } from '../mining/repository.ts';
import { defaultMiningRepository } from '../mining/repository.ts';
import type { IPiRepository } from '../pi/repository.ts';
import { defaultPiRepository } from '../pi/repository.ts';
import type { IProductionRepository } from './repository.ts';
import { defaultProductionRepository } from './repository.ts';
import type { IRoiRepository } from '../roi/repository.ts';
import { defaultRoiRepository } from '../roi/repository.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { STANDARD_MINING_OPPORTUNITY_PRICES } from '../mining/service.ts';
import { roundIsk } from '../roi/calculator.ts';
import type { FormulaProof } from '../roi/types.ts';

/**
 * Catalogue étendu des nomenclatures multi-niveaux (T2 & PI).
 */
export const MULTI_TIER_BLUEPRINTS: Record<number, BlueprintDefinition> = {
  ...STANDARD_BLUEPRINTS,
  // 11536: Antimatter Reactor Unit Blueprint -> Product 11536
  11536: {
    blueprintTypeId: 11536,
    blueprintTypeName: 'Antimatter Reactor Unit Blueprint',
    productTypeId: 11536,
    productTypeName: 'Antimatter Reactor Unit',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 5000 },
      { typeId: 37, typeName: 'Isogen', quantity: 600 },
      { typeId: 38, typeName: 'Nocxium', quantity: 120 },
    ],
  },
  // 11542: Fusion Reactor Unit Blueprint -> Product 11542
  11542: {
    blueprintTypeId: 11542,
    blueprintTypeName: 'Fusion Reactor Unit Blueprint',
    productTypeId: 11542,
    productTypeName: 'Fusion Reactor Unit',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 34, typeName: 'Tritanium', quantity: 4800 },
      { typeId: 36, typeName: 'Mexallon', quantity: 900 },
      { typeId: 39, typeName: 'Zydrine', quantity: 80 },
    ],
  },
  // 11993: Cerberus Blueprint -> Product 11993: Cerberus (HAC T2 Cruiser)
  11993: {
    blueprintTypeId: 11993,
    blueprintTypeName: 'Cerberus Blueprint',
    productTypeId: 11993,
    productTypeName: 'Cerberus',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 621, typeName: 'Caracal', quantity: 1 }, // Coque T1
      { typeId: 11536, typeName: 'Antimatter Reactor Unit', quantity: 2 }, // Composant T2
      { typeId: 11542, typeName: 'Fusion Reactor Unit', quantity: 2 }, // Composant T2
      { typeId: 11399, typeName: 'Morphite', quantity: 85 }, // Minéral T2
    ],
  },
  // 9832: Coolant Schematic (P2)
  9832: {
    blueprintTypeId: 9832,
    blueprintTypeName: 'Coolant Schematic',
    productTypeId: 9832,
    productTypeName: 'Coolant',
    productQuantityPerRun: 5,
    activityId: 1,
    materials: [
      { typeId: 3645, typeName: 'Water', quantity: 40 },
      { typeId: 2390, typeName: 'Electrolytes', quantity: 40 },
    ],
  },
  // 9836: Consumer Electronics Schematic (P2)
  9836: {
    blueprintTypeId: 9836,
    blueprintTypeName: 'Consumer Electronics Schematic',
    productTypeId: 9836,
    productTypeName: 'Consumer Electronics',
    productQuantityPerRun: 5,
    activityId: 1,
    materials: [
      { typeId: 2396, typeName: 'Toxic Metals', quantity: 40 },
      { typeId: 2397, typeName: 'Reactive Metals', quantity: 40 },
    ],
  },
  // 9848: Robotics Schematic (P3)
  9848: {
    blueprintTypeId: 9848,
    blueprintTypeName: 'Robotics Schematic',
    productTypeId: 9848,
    productTypeName: 'Robotics',
    productQuantityPerRun: 3,
    activityId: 1,
    materials: [
      { typeId: 9836, typeName: 'Consumer Electronics', quantity: 10 },
      { typeId: 9832, typeName: 'Coolant', quantity: 10 },
    ],
  },
  // 2867: Broadcast Node Schematic (P4)
  2867: {
    blueprintTypeId: 2867,
    blueprintTypeName: 'Broadcast Node Schematic',
    productTypeId: 2867,
    productTypeName: 'Broadcast Node',
    productQuantityPerRun: 1,
    activityId: 1,
    materials: [
      { typeId: 9848, typeName: 'Robotics', quantity: 6 },
    ],
  },
};

export class CostPropagator {
  constructor(
    private industryRepo: IIndustryRepository = defaultIndustryRepository,
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private miningRepo: IMiningRepository = defaultMiningRepository,
    private piRepo: IPiRepository = defaultPiRepository,
    private productionRepo: IProductionRepository = defaultProductionRepository,
    private roiRepo: IRoiRepository = defaultRoiRepository,
    private universeService: UniverseService = defaultUniverseService
  ) {}

  public getPiRepository(): IPiRepository {
    return this.piRepo;
  }

  /**
   * Résout la définition de blueprint (ou schéma) pour un ID donné.
   */
  public getBlueprintDefinition(blueprintOrProductTypeId: number): BlueprintDefinition | undefined {
    // 1. Recherche directe par blueprintTypeId
    if (MULTI_TIER_BLUEPRINTS[blueprintOrProductTypeId]) {
      return MULTI_TIER_BLUEPRINTS[blueprintOrProductTypeId];
    }
    // 2. Recherche inverse par productTypeId
    for (const bp of Object.values(MULTI_TIER_BLUEPRINTS)) {
      if (bp.productTypeId === blueprintOrProductTypeId) {
        return bp;
      }
    }
    return undefined;
  }

  /**
   * Récupère tous les lots d'intrants candidats pour un type et un personnage donnés,
   * ordonnés chronologiquement (FIFO).
   */
  public getCandidateInputLots(
    characterId: number,
    typeId: number,
    asOfDate?: string
  ): Array<{
    lotId: string;
    sourceType: 'TRANSACTION' | 'OPENING_BALANCE' | 'MANUFACTURED' | 'PLANETARY_TRANSFORMED' | 'FARMED';
    sourceId: number | string;
    characterId: number;
    typeId: number;
    typeName: string;
    unitCostIsk: number | null;
    totalCostIsk: number | null;
    quantity: number;
    availableQuantity: number;
    date: string;
    costBasisStatus: ProductionCostBasisStatus;
    lineage?: ProductionLineage;
  }> {
    const candidates: Array<{
      lotId: string;
      sourceType: 'TRANSACTION' | 'OPENING_BALANCE' | 'MANUFACTURED' | 'PLANETARY_TRANSFORMED' | 'FARMED';
      sourceId: number | string;
      characterId: number;
      typeId: number;
      typeName: string;
      unitCostIsk: number | null;
      totalCostIsk: number | null;
      quantity: number;
      availableQuantity: number;
      date: string;
      costBasisStatus: ProductionCostBasisStatus;
      lineage?: ProductionLineage;
    }> = [];

    const asOfTime = asOfDate ? new Date(asOfDate).getTime() : Number.POSITIVE_INFINITY;

    // 1. Lots manufacturés antérieurs du dépôt de production
    const prodAllocs = this.productionRepo.listAllocations(characterId, undefined, typeId);
    for (const alloc of prodAllocs) {
      const allocTime = new Date(alloc.allocatedAt).getTime();
      if (allocTime <= asOfTime) {
        candidates.push({
          lotId: alloc.outputLotId,
          sourceType: alloc.provenance,
          sourceId: alloc.jobId || alloc.id,
          characterId: alloc.characterId,
          typeId: alloc.outputTypeId,
          typeName: alloc.outputTypeName,
          unitCostIsk: alloc.unitCostIsk,
          totalCostIsk: alloc.totalCostIsk,
          quantity: alloc.outputQuantity,
          availableQuantity: alloc.outputQuantity,
          date: alloc.allocatedAt,
          costBasisStatus: alloc.costBasisStatus,
          lineage: alloc.lineage,
        });
      }
    }

    // 2. Transactions d'achat du grand livre
    const buyTxs = this.ledgerRepo.getAllTransactions(characterId).filter(
      (t) => t.isBuy && t.typeId === typeId
    );
    for (const tx of buyTxs) {
      const txTime = new Date(tx.date).getTime();
      if (txTime <= asOfTime) {
        candidates.push({
          lotId: `tx-${tx.characterId}-${tx.transactionId}`,
          sourceType: 'TRANSACTION',
          sourceId: tx.transactionId,
          characterId: tx.characterId,
          typeId: tx.typeId,
          typeName: tx.typeName || `Type #${tx.typeId}`,
          unitCostIsk: tx.unitPrice,
          totalCostIsk: roundIsk(tx.unitPrice * tx.quantity),
          quantity: tx.quantity,
          availableQuantity: tx.quantity,
          date: tx.date,
          costBasisStatus: 'KNOWN',
        });
      }
    }

    // 3. Stocks d'ouverture (Opening Balances)
    const openingLots = this.roiRepo.listOpeningBalances(characterId).filter(
      (ob) => ob.type_id === typeId
    );
    for (const ob of openingLots) {
      const obTime = new Date(ob.acquisition_date).getTime();
      if (obTime <= asOfTime) {
        candidates.push({
          lotId: ob.id,
          sourceType: 'OPENING_BALANCE',
          sourceId: ob.id,
          characterId: ob.character_id,
          typeId: ob.type_id,
          typeName: ob.type_name,
          unitCostIsk: ob.unit_cost_isk,
          totalCostIsk: roundIsk(ob.unit_cost_isk * ob.quantity),
          quantity: ob.quantity,
          availableQuantity: ob.quantity,
          date: ob.acquisition_date,
          costBasisStatus: 'KNOWN',
        });
      }
    }

    // 4. Registre Minier (Farmed Provenance avec coût d'opportunité économique)
    const miningEntries = this.miningRepo.getEntries({ characterId, typeId });
    for (const me of miningEntries) {
      const meTime = new Date(me.date).getTime();
      if (meTime <= asOfTime) {
        const isExplicitUnknown = me.costBasisStatus === 'UNKNOWN' || me.estimatedUnitValue === null;
        const oppVal = isExplicitUnknown
          ? null
          : (me.estimatedUnitValue !== undefined ? me.estimatedUnitValue : (STANDARD_MINING_OPPORTUNITY_PRICES[me.typeId] ?? null));
        const totalOpp = oppVal !== null ? roundIsk(oppVal * me.quantity) : null;
        candidates.push({
          lotId: `mining-${me.characterId}-${me.typeId}-${me.date}`,
          sourceType: 'FARMED',
          sourceId: `mining-${me.id || me.date}`,
          characterId: me.characterId,
          typeId: me.typeId,
          typeName: me.typeName || this.universeService.getNameSync(me.typeId, 'Type'),
          unitCostIsk: oppVal,
          totalCostIsk: totalOpp,
          quantity: me.quantity,
          availableQuantity: me.quantity,
          date: `${me.date}T00:00:00Z`,
          costBasisStatus: (isExplicitUnknown || oppVal === null) ? 'UNKNOWN' : 'KNOWN',
        });
      }
    }

    // Tri chronologique FIFO pur
    return candidates.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Propage le coût de revient d'un job de fabrication délivré ou d'un schéma PI.
   * Calcule C_unitaire = (sum(Q_i * C_i) + Frais Job + Taxes POCO) / Q_sortant
   * et génère la lignée (lineage) avec preuve mathématique immuable.
   */
  public propagateJobCost(
    job: IndustryJob,
    customCustomsTaxIsk = 0
  ): {
    allocation: ProductionCostAllocation;
    lineage: ProductionLineage;
    proof: FormulaProof;
  } {
    const runs = job.runs || 1;
    const blueprintDef = this.getBlueprintDefinition(job.blueprintTypeId) ||
      (job.productTypeId ? this.getBlueprintDefinition(job.productTypeId) : undefined);

    const outputTypeId = job.productTypeId || (blueprintDef ? blueprintDef.productTypeId : job.blueprintTypeId);
    const outputTypeName = job.productTypeName || (blueprintDef ? blueprintDef.productTypeName : this.universeService.getNameSync(outputTypeId, 'Type'));
    const outputQtyPerRun = blueprintDef ? blueprintDef.productQuantityPerRun : 1;
    const outputQuantity = outputQtyPerRun * runs;

    const materials = blueprintDef ? blueprintDef.materials : [];

    const inputAllocations: BomInputAllocation[] = [];
    let totalInputsCost: number | null = 0;
    let hasUnknownInput = false;
    let hasPartialInput = false;
    let maxChildDepth = 0;

    for (const mat of materials) {
      const requiredQty = mat.quantity * runs;
      let allocatedQty = 0;
      let matCostAccumulator = 0;
      const sourceLots: BomInputSourceLot[] = [];

      const candidateLots = this.getCandidateInputLots(job.characterId, mat.typeId, job.endDate || job.startDate);

      for (const cand of candidateLots) {
        if (allocatedQty >= requiredQty) break;
        if (cand.availableQuantity <= 0) continue;

        const take = Math.min(requiredQty - allocatedQty, cand.availableQuantity);
        cand.availableQuantity -= take;
        allocatedQty += take;

        const lotUnitCost = cand.unitCostIsk;
        const lotTotalCost = lotUnitCost !== null ? roundIsk(take * lotUnitCost) : null;

        if (lotUnitCost !== null) {
          matCostAccumulator += lotTotalCost || 0;
        } else {
          hasUnknownInput = true;
        }

        if (cand.costBasisStatus === 'UNKNOWN') {
          hasUnknownInput = true;
        } else if (cand.costBasisStatus === 'PARTIAL') {
          hasPartialInput = true;
        }

        if (cand.lineage && cand.lineage.depth > maxChildDepth) {
          maxChildDepth = cand.lineage.depth;
        }

        sourceLots.push({
          lotId: cand.lotId,
          sourceType: cand.sourceType,
          sourceId: cand.sourceId,
          characterId: cand.characterId,
          quantityTaken: take,
          unitCostIsk: lotUnitCost,
          totalCostIsk: lotTotalCost,
          costBasisStatus: cand.costBasisStatus,
          lineage: cand.lineage,
        });
      }

      const missingQty = Math.max(0, requiredQty - allocatedQty);

      // Si quantité manquante, tenter valorisation d'opportunité standard ou marquer UNKNOWN
      if (missingQty > 0) {
        const refPrice = STANDARD_MINING_OPPORTUNITY_PRICES[mat.typeId] ?? null;
        if (refPrice !== null) {
          // Utilisation du prix d'opportunité de référence
          const missingCost = roundIsk(missingQty * refPrice);
          matCostAccumulator += missingCost;
          sourceLots.push({
            lotId: `ref-opportunity-${mat.typeId}-${job.jobId}`,
            sourceType: 'FARMED',
            sourceId: `ref-${mat.typeId}`,
            characterId: job.characterId,
            quantityTaken: missingQty,
            unitCostIsk: refPrice,
            totalCostIsk: missingCost,
            costBasisStatus: 'KNOWN',
          });
          allocatedQty += missingQty;
        } else {
          hasUnknownInput = true;
        }
      }

      let matUnitCost: number | null = null;
      let matTotalCost: number | null = null;
      let matStatus: ProductionCostBasisStatus = 'KNOWN';

      if (allocatedQty === requiredQty && !hasUnknownInput) {
        matTotalCost = roundIsk(matCostAccumulator);
        matUnitCost = roundIsk(matTotalCost / requiredQty);
        matStatus = 'KNOWN';
      } else if (allocatedQty > 0 || matCostAccumulator > 0) {
        matTotalCost = roundIsk(matCostAccumulator);
        matUnitCost = allocatedQty > 0 ? roundIsk(matCostAccumulator / allocatedQty) : null;
        matStatus = 'PARTIAL';
        hasPartialInput = true;
      } else {
        matTotalCost = null;
        matUnitCost = null;
        matStatus = 'UNKNOWN';
        hasUnknownInput = true;
      }

      if (totalInputsCost !== null && matTotalCost !== null) {
        totalInputsCost = roundIsk(totalInputsCost + matTotalCost);
      } else {
        totalInputsCost = null;
      }

      inputAllocations.push({
        typeId: mat.typeId,
        typeName: mat.typeName,
        quantityRequired: requiredQty,
        quantityAllocated: allocatedQty,
        quantityMissing: Math.max(0, requiredQty - allocatedQty),
        unitCostIsk: matUnitCost,
        totalCostIsk: matTotalCost,
        costBasisStatus: matStatus,
        sourceLots,
      });
    }

    const installationCostIsk = job.cost ? roundIsk(job.cost) : 0;
    const customsTaxIsk = roundIsk(customCustomsTaxIsk);

    let totalCostIsk: number | null = null;
    let unitCostIsk: number | null = null;
    let overallStatus: ProductionCostBasisStatus = 'KNOWN';

    if (materials.length === 0) {
      // Blueprint sans intrants connus
      if (installationCostIsk > 0) {
        totalCostIsk = installationCostIsk;
        unitCostIsk = roundIsk(installationCostIsk / outputQuantity);
        overallStatus = 'PARTIAL';
      } else {
        totalCostIsk = null;
        unitCostIsk = null;
        overallStatus = 'UNKNOWN';
      }
    } else if (hasUnknownInput && totalInputsCost === null) {
      overallStatus = 'UNKNOWN';
      totalCostIsk = installationCostIsk > 0 ? installationCostIsk : null;
      unitCostIsk = totalCostIsk !== null ? roundIsk(totalCostIsk / outputQuantity) : null;
    } else if (hasUnknownInput || hasPartialInput) {
      overallStatus = 'PARTIAL';
      totalCostIsk = roundIsk((totalInputsCost || 0) + installationCostIsk + customsTaxIsk);
      unitCostIsk = roundIsk(totalCostIsk / outputQuantity);
    } else {
      overallStatus = 'KNOWN';
      totalCostIsk = roundIsk((totalInputsCost || 0) + installationCostIsk + customsTaxIsk);
      unitCostIsk = roundIsk(totalCostIsk / outputQuantity);
    }

    const depth = maxChildDepth + 1;
    const nowIso = job.completedDate || job.endDate || new Date().toISOString();
    const lineageId = `lineage-job-${job.jobId}`;

    const lineage: ProductionLineage = {
      lineageId,
      jobId: job.jobId,
      characterId: job.characterId,
      activityId: job.activityId,
      activityName: job.activityName,
      outputTypeId,
      outputTypeName,
      outputQuantity,
      unitCostIsk,
      totalCostIsk,
      installationCostIsk,
      customsTaxIsk,
      inputsCostIsk: totalInputsCost,
      costBasisStatus: overallStatus,
      inputAllocations,
      depth,
      createdAt: nowIso,
    };

    const outputLotId = `mfg-${job.characterId}-${job.jobId}`;
    const allocationId = `prod-job-${job.jobId}`;

    const allocation: ProductionCostAllocation = {
      id: allocationId,
      characterId: job.characterId,
      jobId: job.jobId,
      outputLotId,
      outputTypeId,
      outputTypeName,
      outputQuantity,
      unitCostIsk,
      totalCostIsk,
      installationCostIsk,
      customsTaxIsk,
      inputsCostIsk: totalInputsCost,
      costBasisStatus: overallStatus,
      provenance: 'MANUFACTURED',
      lineage,
      allocatedAt: nowIso,
      version: 1,
    };

    const proof: FormulaProof = {
      as_of: nowIso,
      gross_revenue_isk: 0,
      allocated_buy_cost_isk: totalInputsCost || 0,
      allocated_buy_fees_isk: roundIsk(installationCostIsk + customsTaxIsk),
      allocated_sell_fees_isk: 0,
      total_investment_ttc_isk: totalCostIsk || 0,
      realized_profit_ttc_isk: null,
      roi_percent_ttc: null,
      formula_expression: `C_unitaire(${outputTypeName}) = [Intrants: ${totalInputsCost ?? 'UNKNOWN'} ISK + Pose: ${installationCostIsk} ISK + Taxes POCO: ${customsTaxIsk} ISK] / ${outputQuantity} unites = ${unitCostIsk ?? 'UNKNOWN'} ISK/u`,
      numerator_isk: totalCostIsk,
      denominator_isk: outputQuantity,
    };

    return { allocation, lineage, proof };
  }

  /**
   * Scanne tous les jobs délivrés et propage récursivement leurs coûts de fabrication,
   * en garantissant que les sous-composants sont résolus avant les produits finis (ordre topologique).
   */
  public propagateAllDeliveredJobs(
    characterId?: number,
    characterIds?: number[]
  ): { processed: number; allocations: ProductionCostAllocation[] } {
    const jobs = this.industryRepo.getJobs({ characterId, characterIds });
    // Filtrer les jobs délivrés ou terminés
    const eligibleJobs = jobs.filter(
      (j) => j.status === 'delivered' || j.status === 'ready'
    );

    // Tri chronologique des jobs pour assurer la causalité FIFO
    eligibleJobs.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    const createdAllocations: ProductionCostAllocation[] = [];

    for (const job of eligibleJobs) {
      const { allocation } = this.propagateJobCost(job);
      this.productionRepo.saveAllocation(allocation);
      createdAllocations.push(allocation);
    }

    return {
      processed: createdAllocations.length,
      allocations: createdAllocations,
    };
  }

  /**
   * Construit l'arbre complet de décomposition multi-niveaux pour un article (Product 360).
   */
  public buildMultiTierBreakdown(targetTypeId: number, quantity = 1): MultiTierCostBreakdown {
    const targetName = this.universeService.getNameSync(targetTypeId, 'Type');
    const blueprintDef = this.getBlueprintDefinition(targetTypeId);

    if (!blueprintDef) {
      const refPrice = STANDARD_MINING_OPPORTUNITY_PRICES[targetTypeId] ?? null;
      const totalCost = refPrice !== null ? roundIsk(refPrice * quantity) : null;
      const status: ProductionCostBasisStatus = refPrice !== null ? 'KNOWN' : 'UNKNOWN';

      const singleNode: CostBreakdownNode = {
        typeId: targetTypeId,
        typeName: targetName,
        level: 0,
        quantityRequired: quantity,
        unitCostIsk: refPrice,
        totalCostIsk: totalCost,
        costBasisStatus: status,
        provenance: refPrice !== null ? 'FARMED' : 'PURCHASED',
        sourceDescription: 'Article élémentaire ou brut (sans étape industrielle antérieure)',
      };

      const proof: FormulaProof = {
        as_of: new Date().toISOString(),
        gross_revenue_isk: 0,
        allocated_buy_cost_isk: totalCost || 0,
        allocated_buy_fees_isk: 0,
        allocated_sell_fees_isk: 0,
        total_investment_ttc_isk: totalCost || 0,
        realized_profit_ttc_isk: null,
        roi_percent_ttc: null,
        formula_expression: `Coût Unitaire(${targetName}) = ${refPrice ?? 'UNKNOWN'} ISK (Marché brut)`,
        numerator_isk: totalCost,
        denominator_isk: quantity,
      };

      return {
        targetTypeId,
        targetTypeName: targetName,
        quantity,
        unitCostIsk: refPrice,
        totalCostIsk: totalCost,
        costBasisStatus: status,
        materialsTotalIsk: totalCost,
        installationTotalIsk: 0,
        customsTotalIsk: 0,
        nodes: [singleNode],
        proof,
      };
    }

    // Calcul récursif de l'arbre
    const runs = Math.max(1, Math.ceil(quantity / blueprintDef.productQuantityPerRun));
    const producedQty = blueprintDef.productQuantityPerRun * runs;

    const buildTreeNodes = (
      bp: BlueprintDefinition,
      runCount: number,
      level: number
    ): { nodes: CostBreakdownNode[]; totalMatIsk: number | null; isKnown: boolean } => {
      const resultNodes: CostBreakdownNode[] = [];
      let totalIsk: number | null = 0;
      let allKnown = true;

      for (const mat of bp.materials) {
        const matQty = mat.quantity * runCount;
        const subBp = this.getBlueprintDefinition(mat.typeId);

        let subChildren: CostBreakdownNode[] | undefined;
        let unitCost: number | null = null;
        let nodeTotalCost: number | null = null;
        let nodeStatus: ProductionCostBasisStatus = 'KNOWN';
        let provenance: CostBreakdownNode['provenance'] = 'PURCHASED';
        let sourceDesc = 'Achat direct ou lot de marché';

        if (subBp) {
          // Sous-composant fabriqué
          provenance = 'MANUFACTURED';
          sourceDesc = `Sous-composant intermédiaire (${subBp.blueprintTypeName})`;
          const subRuns = Math.max(1, Math.ceil(matQty / subBp.productQuantityPerRun));
          const subRes = buildTreeNodes(subBp, subRuns, level + 1);
          subChildren = subRes.nodes;
          if (subRes.totalMatIsk !== null) {
            unitCost = roundIsk(subRes.totalMatIsk / (subBp.productQuantityPerRun * subRuns));
            nodeTotalCost = roundIsk(unitCost * matQty);
          } else {
            allKnown = false;
            nodeStatus = 'PARTIAL';
          }
        } else {
          // Intrant matière brute
          const oppPrice = STANDARD_MINING_OPPORTUNITY_PRICES[mat.typeId] ?? null;
          if (oppPrice !== null) {
            unitCost = oppPrice;
            nodeTotalCost = roundIsk(oppPrice * matQty);
            provenance = 'FARMED';
            sourceDesc = 'Minerai ou ressource farmée (coût d\'opportunité économique)';
          } else {
            allKnown = false;
            nodeStatus = 'UNKNOWN';
            sourceDesc = 'Composant sans prix d\'opportunité répertorié';
          }
        }

        if (totalIsk !== null && nodeTotalCost !== null) {
          totalIsk = roundIsk(totalIsk + nodeTotalCost);
        } else {
          totalIsk = null;
        }

        resultNodes.push({
          typeId: mat.typeId,
          typeName: mat.typeName,
          level,
          quantityRequired: matQty,
          unitCostIsk: unitCost,
          totalCostIsk: nodeTotalCost,
          costBasisStatus: nodeStatus,
          provenance,
          sourceDescription: sourceDesc,
          children: subChildren,
        });
      }

      return { nodes: resultNodes, totalMatIsk: totalIsk, isKnown: allKnown };
    };

    const tree = buildTreeNodes(blueprintDef, runs, 1);
    const materialsTotalIsk = tree.totalMatIsk;
    const installationTotalIsk = 250000; // Frais d'installation standard indicatif
    const customsTotalIsk = 0;

    const totalCostIsk = materialsTotalIsk !== null
      ? roundIsk(materialsTotalIsk + installationTotalIsk + customsTotalIsk)
      : null;
    const unitCostIsk = totalCostIsk !== null
      ? roundIsk(totalCostIsk / producedQty)
      : null;
    const costBasisStatus: ProductionCostBasisStatus = tree.isKnown ? 'KNOWN' : 'PARTIAL';

    const rootNode: CostBreakdownNode = {
      typeId: blueprintDef.productTypeId,
      typeName: blueprintDef.productTypeName,
      level: 0,
      quantityRequired: producedQty,
      unitCostIsk,
      totalCostIsk,
      costBasisStatus,
      provenance: 'MANUFACTURED',
      sourceDescription: `Assemblage final (${blueprintDef.blueprintTypeName})`,
      children: tree.nodes,
    };

    const proof: FormulaProof = {
      as_of: new Date().toISOString(),
      gross_revenue_isk: 0,
      allocated_buy_cost_isk: materialsTotalIsk || 0,
      allocated_buy_fees_isk: installationTotalIsk + customsTotalIsk,
      allocated_sell_fees_isk: 0,
      total_investment_ttc_isk: totalCostIsk || 0,
      realized_profit_ttc_isk: null,
      roi_percent_ttc: null,
      formula_expression: `C_unitaire(${blueprintDef.productTypeName}) = (${materialsTotalIsk ?? 'UNKNOWN'} ISK matières + ${installationTotalIsk} ISK pose) / ${producedQty} = ${unitCostIsk ?? 'UNKNOWN'} ISK/u`,
      numerator_isk: totalCostIsk,
      denominator_isk: producedQty,
    };

    return {
      targetTypeId: blueprintDef.productTypeId,
      targetTypeName: blueprintDef.productTypeName,
      quantity: producedQty,
      unitCostIsk,
      totalCostIsk,
      costBasisStatus,
      materialsTotalIsk,
      installationTotalIsk,
      customsTotalIsk,
      nodes: [rootNode],
      proof,
    };
  }
}

export const defaultCostPropagator = new CostPropagator();
