import { roiRepository, RoiRepository } from './repository';
import {
  ExplicitCostAllocation,
  OpeningBalanceLot,
  RoiFilterParams,
  RoiFinancialSummary,
  SaleReconciliationDetail,
  UnsoldInventoryItem,
  AutoReconciliationResult,
  AutoReconciliationParams,
} from './types';
import { defaultLedgerRepository, type ILedgerRepository } from '../ledger/repository';
import { hubsService } from '../hubs/service';
import { RoiCalculator, roundIsk } from './calculator';
import type { CharacterTransaction } from '../ledger/types';
import type { AssetsService } from '../assets/service';
import { defaultAssetsService } from '../assets/service';

export class RoiService {
  constructor(
    private repo: RoiRepository = roiRepository,
    private assetsService: AssetsService = defaultAssetsService,
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository
  ) {}

  /**
   * Helper to retrieve linked fees for a transaction from wallet journal entries
   */
  private getTransactionFees(tx: CharacterTransaction): number {
    if (tx.tax !== undefined && tx.brokerFee !== undefined && (tx.tax > 0 || tx.brokerFee > 0)) {
      return tx.isBuy ? (tx.brokerFee || 0) : ((tx.tax || 0) + (tx.brokerFee || 0));
    }
    const { tax, brokerFee } = this.ledgerRepo.getJournalEntriesForTransaction(
      tx.characterId,
      tx.transactionId,
      tx.journalRefId,
      tx.date,
      tx.totalValue,
      tx.isBuy
    );
    return tx.isBuy ? brokerFee : (tax + brokerFee);
  }

  // --- Opening Balance Lots Management ---

  createOpeningBalance(params: {
    character_id: number;
    type_id: number;
    type_name?: string;
    quantity: number;
    unit_cost_isk: number;
    location_id: number;
    location_name?: string;
    acquisition_date?: string;
    justification: string;
  }): { success: boolean; opening_balance?: OpeningBalanceLot; error?: string } {
    const { character_id, type_id, quantity, unit_cost_isk, location_id, justification } = params;

    if (!justification || justification.trim().length < 3) {
      return {
        success: false,
        error: 'Une justification explicite et obligatoire est requise pour tout stock d\'ouverture (ex: Stock initial pré-ESI)',
      };
    }

    if (!quantity || quantity <= 0) {
      return { success: false, error: 'La quantité doit être supérieure à 0' };
    }

    if (unit_cost_isk === undefined || unit_cost_isk < 0) {
      return { success: false, error: 'Le coût unitaire doit être positif ou nul' };
    }

    if (!type_id || type_id <= 0) {
      return { success: false, error: 'type_id d\'article invalide' };
    }

    const resolvedHub = hubsService.resolveLocationToHub(location_id, params.location_name);
    const now = new Date().toISOString();
    const acquisitionDate = params.acquisition_date || now;
    const lotId = `ob-${character_id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const totalCost = roundIsk(quantity * unit_cost_isk);

    const record: OpeningBalanceLot = {
      id: lotId,
      character_id,
      type_id,
      type_name: params.type_name || `Type #${type_id}`,
      quantity,
      allocated_quantity: 0,
      remaining_quantity: quantity,
      unit_cost_isk: roundIsk(unit_cost_isk),
      total_cost_isk: totalCost,
      location_id,
      location_name: params.location_name,
      hub_id: resolvedHub.hub_id,
      hub_name: resolvedHub.hub_name,
      acquisition_date: acquisitionDate,
      justification: justification.trim(),
      created_at: now,
      updated_at: now,
      version: 1,
    };

    this.repo.saveOpeningBalance(record);
    return { success: true, opening_balance: record };
  }

  deleteOpeningBalance(id: string, characterId?: number): { success: boolean; error?: string } {
    const existing = this.repo.getOpeningBalance(id);
    if (!existing) {
      return { success: false, error: 'Stock d\'ouverture introuvable' };
    }

    if (characterId && existing.character_id !== characterId) {
      return { success: false, error: 'Accès refusé pour ce personnage' };
    }

    const existingAllocs = this.repo.getAllocationsForOpeningBalance(id);
    const manualAllocs = existingAllocs.filter((a) => a.reconciliation_mode === 'MANUAL');
    if (manualAllocs.length > 0) {
      return {
        success: false,
        error: 'Impossible de supprimer ce stock d\'ouverture car des allocations manuelles verrouillées y sont associées',
      };
    }

    // Clean up automatic allocations referencing this opening balance
    for (const alloc of existingAllocs) {
      this.repo.deleteAllocation(alloc.id);
    }

    this.repo.deleteOpeningBalance(id);
    return { success: true };
  }

  listOpeningBalances(characterId?: number, characterIds?: number[]): OpeningBalanceLot[] {
    const rawList = this.repo.listOpeningBalances(characterId, characterIds);
    return rawList.map((ob) => {
      const allocs = this.repo.getAllocationsForOpeningBalance(ob.id);
      const allocatedQty = allocs.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const remainingQty = Math.max(0, ob.quantity - allocatedQty);
      return {
        ...ob,
        allocated_quantity: allocatedQty,
        remaining_quantity: remainingQty,
      };
    });
  }

  // --- Allocations Management ---

  /**
   * Creates an explicit cost allocation between a sell transaction and a buy transaction or opening balance lot.
   * Supports same-character and cross-character trading within the player's ecosystem.
   */
  createExplicitAllocation(params: {
    character_id: number;
    buy_character_id?: number;
    sell_transaction_id: number;
    buy_transaction_id?: number;
    opening_balance_id?: string;
    quantity_to_allocate: number;
    custom_buy_fees?: number;
    custom_sell_fees?: number;
    notes?: string;
  }): { success: boolean; allocation?: ExplicitCostAllocation; error?: string } {
    const {
      character_id,
      sell_transaction_id,
      buy_transaction_id,
      opening_balance_id,
      quantity_to_allocate,
      notes,
    } = params;
    const sellCharId = character_id;

    if (!quantity_to_allocate || quantity_to_allocate <= 0) {
      return { success: false, error: 'La quantité allouée doit être supérieure à 0' };
    }

    if (!buy_transaction_id && !opening_balance_id) {
      return { success: false, error: 'Spécifiez un achat (buy_transaction_id) ou un stock d\'ouverture (opening_balance_id)' };
    }

    // 1. Fetch sell transaction
    const sellTx = this.ledgerRepo.getTransactionById(sellCharId, sell_transaction_id);
    if (!sellTx || sellTx.isBuy) {
      return { success: false, error: 'Transaction de vente introuvable ou invalide pour ce personnage' };
    }

    // 2. Check remaining allocatable quantity on sell transaction
    const existingSellAllocations = this.repo.getAllocationsForSellTx(sell_transaction_id);
    const alreadyAllocatedSellQty = existingSellAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
    const availableSellQty = sellTx.quantity - alreadyAllocatedSellQty;

    if (quantity_to_allocate > availableSellQty) {
      return {
        success: false,
        error: `Quantité demandée (${quantity_to_allocate}) supérieure au reliquat vendable non alloué (${availableSellQty})`,
      };
    }

    // 3. Impute sell fees
    let allocatedSellFees = params.custom_sell_fees !== undefined ? params.custom_sell_fees : 0;
    if (params.custom_sell_fees === undefined) {
      const totalSellFees = this.getTransactionFees(sellTx);
      const ratio = sellTx.quantity > 0 ? quantity_to_allocate / sellTx.quantity : 0;
      allocatedSellFees = roundIsk(totalSellFees * ratio);
    }

    const sellHub = hubsService.resolveLocationToHub(sellTx.locationId, sellTx.locationName);

    // Case A: Opening Balance Lot allocation
    if (opening_balance_id) {
      const ob = this.repo.getOpeningBalance(opening_balance_id);
      if (!ob) {
        return { success: false, error: 'Stock d\'ouverture introuvable' };
      }

      if (sellTx.typeId !== ob.type_id) {
        return {
          success: false,
          error: `Incompatibilité de type : vente pour ${sellTx.typeName || '#' + sellTx.typeId} et stock d'ouverture pour ${ob.type_name}`,
        };
      }

      // Check anteriority
      if (new Date(ob.acquisition_date).getTime() > new Date(sellTx.date).getTime()) {
        return {
          success: false,
          error: 'La date d\'acquisition du stock d\'ouverture doit être antérieure ou égale à la date de vente',
        };
      }

      const existingObAllocs = this.repo.getAllocationsForOpeningBalance(opening_balance_id);
      const alreadyAllocatedObQty = existingObAllocs.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const availableObQty = ob.quantity - alreadyAllocatedObQty;

      if (quantity_to_allocate > availableObQty) {
        return {
          success: false,
          error: `Quantité demandée (${quantity_to_allocate}) supérieure au stock disponible sur ce lot initial (${availableObQty})`,
        };
      }

      const allocatedBuyCost = roundIsk(quantity_to_allocate * ob.unit_cost_isk);
      const allocationId = `alloc-ob-${sell_transaction_id}-${opening_balance_id}-${Date.now()}`;

      const record: ExplicitCostAllocation = {
        id: allocationId,
        character_id: sellCharId,
        buy_character_id: ob.character_id,
        sell_character_id: sellCharId,
        sell_transaction_id,
        source_type: 'OPENING_BALANCE',
        opening_balance_id,
        type_id: sellTx.typeId,
        type_name: sellTx.typeName || `Type #${sellTx.typeId}`,
        quantity_allocated: quantity_to_allocate,
        unit_buy_price: ob.unit_cost_isk,
        allocated_buy_cost: allocatedBuyCost,
        allocated_buy_fees: 0, // Opening balances carry no additional buy broker fee
        allocated_sell_fees: allocatedSellFees,
        buy_location_id: ob.location_id,
        buy_hub_id: ob.hub_id,
        buy_hub_name: ob.hub_name,
        sell_location_id: sellTx.locationId,
        sell_hub_id: sellHub.hub_id,
        sell_hub_name: sellHub.hub_name,
        reconciliation_mode: 'MANUAL',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: notes?.trim() || `Allocation manuelle sur stock d'ouverture (${ob.justification})`,
        version: 1,
      };

      this.repo.saveAllocation(record);
      return { success: true, allocation: record };
    }

    // Case B: Transaction allocation
    const buyCharId = params.buy_character_id || character_id;
    const buyTx = this.ledgerRepo.getTransactionById(buyCharId, buy_transaction_id!);
    if (!buyTx || !buyTx.isBuy) {
      return { success: false, error: "Transaction d'achat introuvable ou invalide pour ce personnage" };
    }

    if (sellTx.typeId !== buyTx.typeId) {
      return {
        success: false,
        error: `Incompatibilité de type : vente pour ${sellTx.typeName || '#' + sellTx.typeId} (#${sellTx.typeId}) et achat pour ${buyTx.typeName || '#' + buyTx.typeId} (#${buyTx.typeId})`,
      };
    }

    // Strict domain rule: Temporal anteriority
    if (new Date(buyTx.date).getTime() > new Date(sellTx.date).getTime()) {
      return {
        success: false,
        error: 'La date d\'achat doit être antérieure ou égale à la date de vente',
      };
    }

    const existingBuyAllocations = this.repo.getAllocationsForBuyTx(buy_transaction_id!);
    const alreadyAllocatedBuyQty = existingBuyAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
    const availableBuyQty = buyTx.quantity - alreadyAllocatedBuyQty;

    if (quantity_to_allocate > availableBuyQty) {
      return {
        success: false,
        error: `Quantité demandée (${quantity_to_allocate}) supérieure au stock disponible sur cet achat (${availableBuyQty})`,
      };
    }

    let allocatedBuyFees = params.custom_buy_fees !== undefined ? params.custom_buy_fees : 0;
    if (params.custom_buy_fees === undefined) {
      const totalBuyFees = this.getTransactionFees(buyTx);
      const ratio = buyTx.quantity > 0 ? quantity_to_allocate / buyTx.quantity : 0;
      allocatedBuyFees = roundIsk(totalBuyFees * ratio);
    }

    const buyHub = hubsService.resolveLocationToHub(buyTx.locationId, buyTx.locationName);
    const allocationId = `alloc-${sell_transaction_id}-${buy_transaction_id}-${Date.now()}`;
    const allocatedBuyCost = roundIsk(quantity_to_allocate * buyTx.unitPrice);

    const record: ExplicitCostAllocation = {
      id: allocationId,
      character_id: sellCharId,
      buy_character_id: buyCharId,
      sell_character_id: sellCharId,
      sell_transaction_id,
      source_type: 'TRANSACTION',
      buy_transaction_id,
      type_id: sellTx.typeId,
      type_name: sellTx.typeName || `Type #${sellTx.typeId}`,
      quantity_allocated: quantity_to_allocate,
      unit_buy_price: buyTx.unitPrice,
      allocated_buy_cost: allocatedBuyCost,
      allocated_buy_fees: allocatedBuyFees,
      allocated_sell_fees: allocatedSellFees,
      buy_location_id: buyTx.locationId,
      buy_hub_id: buyHub.hub_id,
      buy_hub_name: buyHub.hub_name,
      sell_location_id: sellTx.locationId,
      sell_hub_id: sellHub.hub_id,
      sell_hub_name: sellHub.hub_name,
      reconciliation_mode: 'MANUAL',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: notes?.trim(),
      version: 1,
    };

    this.repo.saveAllocation(record);
    return { success: true, allocation: record };
  }

  /**
   * Automatic chronological (FIFO) multi-character reconciliation engine.
   * Matches sell transactions with unallocated earlier purchase transactions and opening balance lots,
   * preserving locked manual allocations.
   */
  autoReconcileFifo(params: AutoReconciliationParams = {}): AutoReconciliationResult {
    // 1. Fetch candidate transactions across single character or ecosystem
    const effectiveCharId = params.characterIds && params.characterIds.length > 0 ? undefined : params.characterId;
    let allTransactions = this.ledgerRepo.getAllTransactions(effectiveCharId, params.characterIds);
    if (params.typeId !== undefined) {
      allTransactions = allTransactions.filter((t) => t.typeId === params.typeId);
    }

    let transactions = allTransactions;
    if (params.characterIds && params.characterIds.length > 0) {
      const set = new Set(params.characterIds);
      transactions = transactions.filter((t) => set.has(t.characterId));
    }

    // 2. Clear previous automatic FIFO allocations is handled atomically in replaceAutoAllocations at step 6

    // 3. Fetch Candidate Purchase Stocks: Transactions + Opening Balances
    interface CandidateLot {
      sourceType: 'TRANSACTION' | 'OPENING_BALANCE';
      sourceId: number | string;
      characterId: number;
      typeId: number;
      typeName: string;
      unitPrice: number;
      date: string;
      locationId: number;
      locationName?: string;
      initialQty: number;
      availableQty: number;
      totalFees: number;
    }

    const candidateLots: CandidateLot[] = [];

    // 3.1 Buy transactions
    const buyTxs = transactions.filter((t) => t.isBuy);
    for (const buy of buyTxs) {
      const manualAllocs = this.repo
        .getAllocationsForBuyTx(buy.transactionId)
        .filter((a) => a.reconciliation_mode === 'MANUAL');
      const manualQty = manualAllocs.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const available = Math.max(0, buy.quantity - manualQty);

      if (available > 0) {
        candidateLots.push({
          sourceType: 'TRANSACTION',
          sourceId: buy.transactionId,
          characterId: buy.characterId,
          typeId: buy.typeId,
          typeName: buy.typeName || `Type #${buy.typeId}`,
          unitPrice: buy.unitPrice,
          date: buy.date,
          locationId: buy.locationId,
          locationName: buy.locationName,
          initialQty: buy.quantity,
          availableQty: available,
          totalFees: this.getTransactionFees(buy),
        });
      }
    }

    // 3.2 Opening Balance lots
    const openingLots = this.listOpeningBalances(params.characterId, params.characterIds);
    for (const ob of openingLots) {
      if (params.typeId !== undefined && ob.type_id !== params.typeId) continue;
      const manualAllocs = this.repo
        .getAllocationsForOpeningBalance(ob.id)
        .filter((a) => a.reconciliation_mode === 'MANUAL');
      const manualQty = manualAllocs.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const available = Math.max(0, ob.quantity - manualQty);

      if (available > 0) {
        candidateLots.push({
          sourceType: 'OPENING_BALANCE',
          sourceId: ob.id,
          characterId: ob.character_id,
          typeId: ob.type_id,
          typeName: ob.type_name,
          unitPrice: ob.unit_cost_isk,
          date: ob.acquisition_date,
          locationId: ob.location_id,
          locationName: ob.location_name,
          initialQty: ob.quantity,
          availableQty: available,
          totalFees: 0,
        });
      }
    }

    // Sort candidate lots chronologically (earliest acquisition first)
    candidateLots.sort((a, b) => {
      const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      return timeDiff !== 0 ? timeDiff : (typeof a.sourceId === 'number' && typeof b.sourceId === 'number' ? a.sourceId - b.sourceId : 0);
    });

    const lotsByTypeId = new Map<number, CandidateLot[]>();
    for (const lot of candidateLots) {
      if (!lotsByTypeId.has(lot.typeId)) {
        lotsByTypeId.set(lot.typeId, []);
      }
      lotsByTypeId.get(lot.typeId)!.push(lot);
    }

    // 4. Sort sales chronologically
    const sales = transactions
      .filter((t) => !t.isBuy)
      .sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return timeDiff !== 0 ? timeDiff : a.transactionId - b.transactionId;
      });

    // 5. Run FIFO matching
    const newAllocations: ExplicitCostAllocation[] = [];
    let allocationsCreated = 0;
    let totalQuantityReconciled = 0;
    let salesFullyMatched = 0;
    let salesPartiallyMatched = 0;
    let salesUnmatched = 0;
    let salesWithAssetStock = 0;
    let totalAssetStockFound = 0;

    for (const sale of sales) {
      const manualSellAllocations = this.repo
        .getAllocationsForSellTx(sale.transactionId)
        .filter((a) => a.reconciliation_mode === 'MANUAL');
      const alreadyAllocatedSell = manualSellAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      let neededQty = Math.max(0, sale.quantity - alreadyAllocatedSell);

      if (neededQty <= 0) {
        salesFullyMatched++;
        continue;
      }

      const saleTime = new Date(sale.date).getTime();
      const allLotsForType = lotsByTypeId.get(sale.typeId) || [];

      // Determine candidate lot ordering based on character priority and isolation settings
      let lots: CandidateLot[];
      if (params.strictCharacterIsolation) {
        // Mode cloisonné strict : seul le personnage vendeur peut consommer ses propres lots
        lots = allLotsForType.filter((l) => l.characterId === sale.characterId);
      } else if (params.prioritizeSellingCharacter ?? true) {
        // Mode prioritaire vendeur (défaut) : lots du vendeur d'abord, puis autres personnages en appoint
        const ownLots = allLotsForType.filter((l) => l.characterId === sale.characterId);
        const otherLots = allLotsForType.filter((l) => l.characterId !== sale.characterId);
        lots = [...ownLots, ...otherLots];
      } else {
        // Mode pot commun pur (FIFO chronologique global sans préférence d'entité)
        lots = allLotsForType;
      }

      let saleMatchedQty = 0;

      for (const lot of lots) {
        if (neededQty <= 0) break;
        if (lot.availableQty <= 0) continue;

        const lotTime = new Date(lot.date).getTime();
        // Strict domain rule: Temporal anteriority
        if (lotTime > saleTime) continue;

        const allocQty = Math.min(neededQty, lot.availableQty);
        lot.availableQty -= allocQty;
        neededQty -= allocQty;
        saleMatchedQty += allocQty;

        // Proportional fees
        const buyFeeRatio = lot.initialQty > 0 ? allocQty / lot.initialQty : 0;
        const allocatedBuyFees = roundIsk(lot.totalFees * buyFeeRatio);

        const totalSellFees = this.getTransactionFees(sale);
        const sellFeeRatio = sale.quantity > 0 ? allocQty / sale.quantity : 0;
        const allocatedSellFees = roundIsk(totalSellFees * sellFeeRatio);

        const buyHub = hubsService.resolveLocationToHub(lot.locationId, lot.locationName);
        const sellHub = hubsService.resolveLocationToHub(sale.locationId, sale.locationName);

        const allocId = `fifo-${sale.transactionId}-${lot.sourceId}-${Date.now()}-${allocationsCreated}`;
        const allocatedBuyCost = roundIsk(allocQty * lot.unitPrice);

        const record: ExplicitCostAllocation = {
          id: allocId,
          character_id: sale.characterId,
          buy_character_id: lot.characterId,
          sell_character_id: sale.characterId,
          sell_transaction_id: sale.transactionId,
          source_type: lot.sourceType,
          buy_transaction_id: lot.sourceType === 'TRANSACTION' ? Number(lot.sourceId) : undefined,
          opening_balance_id: lot.sourceType === 'OPENING_BALANCE' ? String(lot.sourceId) : undefined,
          type_id: sale.typeId,
          type_name: sale.typeName || `Type #${sale.typeId}`,
          quantity_allocated: allocQty,
          unit_buy_price: lot.unitPrice,
          allocated_buy_cost: allocatedBuyCost,
          allocated_buy_fees: allocatedBuyFees,
          allocated_sell_fees: allocatedSellFees,
          buy_location_id: lot.locationId,
          buy_hub_id: buyHub.hub_id,
          buy_hub_name: buyHub.hub_name,
          sell_location_id: sale.locationId,
          sell_hub_id: sellHub.hub_id,
          sell_hub_name: sellHub.hub_name,
          reconciliation_mode: 'FIFO_AUTOMATIC',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes: lot.sourceType === 'OPENING_BALANCE'
            ? `FIFO sur stock d'ouverture (Perso #${lot.characterId})`
            : lot.characterId === sale.characterId
            ? `FIFO unitaire (Achat #${lot.sourceId} -> Vente #${sale.transactionId})`
            : `FIFO multi-personnages (Achat #${lot.sourceId} Perso #${lot.characterId} -> Vente #${sale.transactionId} Perso #${sale.characterId})`,
          version: 1,
        };

        newAllocations.push(record);
        allocationsCreated++;
        totalQuantityReconciled += allocQty;
      }

      if (neededQty === 0) {
        salesFullyMatched++;
      } else if (saleMatchedQty > 0) {
        salesPartiallyMatched++;
      } else {
        salesUnmatched++;
      }

      // Check if unallocated quantity has physical stock backed by ESI assets
      if (neededQty > 0) {
        const charFilter = params.characterIds && params.characterIds.length > 0
          ? params.characterIds
          : params.characterId
          ? [params.characterId]
          : undefined;
        const assetStock = this.assetsService.getStockForType(sale.typeId, undefined, charFilter);
        if (assetStock > 0) {
          salesWithAssetStock++;
          totalAssetStockFound += assetStock;
        }
      }
    }

    // 6. Atomically replace automatic FIFO allocations for target scope
    this.repo.replaceAutoAllocations({
      characterId: params.characterId,
      characterIds: params.characterIds,
      typeId: params.typeId,
      allocations: newAllocations,
    });

    const assetStockMsg = salesWithAssetStock > 0
      ? ` (${salesWithAssetStock} ventes disposent de stocks réels identifiés dans les actifs ESI)`
      : '';
    const message = `${allocationsCreated} allocations créées (${totalQuantityReconciled} unités rapprochées). ${salesFullyMatched} ventes couvertes à 100%, ${salesPartiallyMatched} partielles, ${salesUnmatched} sans achat direct${assetStockMsg}.`;

    return {
      allocations_created: allocationsCreated,
      total_quantity_reconciled: totalQuantityReconciled,
      sales_fully_matched: salesFullyMatched,
      sales_partially_matched: salesPartiallyMatched,
      sales_unmatched: salesUnmatched,
      sales_with_asset_stock_identified: salesWithAssetStock,
      asset_stock_available_units: totalAssetStockFound,
      message,
    };
  }

  deleteAllocation(id: string, characterId?: number): boolean {
    const existing = this.repo.getAllocation(id);
    if (!existing) return false;
    if (characterId && existing.character_id !== characterId && existing.sell_character_id !== characterId) {
      return false; // Character isolation check
    }
    return this.repo.deleteAllocation(id);
  }

  listAllocations(characterId?: number, sellTxId?: number, characterIds?: number[]): ExplicitCostAllocation[] {
    let list = this.repo.listAllocations(characterId, characterIds);
    if (sellTxId) {
      list = list.filter((a) => a.sell_transaction_id === sellTxId);
    }
    return list;
  }

  getUnsoldInventory(characterId?: number, characterIds?: number[]): UnsoldInventoryItem[] {
    return this.repo.getUnsoldInventory(characterId, characterIds);
  }

  /**
   * Returns line-by-line sales reconciliation details with arithmetic proofs
   */
  getSalesReconciliationDetails(params: RoiFilterParams = {}): SaleReconciliationDetail[] {
    const { character_id, character_ids, start_date, end_date, type_id, sell_hub_id } = params;

    const effectiveCharId = character_ids && character_ids.length > 0 ? undefined : character_id;
    let transactions: CharacterTransaction[] = this.ledgerRepo.getAllTransactions(effectiveCharId, character_ids);

    if (character_ids && character_ids.length > 0) {
      const set = new Set(character_ids);
      transactions = transactions.filter((t) => set.has(t.characterId));
    }

    if (start_date) {
      transactions = transactions.filter((t) => t.date >= start_date);
    }
    if (end_date) {
      transactions = transactions.filter((t) => t.date <= end_date);
    }
    if (type_id) {
      transactions = transactions.filter((t) => t.typeId === type_id);
    }

    const salesTransactions = transactions.filter((t) => !t.isBuy);
    const allocations = this.repo.listAllocations(character_id, character_ids);
    const asOf = new Date().toISOString();

    const details: SaleReconciliationDetail[] = [];
    for (const sale of salesTransactions) {
      const detail = RoiCalculator.computeSaleDetail(sale, allocations, asOf);
      if (sell_hub_id && detail.hub_id !== sell_hub_id) {
        continue;
      }
      details.push(detail);
    }

    return details;
  }

  getSummary(params: RoiFilterParams = {}): RoiFinancialSummary {
    const { character_id, character_ids, start_date, end_date, type_id, buy_hub_id, sell_hub_id } = params;

    // Filter transactions using canonical ledger repository without pagination cap
    const effectiveCharId = character_ids && character_ids.length > 0 ? undefined : character_id;
    let transactions: CharacterTransaction[] = this.ledgerRepo.getAllTransactions(effectiveCharId, character_ids);

    if (character_ids && character_ids.length > 0) {
      const set = new Set(character_ids);
      transactions = transactions.filter((t) => set.has(t.characterId));
    }

    if (start_date) {
      transactions = transactions.filter((t) => t.date >= start_date);
    }
    if (end_date) {
      transactions = transactions.filter((t) => t.date <= end_date);
    }
    if (type_id) {
      transactions = transactions.filter((t) => t.typeId === type_id);
    }

    const salesTransactions = transactions.filter((t) => !t.isBuy);
    const salesTxIds = new Set(salesTransactions.map((t) => t.transactionId));

    // Filter allocations to match the evaluated sales scope
    let allocations = this.repo.listAllocations(character_id, character_ids);
    allocations = allocations.filter((a) => salesTxIds.has(a.sell_transaction_id));
    if (type_id) {
      allocations = allocations.filter((a) => a.type_id === type_id);
    }
    if (buy_hub_id) {
      allocations = allocations.filter((a) => a.buy_hub_id === buy_hub_id);
    }
    if (sell_hub_id) {
      allocations = allocations.filter((a) => a.sell_hub_id === sell_hub_id);
    }

    // Filter unsold inventory
    let unsoldInventory = this.repo.getUnsoldInventory(character_id, character_ids);
    if (type_id) {
      unsoldInventory = unsoldInventory.filter((i) => i.type_id === type_id);
    }
    if (buy_hub_id) {
      unsoldInventory = unsoldInventory.filter((i) => i.hub_id === buy_hub_id);
    }

    const periodLabel = start_date && end_date
      ? `Du ${start_date.substring(0, 10)} au ${end_date.substring(0, 10)}`
      : 'Toutes périodes';

    const brokerSummary = typeof this.ledgerRepo.getBrokerFeeSummary === 'function'
      ? this.ledgerRepo.getBrokerFeeSummary(character_id, character_ids)
      : undefined;

    return RoiCalculator.computeSummary(
      salesTransactions,
      allocations,
      unsoldInventory,
      character_id,
      periodLabel,
      brokerSummary ? {
        unallocated_broker_fees_isk: brokerSummary.unallocatedBrokerFeesIsk,
        total_broker_fees_collected_isk: brokerSummary.totalBrokerFeesCollectedIsk,
      } : undefined
    );
  }
}

export const roiService = new RoiService();

