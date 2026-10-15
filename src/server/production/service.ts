/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Service métier orchestrant le sous-moteur de propagation industrielle,
 * la persistance des généalogies et l'exposition pour Product 360 et le Cockpit.
 */

import type {
  ProductionCostAllocation,
  ProductionLineage,
  MultiTierCostBreakdown,
  ProductionPropagationOptions,
} from './types.ts';
import { IProductionRepository, defaultProductionRepository } from './repository.ts';
import { CostPropagator, defaultCostPropagator } from './costPropagator.ts';
import type { IIndustryRepository } from '../industry/repository.ts';
import { defaultIndustryRepository } from '../industry/repository.ts';
import { hubsService } from '../hubs/service.ts';
import { roundIsk } from '../roi/calculator.ts';
import type { InventoryLot } from '../roi/types.ts';

export class ProductionService {
  constructor(
    private repo: IProductionRepository = defaultProductionRepository,
    private propagator: CostPropagator = defaultCostPropagator,
    private industryRepo: IIndustryRepository = defaultIndustryRepository
  ) {}

  /**
   * Construit l'arbre complet de décomposition multi-niveaux d'un article pour Product 360.
   */
  public getBreakdown(typeId: number, quantity = 1): MultiTierCostBreakdown {
    return this.propagator.buildMultiTierBreakdown(typeId, quantity);
  }

  /**
   * Récupère la généalogie détaillée d'un lot produit fini via son ID de lot.
   */
  public getLineageForLot(outputLotId: string): ProductionLineage | undefined {
    const alloc = this.repo.getAllocationsForOutputLot(outputLotId);
    return alloc?.lineage;
  }

  /**
   * Récupère l'allocation de coût et la lignée d'un job d'industrie.
   */
  public getAllocationByJobId(jobId: number): ProductionCostAllocation | undefined {
    return this.repo.getAllocationByJobId(jobId);
  }

  /**
   * Liste les allocations de fabrication persistées.
   */
  public listAllocations(
    characterId?: number,
    characterIds?: number[],
    typeId?: number
  ): ProductionCostAllocation[] {
    return this.repo.listAllocations(characterId, characterIds, typeId);
  }

  /**
   * Déclenche la propagation continue des coûts sur tous les jobs délivrés ou prêts.
   */
  public propagateDeliveredJobs(options: ProductionPropagationOptions = {}): {
    processed: number;
    allocations: ProductionCostAllocation[];
  } {
    return this.propagator.propagateAllDeliveredJobs(options.characterId, options.characterIds);
  }

  /**
   * Propage manuellement le coût d'un job d'industrie spécifique et persiste le résultat.
   */
  public propagateSingleJob(jobId: number, customPocoTax = 0): ProductionCostAllocation {
    const job = this.industryRepo.getJobById(jobId);
    if (!job) {
      throw new Error(`Job #${jobId} introuvable`);
    }

    const { allocation } = this.propagator.propagateJobCost(job, customPocoTax);
    this.repo.saveAllocation(allocation);
    return allocation;
  }

  /**
   * Convertit les allocations de fabrication en lots d'inventaire unifiés (InventoryLot),
   * permettant leur consommation transparente par le moteur FIFO de vente et par le capital.
   */
  public getManufacturedInventoryLots(
    characterId?: number,
    characterIds?: number[],
    typeId?: number
  ): InventoryLot[] {
    const allocs = this.repo.listAllocations(characterId, characterIds, typeId);
    const lots: InventoryLot[] = [];

    for (const alloc of allocs) {
      const resolvedHub = hubsService.resolveLocationToHub(0, 'Station de Production');
      const unitCost = alloc.unitCostIsk || 0;
      const totalCost = alloc.totalCostIsk || roundIsk(alloc.outputQuantity * unitCost);

      lots.push({
        lot_id: alloc.outputLotId,
        character_id: alloc.characterId,
        source_type: alloc.provenance,
        source_id: alloc.jobId || alloc.id,
        provenance: alloc.provenance,
        type_id: alloc.outputTypeId,
        type_name: alloc.outputTypeName,
        acquisition_date: alloc.allocatedAt,
        initial_quantity: alloc.outputQuantity,
        allocated_quantity: 0, // Sera ajusté par le moteur ROI selon les ventes réconciliées
        remaining_quantity: alloc.outputQuantity,
        unit_cost_isk: unitCost,
        total_cost_isk: totalCost,
        remaining_cost_isk: totalCost,
        initial_buy_fees_isk: 0,
        remaining_buy_fees_isk: 0,
        location_id: 0,
        location_name: 'Production Facility',
        hub_id: resolvedHub.hub_id,
        hub_name: resolvedHub.hub_name,
        lineage: alloc.lineage,
        justification: `Lot fabriqué via Job #${alloc.jobId || 'N/A'} (Lignée: ${alloc.lineage?.lineageId || 'N/A'})`,
      });
    }

    return lots;
  }
}

export const defaultProductionService = new ProductionService();
export const productionService = defaultProductionService;
