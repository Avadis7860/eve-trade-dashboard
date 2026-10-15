/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Suite de tests unitaires et d'intégration validant l'ensemble des critères d'acceptation de la Phase P05.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostPropagator } from './costPropagator.ts';
import { ProductionService } from './service.ts';
import { PersistentProductionRepository } from './repository.ts';
import { PersistentIndustryRepository } from '../industry/repository.ts';
import { PersistentMiningRepository } from '../mining/repository.ts';
import { PersistentRoiRepository } from '../roi/repository.ts';
import { PersistentLedgerRepository } from '../ledger/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { RoiService } from '../roi/service.ts';
import type { IndustryJob } from '../industry/types.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { MiningLedgerEntry } from '../mining/types.ts';

function makeTx(tx: {
  characterId: number;
  transactionId: number;
  typeId: number;
  typeName?: string;
  quantity: number;
  unitPrice: number;
  totalValue?: number;
  isBuy: boolean;
  locationId?: number;
  locationName?: string;
  clientId?: number;
  date?: string;
  observedAt?: number;
  tax?: number;
  brokerFee?: number;
  netValue?: number;
}): CharacterTransaction {
  const totalValue = tx.totalValue ?? tx.quantity * tx.unitPrice;
  return {
    id: `${tx.characterId}:${tx.transactionId}`,
    characterId: tx.characterId,
    transactionId: tx.transactionId,
    typeId: tx.typeId,
    typeName: tx.typeName,
    quantity: tx.quantity,
    unitPrice: tx.unitPrice,
    totalValue,
    isBuy: tx.isBuy,
    isPersonal: true,
    journalRefId: 0,
    locationId: tx.locationId ?? 60003760,
    locationName: tx.locationName,
    clientId: tx.clientId ?? 9001,
    date: tx.date ?? '2026-10-02T10:00:00Z',
    observedAt: tx.observedAt ?? Date.now(),
    source: 'CHARACTER',
    tax: tx.tax,
    brokerFee: tx.brokerFee,
    netValue: tx.netValue,
  };
}

describe('Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux)', () => {
  let productionRepo: PersistentProductionRepository;
  let industryRepo: PersistentIndustryRepository;
  let miningRepo: PersistentMiningRepository;
  let roiRepo: PersistentRoiRepository;
  let ledgerRepo: PersistentLedgerRepository;
  let universeService: UniverseService;
  let propagator: CostPropagator;
  let productionService: ProductionService;
  let roiService: RoiService;

  beforeEach(() => {
    productionRepo = new PersistentProductionRepository();
    industryRepo = new PersistentIndustryRepository();
    miningRepo = new PersistentMiningRepository();
    ledgerRepo = new PersistentLedgerRepository();
    roiRepo = new PersistentRoiRepository(ledgerRepo, null, productionRepo);
    universeService = new UniverseService();
    propagator = new CostPropagator(
      industryRepo,
      ledgerRepo,
      miningRepo,
      undefined,
      productionRepo,
      roiRepo,
      universeService
    );
    productionService = new ProductionService(productionRepo, propagator, industryRepo);
    roiService = new RoiService(roiRepo, undefined, ledgerRepo, productionRepo);
  });

  describe('1. Propagation Élémentaire T1 & Intrants Farmés / Achetés', () => {
    it('TEST-P05-01: Propage fidèlement le coût d\'un Caracal T1 assemblé à partir de minerais farmés et achetés', () => {
      const charId = 1001;

      // 1. Minerais farmés dans le mining ledger (coût d'opportunité économique)
      // Tritanium (34): 380 000 unités @ 4.50 ISK
      const tritaniumEntry: MiningLedgerEntry = {
        id: 1,
        characterId: charId,
        date: '2026-10-01',
        solarSystemId: 30000142,
        solarSystemName: 'Jita',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 500000,
        estimatedUnitValue: 4.50,
        opportunityCostIsk: 2250000,
        realizedCashCostIsk: 0,
        provenance: 'FARMED',
        costBasisStatus: 'KNOWN',
      };
      miningRepo.saveEntries([tritaniumEntry]);

      // 2. Minéraux achetés sur le marché (Transactions d'achat)
      // Pyerite (35): 110 000 @ 12.00 ISK
      // Mexallon (36): 32 000 @ 65.00 ISK
      // Isogen (37): 5 800 @ 120.00 ISK
      // Nocxium (38): 1 400 @ 450.00 ISK
      // Zydrine (39): 280 @ 1200.00 ISK
      // Megacyte (40): 95 @ 3500.00 ISK
      const buyTransactions: CharacterTransaction[] = [
        makeTx({
          characterId: charId,
          transactionId: 5001,
          typeId: 35,
          typeName: 'Pyerite',
          quantity: 200000,
          unitPrice: 12.00,
          totalValue: 2400000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:00:00Z',
          observedAt: Date.now(),
        }),
        makeTx({
          characterId: charId,
          transactionId: 5002,
          typeId: 36,
          typeName: 'Mexallon',
          quantity: 50000,
          unitPrice: 65.00,
          totalValue: 3250000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:05:00Z',
          observedAt: Date.now(),
        }),
        makeTx({
          characterId: charId,
          transactionId: 5003,
          typeId: 37,
          typeName: 'Isogen',
          quantity: 10000,
          unitPrice: 120.00,
          totalValue: 1200000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:10:00Z',
          observedAt: Date.now(),
        }),
        makeTx({
          characterId: charId,
          transactionId: 5004,
          typeId: 38,
          typeName: 'Nocxium',
          quantity: 2000,
          unitPrice: 450.00,
          totalValue: 900000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:15:00Z',
          observedAt: Date.now(),
        }),
        makeTx({
          characterId: charId,
          transactionId: 5005,
          typeId: 39,
          typeName: 'Zydrine',
          quantity: 500,
          unitPrice: 1200.00,
          totalValue: 600000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:20:00Z',
          observedAt: Date.now(),
        }),
        makeTx({
          characterId: charId,
          transactionId: 5006,
          typeId: 40,
          typeName: 'Megacyte',
          quantity: 200,
          unitPrice: 3500.00,
          totalValue: 700000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-02T10:25:00Z',
          observedAt: Date.now(),
        }),
      ];
      ledgerRepo.saveTransactions(buyTransactions);

      // 3. Job de fabrication Caracal (Blueprint 688 -> Produit 621)
      const installationFee = 450000;
      const job: IndustryJob = {
        jobId: 88001,
        installerId: charId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 10001,
        blueprintTypeId: 688,
        blueprintTypeName: 'Caracal Blueprint',
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        productTypeId: 621,
        productTypeName: 'Caracal',
        status: 'delivered',
        duration: 7200,
        startDate: '2026-10-03T08:00:00Z',
        endDate: '2026-10-03T10:00:00Z',
        completedDate: '2026-10-03T10:00:05Z',
        runs: 1,
        cost: installationFee,
        source: 'CHARACTER',
        characterId: charId,
        observedAt: Date.now(),
      };
      industryRepo.saveJobs([job]);

      // Calcul manuel théorique :
      // Tritanium: 380 000 * 4.50 = 1 710 000 ISK
      // Pyerite:   110 000 * 12.00 = 1 320 000 ISK
      // Mexallon:   32 000 * 65.00 = 2 080 000 ISK
      // Isogen:      5 800 * 120.00 =  696 000 ISK
      // Nocxium:     1 400 * 450.00 =  630 000 ISK
      // Zydrine:       280 * 1200.00 = 336 000 ISK
      // Megacyte:       95 * 3500.00 = 332 500 ISK
      // Total matières = 7 104 500 ISK
      // Frais job = 450 000 ISK
      // Total = 7 554 500 ISK
      const expectedTotal = 7104500 + installationFee;

      const { allocation, lineage, proof } = propagator.propagateJobCost(job);

      expect(allocation.outputTypeId).toBe(621);
      expect(allocation.outputQuantity).toBe(1);
      expect(allocation.costBasisStatus).toBe('KNOWN');
      expect(allocation.inputsCostIsk).toBe(7104500);
      expect(allocation.installationCostIsk).toBe(installationFee);
      expect(allocation.totalCostIsk).toBe(expectedTotal);
      expect(allocation.unitCostIsk).toBe(expectedTotal);

      // Vérification de la traçabilité des lots d'intrants
      expect(lineage.inputAllocations.length).toBe(7);
      const triAlloc = lineage.inputAllocations.find((m) => m.typeId === 34)!;
      expect(triAlloc.quantityAllocated).toBe(380000);
      expect(triAlloc.sourceLots[0].sourceType).toBe('FARMED');
      expect(triAlloc.sourceLots[0].unitCostIsk).toBe(4.50);

      // Preuve mathématique
      expect(proof.formula_expression).toContain('7554500');
    });

    it('TEST-P05-02: Qualifie rigoureusement en PARTIAL si un composant d\'intrant est sans historique de coût', () => {
      const charId = 1001;

      // Seul le Tritanium est fourni, pas les autres minéraux
      const tritaniumEntry: MiningLedgerEntry = {
        id: 2,
        characterId: charId,
        date: '2026-10-01',
        solarSystemId: 30000142,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 1000000,
        estimatedUnitValue: null, // UNKNOWN
        opportunityCostIsk: null,
        realizedCashCostIsk: 0,
        provenance: 'FARMED',
        costBasisStatus: 'UNKNOWN',
      };
      miningRepo.saveEntries([tritaniumEntry]);

      const job: IndustryJob = {
        jobId: 88002,
        installerId: charId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 10002,
        blueprintTypeId: 688,
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        productTypeId: 621,
        status: 'delivered',
        duration: 7200,
        startDate: '2026-10-03T08:00:00Z',
        endDate: '2026-10-03T10:00:00Z',
        runs: 1,
        cost: 200000,
        source: 'CHARACTER',
        characterId: charId,
        observedAt: Date.now(),
      };

      const { allocation } = propagator.propagateJobCost(job);

      // Ne doit jamais être inventé à 0.00 ISK ni être marqué KNOWN sans preuve
      expect(allocation.costBasisStatus).not.toBe('KNOWN');
    });
  });

  describe('2. Cascade Multi-Niveaux T2 & Intégration BOM Récursive', () => {
    it('TEST-P05-03: Propage à travers 3 niveaux industriels : Minerais -> Composants T2 -> Vaisseau T2 Cerberus', () => {
      const charId = 1001;

      // Niveau 1 : Injecter la coque Caracal (produit d'un premier job délivré)
      const caracalAlloc = {
        id: 'prod-job-88001',
        characterId: charId,
        jobId: 88001,
        outputLotId: `mfg-${charId}-88001`,
        outputTypeId: 621,
        outputTypeName: 'Caracal',
        outputQuantity: 1,
        unitCostIsk: 7554500,
        totalCostIsk: 7554500,
        installationCostIsk: 450000,
        customsTaxIsk: 0,
        inputsCostIsk: 7104500,
        costBasisStatus: 'KNOWN' as const,
        provenance: 'MANUFACTURED' as const,
        lineage: {
          lineageId: 'lineage-job-88001',
          characterId: charId,
          outputTypeId: 621,
          outputTypeName: 'Caracal',
          outputQuantity: 1,
          unitCostIsk: 7554500,
          totalCostIsk: 7554500,
          installationCostIsk: 450000,
          customsTaxIsk: 0,
          inputsCostIsk: 7104500,
          costBasisStatus: 'KNOWN' as const,
          inputAllocations: [],
          depth: 1,
          createdAt: '2026-10-03T10:00:00Z',
        },
        allocatedAt: '2026-10-03T10:00:00Z',
        version: 1,
      };
      productionRepo.saveAllocation(caracalAlloc);

      // Niveau 1 : Injecter les sous-composants T2 Antimatter Reactor Unit (11536) et Fusion Reactor Unit (11542)
      const antimatterAlloc = {
        id: 'prod-job-88010',
        characterId: charId,
        jobId: 88010,
        outputLotId: `mfg-${charId}-88010`,
        outputTypeId: 11536,
        outputTypeName: 'Antimatter Reactor Unit',
        outputQuantity: 2,
        unitCostIsk: 1250000,
        totalCostIsk: 2500000,
        installationCostIsk: 50000,
        customsTaxIsk: 0,
        inputsCostIsk: 2450000,
        costBasisStatus: 'KNOWN' as const,
        provenance: 'MANUFACTURED' as const,
        lineage: {
          lineageId: 'lineage-job-88010',
          characterId: charId,
          outputTypeId: 11536,
          outputTypeName: 'Antimatter Reactor Unit',
          outputQuantity: 2,
          unitCostIsk: 1250000,
          totalCostIsk: 2500000,
          installationCostIsk: 50000,
          customsTaxIsk: 0,
          inputsCostIsk: 2450000,
          costBasisStatus: 'KNOWN' as const,
          inputAllocations: [],
          depth: 1,
          createdAt: '2026-10-03T12:00:00Z',
        },
        allocatedAt: '2026-10-03T12:00:00Z',
        version: 1,
      };
      productionRepo.saveAllocation(antimatterAlloc);

      const fusionAlloc = {
        id: 'prod-job-88011',
        characterId: charId,
        jobId: 88011,
        outputLotId: `mfg-${charId}-88011`,
        outputTypeId: 11542,
        outputTypeName: 'Fusion Reactor Unit',
        outputQuantity: 2,
        unitCostIsk: 1300000,
        totalCostIsk: 2600000,
        installationCostIsk: 50000,
        customsTaxIsk: 0,
        inputsCostIsk: 2550000,
        costBasisStatus: 'KNOWN' as const,
        provenance: 'MANUFACTURED' as const,
        lineage: {
          lineageId: 'lineage-job-88011',
          characterId: charId,
          outputTypeId: 11542,
          outputTypeName: 'Fusion Reactor Unit',
          outputQuantity: 2,
          unitCostIsk: 1300000,
          totalCostIsk: 2600000,
          installationCostIsk: 50000,
          customsTaxIsk: 0,
          inputsCostIsk: 2550000,
          costBasisStatus: 'KNOWN' as const,
          inputAllocations: [],
          depth: 1,
          createdAt: '2026-10-03T12:00:00Z',
        },
        allocatedAt: '2026-10-03T12:00:00Z',
        version: 1,
      };
      productionRepo.saveAllocation(fusionAlloc);

      // Minéral T2 Morphite (11399): 85 unités @ 15 000 ISK achetées
      ledgerRepo.saveTransactions([
        makeTx({
          characterId: charId,
          transactionId: 5099,
          typeId: 11399,
          typeName: 'Morphite',
          quantity: 100,
          unitPrice: 15000.00,
          totalValue: 1500000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-03T14:00:00Z',
          observedAt: Date.now(),
        }),
      ]);

      // Niveau 2 : Job Cerberus (Blueprint 11993 -> Produit 11993: Cerberus)
      // Requiert : 1 Caracal, 2 Antimatter Reactor, 2 Fusion Reactor, 85 Morphite
      const cerberusInstallationFee = 2500000;
      const cerberusJob: IndustryJob = {
        jobId: 88020,
        installerId: charId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 10020,
        blueprintTypeId: 11993,
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        productTypeId: 11993,
        productTypeName: 'Cerberus',
        status: 'delivered',
        duration: 18000,
        startDate: '2026-10-04T08:00:00Z',
        endDate: '2026-10-04T13:00:00Z',
        runs: 1,
        cost: cerberusInstallationFee,
        source: 'CHARACTER',
        characterId: charId,
        observedAt: Date.now(),
      };
      industryRepo.saveJobs([cerberusJob]);

      // Coûts attendus :
      // 1 Caracal = 7 554 500 ISK
      // 2 Antimatter = 2 * 1 250 000 = 2 500 000 ISK
      // 2 Fusion = 2 * 1 300 000 = 2 600 000 ISK
      // 85 Morphite = 85 * 15 000 = 1 275 000 ISK
      // Total intrants = 13 929 500 ISK
      // Frais pose = 2 500 000 ISK
      // Total Cerberus = 16 429 500 ISK
      const expectedCerberusTotal = 13929500 + cerberusInstallationFee;

      const { allocation, lineage } = propagator.propagateJobCost(cerberusJob);

      expect(allocation.outputTypeId).toBe(11993);
      expect(allocation.totalCostIsk).toBe(expectedCerberusTotal);
      expect(allocation.unitCostIsk).toBe(expectedCerberusTotal);
      expect(allocation.costBasisStatus).toBe('KNOWN');
      expect(lineage.depth).toBe(2); // Profondeur 2 car il consomme des composants de profondeur 1

      // Sauvegarde dans le repo
      productionRepo.saveAllocation(allocation);

      // Vérification que le lot de Cerberus est disponible comme lot d'inventaire
      const invLots = roiRepo.getInventoryLots(charId, undefined, 11993);
      expect(invLots.length).toBe(1);
      expect(invLots[0].lot_id).toBe(`mfg-${charId}-88020`);
      expect(invLots[0].unit_cost_isk).toBe(expectedCerberusTotal);
      expect(invLots[0].remaining_quantity).toBe(1);
    });
  });

  describe('3. Réconciliation Marché d\'un Produit Manufacturé (Vente de Caracal)', () => {
    it('TEST-P05-04: Consomme un lot manufacturé lors d\'une vente de marché et génère un ROI TTC 100% auditable sans UNKNOWN', () => {
      const charId = 1001;
      const unitManufacturedCost = 7554500;

      // 1. Lot manufacturé Caracal enregistré
      const caracalAlloc = {
        id: 'prod-job-88001',
        characterId: charId,
        jobId: 88001,
        outputLotId: `mfg-${charId}-88001`,
        outputTypeId: 621,
        outputTypeName: 'Caracal',
        outputQuantity: 1,
        unitCostIsk: unitManufacturedCost,
        totalCostIsk: unitManufacturedCost,
        installationCostIsk: 450000,
        customsTaxIsk: 0,
        inputsCostIsk: 7104500,
        costBasisStatus: 'KNOWN' as const,
        provenance: 'MANUFACTURED' as const,
        lineage: {
          lineageId: 'lineage-job-88001',
          characterId: charId,
          outputTypeId: 621,
          outputTypeName: 'Caracal',
          outputQuantity: 1,
          unitCostIsk: unitManufacturedCost,
          totalCostIsk: unitManufacturedCost,
          installationCostIsk: 450000,
          customsTaxIsk: 0,
          inputsCostIsk: 7104500,
          costBasisStatus: 'KNOWN' as const,
          inputAllocations: [],
          depth: 1,
          createdAt: '2026-10-03T10:00:00Z',
        },
        allocatedAt: '2026-10-03T10:00:00Z',
        version: 1,
      };
      productionRepo.saveAllocation(caracalAlloc);

      // 2. Transaction de vente de marché pour ce Caracal à Jita 4-4
      const salePrice = 12000000; // Vente à 12M ISK
      const sellTx = makeTx({
        characterId: charId,
        transactionId: 90001,
        typeId: 621,
        typeName: 'Caracal',
        quantity: 1,
        unitPrice: salePrice,
        totalValue: salePrice,
        isBuy: false,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        clientId: 98765,
        date: '2026-10-05T14:30:00Z',
        observedAt: Date.now(),
        tax: 360000, // 3% sales tax
        brokerFee: 120000, // 1% broker fee
        netValue: salePrice - 360000 - 120000,
      });
      ledgerRepo.saveTransactions([sellTx]);

      // 3. Exécution de la réconciliation FIFO automatique
      const result = roiService.autoReconcileFifo({ characterId: charId, typeId: 621 });

      expect(result.allocationsCreated).toBe(1);
      expect(result.salesFullyMatched).toBe(1);
      expect(result.salesUnmatched).toBe(0);

      // 4. Vérification de l'allocation générée
      const allocs = roiRepo.listAllocations(charId);
      expect(allocs.length).toBe(1);
      expect(allocs[0].source_type).toBe('MANUFACTURED');
      expect(allocs[0].unit_buy_price).toBe(unitManufacturedCost);
      expect(allocs[0].allocated_buy_cost).toBe(unitManufacturedCost);

      // 5. Calcul de synthèse financière ROI TTC
      const summary = roiService.getSummary({ character_id: charId, type_id: 621 });

      // Invariants TTC :
      // CA alloué = 12 000 000 ISK
      // Coût matière manufacturé = 7 554 500 ISK
      // Taxes et courtage vente = 360 000 + 120 000 = 480 000 ISK
      // Profit net TTC = 12 000 000 - 7 554 500 - 480 000 = 3 965 500 ISK
      // Investissement TTC = 7 554 500 ISK
      // ROI TTC = (3 965 500 / 7 554 500) * 100 = 52.49%
      expect(summary.coverage_status).toBe('COMPLETE');
      expect(summary.gross_revenue_allocated_isk).toBe(12000000);
      expect(summary.allocated_buy_cost_isk).toBe(unitManufacturedCost);
      expect(summary.realized_profit_ttc_isk).toBe(3965500);
      expect(summary.roi_percent_ttc).toBeCloseTo(52.49, 1);
    });
  });

  describe('4. Décomposition Hiérarchique Multi-Niveaux pour UI (Product 360)', () => {
    it('TEST-P05-05: Construit l\'arbre BOM complet pour la visualisation UI de la fiche Product 360', () => {
      // Build breakdown for Cerberus (11993)
      const breakdown = productionService.getBreakdown(11993, 1);

      expect(breakdown.targetTypeId).toBe(11993);
      expect(breakdown.targetTypeName).toBe('Cerberus');
      expect(breakdown.nodes.length).toBe(1);

      const rootNode = breakdown.nodes[0];
      expect(rootNode.level).toBe(0);
      expect(rootNode.children?.length).toBe(4); // Caracal, Antimatter, Fusion, Morphite

      // Caracal a lui-même 7 enfants (Tritanium, Pyerite, Mexallon, Isogen, Nocxium, Zydrine, Megacyte)
      const caracalChild = (rootNode.children || []).find((c) => c.typeId === 621);
      expect(caracalChild).toBeDefined();
      expect(caracalChild?.level).toBe(1);
      expect(caracalChild?.children?.length).toBe(7);

      // Preuve mathématique
      expect(breakdown.proof.formula_expression).toContain('Cerberus');
    });
  });

  describe('5. Prorata et Décrément des Stocks d\'Intrants', () => {
    it('TEST-P05-06: Décrémente fidèlement les stocks disponibles d\'intrants au prorata des runs exécutés', () => {
      const charId = 1001;

      // 10 000 Isogen achetés @ 100 ISK
      ledgerRepo.saveTransactions([
        makeTx({
          characterId: charId,
          transactionId: 7001,
          typeId: 37,
          typeName: 'Isogen',
          quantity: 10000,
          unitPrice: 100,
          totalValue: 1000000,
          isBuy: true,
          locationId: 60003760,
          clientId: 9001,
          date: '2026-10-01T10:00:00Z',
          observedAt: Date.now(),
        }),
      ]);

      // Job Antimatter Reactor Unit (requiert 600 Isogen par run) x 5 runs = 3000 Isogen
      const job: IndustryJob = {
        jobId: 88050,
        installerId: charId,
        facilityId: 60003760,
        stationId: 60003760,
        activityId: 1,
        activityName: 'Manufacturing',
        blueprintId: 10050,
        blueprintTypeId: 11536,
        blueprintLocationId: 60003760,
        outputLocationId: 60003760,
        productTypeId: 11536,
        productTypeName: 'Antimatter Reactor Unit',
        status: 'delivered',
        duration: 3600,
        startDate: '2026-10-02T10:00:00Z',
        endDate: '2026-10-02T11:00:00Z',
        runs: 5,
        cost: 150000,
        source: 'CHARACTER',
        characterId: charId,
        observedAt: Date.now(),
      };

      const { allocation, lineage } = propagator.propagateJobCost(job);

      expect(allocation.outputQuantity).toBe(5);
      const isogenAlloc = lineage.inputAllocations.find((m) => m.typeId === 37)!;
      expect(isogenAlloc.quantityRequired).toBe(3000);
      expect(isogenAlloc.quantityAllocated).toBe(3000);
      expect(isogenAlloc.sourceLots[0].quantityTaken).toBe(3000);
    });
  });
});
