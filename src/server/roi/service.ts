import { roiRepository, RoiRepository } from './repository';
import {
  ExplicitCostAllocation,
  RoiFilterParams,
  RoiFinancialSummary,
  UnsoldInventoryItem,
  AutoReconciliationResult,
} from './types';
import { ledgerRepository } from '../ledger/repository';
import { hubsService } from '../hubs/service';
import { RoiCalculator, roundIsk } from './calculator';
import type { CharacterTransaction } from '../ledger/types';
import type { AssetsService } from '../assets/service';
import { defaultAssetsService } from '../assets/service';

export class RoiService {
  constructor(
    private repo: RoiRepository = roiRepository,
    private assetsService: AssetsService = defaultAssetsService
  ) {}

  /**
   * Helper to retrieve linked fees for a transaction from wallet journal entries
   */
  private getTransactionFees(tx: CharacterTransaction): number {
    if (tx.tax !== undefined && tx.brokerFee !== undefined && (tx.tax > 0 || tx.brokerFee > 0)) {
      return tx.isBuy ? (tx.brokerFee || 0) : ((tx.tax || 0) + (tx.brokerFee || 0));
    }
    const { tax, brokerFee } = ledgerRepository.getJournalEntriesForTransaction(
      tx.characterId,
      tx.transactionId,
      tx.journalRefId,
      tx.date,
      tx.totalValue,
      tx.isBuy
    );
    return tx.isBuy ? brokerFee : (tax + brokerFee);
  }

  /**
   * Creates an explicit cost allocation between a sell transaction and a buy transaction.
   * Supports same-character and cross-character trading within the player's ecosystem.
   */
  createExplicitAllocation(params: {
    character_id: number;
    buy_character_id?: number;
    sell_transaction_id: number;
    buy_transaction_id: number;
    quantity_to_allocate: number;
    custom_buy_fees?: number;
    custom_sell_fees?: number;
    notes?: string;
  }): { success: boolean; allocation?: ExplicitCostAllocation; error?: string } {
    const { character_id, sell_transaction_id, buy_transaction_id, quantity_to_allocate, notes } = params;
    const buyCharId = params.buy_character_id || character_id;
    const sellCharId = character_id;

    if (!quantity_to_allocate || quantity_to_allocate <= 0) {
      return { success: false, error: 'La quantité allouée doit être supérieure à 0' };
    }

    // 1. Fetch transactions
    const sellTx = ledgerRepository.getTransactionById(sellCharId, sell_transaction_id);
    if (!sellTx || sellTx.isBuy) {
      return { success: false, error: 'Transaction de vente introuvable ou invalide pour ce personnage' };
    }

    const buyTx = ledgerRepository.getTransactionById(buyCharId, buy_transaction_id);
    if (!buyTx || !buyTx.isBuy) {
      return { success: false, error: "Transaction d'achat introuvable ou invalide pour ce personnage" };
    }

    // 2. Verify type matching
    if (sellTx.typeId !== buyTx.typeId) {
      return {
        success: false,
        error: `Incompatibilité de type : vente pour ${sellTx.typeName || '#' + sellTx.typeId} (#${sellTx.typeId}) et achat pour ${buyTx.typeName || '#' + buyTx.typeId} (#${buyTx.typeId})`,
      };
    }

    // 3. Check remaining allocatable quantity on sell transaction
    const existingSellAllocations = this.repo.getAllocationsForSellTx(sell_transaction_id);
    const alreadyAllocatedSellQty = existingSellAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
    const availableSellQty = sellTx.quantity - alreadyAllocatedSellQty;

    if (quantity_to_allocate > availableSellQty) {
      return {
        success: false,
        error: `Quantité demandée (${quantity_to_allocate}) supérieure au reliquat vendable non alloué (${availableSellQty})`,
      };
    }

    // 4. Check remaining available quantity on buy transaction
    const existingBuyAllocations = this.repo.getAllocationsForBuyTx(buy_transaction_id);
    const alreadyAllocatedBuyQty = existingBuyAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
    const availableBuyQty = buyTx.quantity - alreadyAllocatedBuyQty;

    if (quantity_to_allocate > availableBuyQty) {
      return {
        success: false,
        error: `Quantité demandée (${quantity_to_allocate}) supérieure au stock disponible sur cet achat (${availableBuyQty})`,
      };
    }

    // 5. Calculate proportional fees
    let allocatedBuyFees = params.custom_buy_fees !== undefined ? params.custom_buy_fees : 0;
    if (params.custom_buy_fees === undefined) {
      const totalBuyFees = this.getTransactionFees(buyTx);
      const ratio = buyTx.quantity > 0 ? quantity_to_allocate / buyTx.quantity : 0;
      allocatedBuyFees = roundIsk(totalBuyFees * ratio);
    }

    let allocatedSellFees = params.custom_sell_fees !== undefined ? params.custom_sell_fees : 0;
    if (params.custom_sell_fees === undefined) {
      const totalSellFees = this.getTransactionFees(sellTx);
      const ratio = sellTx.quantity > 0 ? quantity_to_allocate / sellTx.quantity : 0;
      allocatedSellFees = roundIsk(totalSellFees * ratio);
    }

    // 6. Hubs resolution
    const buyHub = hubsService.resolveLocationToHub(buyTx.locationId, buyTx.locationName);
    const sellHub = hubsService.resolveLocationToHub(sellTx.locationId, sellTx.locationName);

    const allocationId = `alloc-${sell_transaction_id}-${buy_transaction_id}-${Date.now()}`;
    const allocatedBuyCost = roundIsk(quantity_to_allocate * buyTx.unitPrice);

    const record: ExplicitCostAllocation = {
      id: allocationId,
      character_id: sellCharId,
      buy_character_id: buyCharId,
      sell_character_id: sellCharId,
      sell_transaction_id,
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
   * Matches sell transactions with unallocated earlier purchase transactions of the same typeId,
   * across the trading character pool.
   */
  autoReconcileFifo(params: {
    characterId?: number;
    characterIds?: number[];
    typeId?: number;
  } = {}): AutoReconciliationResult {
    // 1. Fetch ALL candidate transactions across single character or ecosystem without pagination cap
    const effectiveCharId = params.characterIds && params.characterIds.length > 0 ? undefined : params.characterId;
    let allTransactions = ledgerRepository.getAllTransactions(effectiveCharId, params.characterIds);
    if (params.typeId !== undefined) {
      allTransactions = allTransactions.filter((t) => t.typeId === params.typeId);
    }

    let transactions = allTransactions;
    if (params.characterIds && params.characterIds.length > 0) {
      const set = new Set(params.characterIds);
      transactions = transactions.filter((t) => set.has(t.characterId));
    }

    // 2. Clear previous automatic FIFO allocations for the target scope
    this.repo.clearAutoAllocations(params.characterId, params.characterIds);

    // 3. Separate purchases and sales and sort chronologically asc with transactionId tie-breaker
    const buys = transactions
      .filter((t) => t.isBuy)
      .sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return timeDiff !== 0 ? timeDiff : a.transactionId - b.transactionId;
      });

    const sales = transactions
      .filter((t) => !t.isBuy)
      .sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return timeDiff !== 0 ? timeDiff : a.transactionId - b.transactionId;
      });

    // 4. Track available quantities on buy transactions (accounting for any manual allocations)
    interface BuyStockState {
      tx: CharacterTransaction;
      availableQty: number;
    }

    const buyStockByTypeId = new Map<number, BuyStockState[]>();
    for (const buy of buys) {
      const manualAllocations = this.repo
        .getAllocationsForBuyTx(buy.transactionId)
        .filter((a) => a.reconciliation_mode === 'MANUAL');
      const manualAllocatedQty = manualAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const initialAvailable = Math.max(0, buy.quantity - manualAllocatedQty);

      if (initialAvailable > 0) {
        if (!buyStockByTypeId.has(buy.typeId)) {
          buyStockByTypeId.set(buy.typeId, []);
        }
        buyStockByTypeId.get(buy.typeId)!.push({
          tx: buy,
          availableQty: initialAvailable,
        });
      }
    }

    // 5. Match sales chronologically against earlier buys
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
      const buyStock = buyStockByTypeId.get(sale.typeId) || [];
      let saleMatchedQty = 0;

      for (const stock of buyStock) {
        if (neededQty <= 0) break;
        if (stock.availableQty <= 0) continue;

        const buyTime = new Date(stock.tx.date).getTime();
        // Strict domain rule: A sale can only reconcile against an earlier or contemporaneous buy
        if (buyTime > saleTime) continue;

        const allocQty = Math.min(neededQty, stock.availableQty);
        stock.availableQty -= allocQty;
        neededQty -= allocQty;
        saleMatchedQty += allocQty;

        // Calculate proportional fees
        const totalBuyFees = this.getTransactionFees(stock.tx);
        const buyFeeRatio = stock.tx.quantity > 0 ? allocQty / stock.tx.quantity : 0;
        const allocatedBuyFees = roundIsk(totalBuyFees * buyFeeRatio);

        const totalSellFees = this.getTransactionFees(sale);
        const sellFeeRatio = sale.quantity > 0 ? allocQty / sale.quantity : 0;
        const allocatedSellFees = roundIsk(totalSellFees * sellFeeRatio);

        const buyHub = hubsService.resolveLocationToHub(stock.tx.locationId, stock.tx.locationName);
        const sellHub = hubsService.resolveLocationToHub(sale.locationId, sale.locationName);

        const allocId = `fifo-${sale.transactionId}-${stock.tx.transactionId}-${Date.now()}-${allocationsCreated}`;
        const allocatedBuyCost = roundIsk(allocQty * stock.tx.unitPrice);

        const record: ExplicitCostAllocation = {
          id: allocId,
          character_id: sale.characterId,
          buy_character_id: stock.tx.characterId,
          sell_character_id: sale.characterId,
          sell_transaction_id: sale.transactionId,
          buy_transaction_id: stock.tx.transactionId,
          type_id: sale.typeId,
          type_name: sale.typeName || `Type #${sale.typeId}`,
          quantity_allocated: allocQty,
          unit_buy_price: stock.tx.unitPrice,
          allocated_buy_cost: allocatedBuyCost,
          allocated_buy_fees: allocatedBuyFees,
          allocated_sell_fees: allocatedSellFees,
          buy_location_id: stock.tx.locationId,
          buy_hub_id: buyHub.hub_id,
          buy_hub_name: buyHub.hub_name,
          sell_location_id: sale.locationId,
          sell_hub_id: sellHub.hub_id,
          sell_hub_name: sellHub.hub_name,
          reconciliation_mode: 'FIFO_AUTOMATIC',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes: `Rapprochement chronologique FIFO multi-personnages (Achat Perso #${stock.tx.characterId} -> Vente Perso #${sale.characterId})`,
          version: 1,
        };

        this.repo.saveAllocation(record);
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

  getSummary(params: RoiFilterParams = {}): RoiFinancialSummary {
    const { character_id, character_ids, start_date, end_date, type_id, buy_hub_id, sell_hub_id } = params;

    // Filter transactions using canonical ledger repository without pagination cap
    const effectiveCharId = character_ids && character_ids.length > 0 ? undefined : character_id;
    let transactions: CharacterTransaction[] = ledgerRepository.getAllTransactions(effectiveCharId, character_ids);

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

    // Filter allocations
    let allocations = this.repo.listAllocations(character_id, character_ids);
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

    return RoiCalculator.computeSummary(
      salesTransactions,
      allocations,
      unsoldInventory,
      character_id,
      periodLabel
    );
  }
}

export const roiService = new RoiService();
