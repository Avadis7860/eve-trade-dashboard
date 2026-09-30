import {
  ExplicitCostAllocation,
  OpeningBalanceLot,
  InventoryLot,
  UnsoldInventoryItem,
} from './types.ts';
import { defaultLedgerRepository, type ILedgerRepository } from '../ledger/repository.ts';
import { hubsService } from '../hubs/service.ts';
import { roundIsk } from './calculator.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export class RoiRepository {
  private allocations = new Map<string, ExplicitCostAllocation>();
  private openingBalances = new Map<string, OpeningBalanceLot>();

  constructor(
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private adapter: IDatabaseAdapter | null = null
  ) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.roi) {
        this.restoreData(state.data.roi, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.roi = {
        allocations: Array.from(this.allocations.values()),
        openingBalances: Array.from(this.openingBalances.values()),
      };
      this.adapter.persist();
    }
  }

  reset(): void {
    this.allocations.clear();
    this.openingBalances.clear();
    this.syncToStorage();
  }

  // --- Allocations Management ---

  listAllocations(characterId?: number, characterIds?: number[]): ExplicitCostAllocation[] {
    const list = Array.from(this.allocations.values());
    if (characterIds && characterIds.length > 0) {
      const set = new Set(characterIds);
      return list.filter((a) =>
        set.has(a.character_id) ||
        (a.buy_character_id && set.has(a.buy_character_id)) ||
        (a.sell_character_id && set.has(a.sell_character_id))
      );
    }
    if (characterId) {
      return list.filter((a) =>
        a.character_id === characterId ||
        a.buy_character_id === characterId ||
        a.sell_character_id === characterId
      );
    }
    return list;
  }

  getAllocation(id: string): ExplicitCostAllocation | undefined {
    return this.allocations.get(id);
  }

  getAllocationsForSellTx(sellTransactionId: number): ExplicitCostAllocation[] {
    return Array.from(this.allocations.values()).filter(
      (a) => a.sell_transaction_id === sellTransactionId
    );
  }

  getAllocationsForBuyTx(buyTransactionId: number): ExplicitCostAllocation[] {
    return Array.from(this.allocations.values()).filter(
      (a) => a.buy_transaction_id === buyTransactionId
    );
  }

  getAllocationsForOpeningBalance(openingBalanceId: string): ExplicitCostAllocation[] {
    return Array.from(this.allocations.values()).filter(
      (a) => a.opening_balance_id === openingBalanceId
    );
  }

  saveAllocation(allocation: ExplicitCostAllocation): void {
    this.allocations.set(allocation.id, { ...allocation });
    this.syncToStorage();
  }

  saveAllocations(allocations: ExplicitCostAllocation[]): void {
    if (allocations.length === 0) return;
    for (const allocation of allocations) {
      this.allocations.set(allocation.id, { ...allocation });
    }
    this.syncToStorage();
  }

  deleteAllocation(id: string): boolean {
    const deleted = this.allocations.delete(id);
    if (deleted) {
      this.syncToStorage();
    }
    return deleted;
  }

  clearAutoAllocations(characterId?: number, characterIds?: number[]): void {
    const charSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    let modified = false;

    for (const [id, alloc] of this.allocations.entries()) {
      if (alloc.reconciliation_mode === 'FIFO_AUTOMATIC') {
        if (charSet) {
          if (
            charSet.has(alloc.character_id) ||
            (alloc.buy_character_id && charSet.has(alloc.buy_character_id)) ||
            (alloc.sell_character_id && charSet.has(alloc.sell_character_id))
          ) {
            this.allocations.delete(id);
            modified = true;
          }
        } else if (!characterId || alloc.character_id === characterId || alloc.buy_character_id === characterId || alloc.sell_character_id === characterId) {
          this.allocations.delete(id);
          modified = true;
        }
      }
    }

    if (modified) {
      this.syncToStorage();
    }
  }

  // --- Opening Balance Lots Management ---

  saveOpeningBalance(lot: OpeningBalanceLot): void {
    this.openingBalances.set(lot.id, { ...lot });
    this.syncToStorage();
  }

  getOpeningBalance(id: string): OpeningBalanceLot | undefined {
    return this.openingBalances.get(id);
  }

  deleteOpeningBalance(id: string): boolean {
    const deleted = this.openingBalances.delete(id);
    if (deleted) {
      this.syncToStorage();
    }
    return deleted;
  }

  listOpeningBalances(characterId?: number, characterIds?: number[]): OpeningBalanceLot[] {
    const list = Array.from(this.openingBalances.values());
    if (characterIds && characterIds.length > 0) {
      const set = new Set(characterIds);
      return list.filter((ob) => set.has(ob.character_id));
    }
    if (characterId) {
      return list.filter((ob) => ob.character_id === characterId);
    }
    return list;
  }

  // --- Unified Inventory Lots & Unsold Inventory ---

  getInventoryLots(characterId?: number, characterIds?: number[], typeId?: number): InventoryLot[] {
    const lots: InventoryLot[] = [];
    const effectiveCharId = characterIds && characterIds.length > 0 ? undefined : characterId;

    // 1. Purchase Transactions from Ledger
    const { items: transactions } = this.ledgerRepo.getTransactions({
      characterId: effectiveCharId,
      pageSize: 100000,
    });

    let buyTxs = transactions.filter((t) => t.isBuy);
    if (characterIds && characterIds.length > 0) {
      const set = new Set(characterIds);
      buyTxs = buyTxs.filter((t) => set.has(t.characterId));
    }
    if (typeId !== undefined) {
      buyTxs = buyTxs.filter((t) => t.typeId === typeId);
    }

    for (const buyTx of buyTxs) {
      const existingAllocations = this.getAllocationsForBuyTx(buyTx.transactionId);
      const allocatedQty = existingAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const remainingQty = Math.max(0, buyTx.quantity - allocatedQty);

      const resolvedHub = hubsService.resolveLocationToHub(buyTx.locationId, buyTx.locationName);
      const { brokerFee: totalBuyFees } = this.ledgerRepo.getJournalEntriesForTransaction(
        buyTx.characterId,
        buyTx.transactionId,
        buyTx.journalRefId
      );

      const feeRatio = buyTx.quantity > 0 ? remainingQty / buyTx.quantity : 0;
      const remainingFees = roundIsk(totalBuyFees * feeRatio);

      lots.push({
        lot_id: `tx-${buyTx.characterId}-${buyTx.transactionId}`,
        character_id: buyTx.characterId,
        source_type: 'TRANSACTION',
        source_id: buyTx.transactionId,
        type_id: buyTx.typeId,
        type_name: buyTx.typeName || `Type #${buyTx.typeId}`,
        acquisition_date: buyTx.date,
        initial_quantity: buyTx.quantity,
        allocated_quantity: allocatedQty,
        remaining_quantity: remainingQty,
        unit_cost_isk: buyTx.unitPrice,
        total_cost_isk: roundIsk(buyTx.quantity * buyTx.unitPrice),
        remaining_cost_isk: roundIsk(remainingQty * buyTx.unitPrice),
        initial_buy_fees_isk: roundIsk(totalBuyFees),
        remaining_buy_fees_isk: remainingFees,
        location_id: buyTx.locationId,
        location_name: buyTx.locationName,
        hub_id: resolvedHub.hub_id,
        hub_name: resolvedHub.hub_name,
      });
    }

    // 2. Opening Balance Lots
    let openingLots = this.listOpeningBalances(characterId, characterIds);
    if (typeId !== undefined) {
      openingLots = openingLots.filter((ob) => ob.type_id === typeId);
    }

    for (const ob of openingLots) {
      const existingAllocations = this.getAllocationsForOpeningBalance(ob.id);
      const allocatedQty = existingAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const remainingQty = Math.max(0, ob.quantity - allocatedQty);

      lots.push({
        lot_id: ob.id,
        character_id: ob.character_id,
        source_type: 'OPENING_BALANCE',
        source_id: ob.id,
        type_id: ob.type_id,
        type_name: ob.type_name,
        acquisition_date: ob.acquisition_date,
        initial_quantity: ob.quantity,
        allocated_quantity: allocatedQty,
        remaining_quantity: remainingQty,
        unit_cost_isk: ob.unit_cost_isk,
        total_cost_isk: roundIsk(ob.quantity * ob.unit_cost_isk),
        remaining_cost_isk: roundIsk(remainingQty * ob.unit_cost_isk),
        initial_buy_fees_isk: 0,
        remaining_buy_fees_isk: 0,
        location_id: ob.location_id,
        location_name: ob.location_name,
        hub_id: ob.hub_id,
        hub_name: ob.hub_name,
        justification: ob.justification,
      });
    }

    return lots;
  }

  getUnsoldInventory(characterId?: number, characterIds?: number[]): UnsoldInventoryItem[] {
    const lots = this.getInventoryLots(characterId, characterIds);
    return lots
      .filter((lot) => lot.remaining_quantity > 0)
      .map((lot) => ({
        character_id: lot.character_id,
        source_type: lot.source_type,
        buy_transaction_id: lot.source_type === 'TRANSACTION' ? Number(lot.source_id) : undefined,
        opening_balance_id: lot.source_type === 'OPENING_BALANCE' ? String(lot.source_id) : undefined,
        type_id: lot.type_id,
        type_name: lot.type_name,
        buy_date: lot.acquisition_date,
        original_quantity: lot.initial_quantity,
        allocated_quantity: lot.allocated_quantity,
        remaining_quantity: lot.remaining_quantity,
        unit_buy_price: lot.unit_cost_isk,
        tied_capital_isk: lot.remaining_cost_isk,
        allocated_buy_fees_remaining: lot.remaining_buy_fees_isk,
        location_id: lot.location_id,
        hub_id: lot.hub_id,
        hub_name: lot.hub_name,
        justification: lot.justification,
      }));
  }

  dumpData(): { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] } {
    return {
      allocations: Array.from(this.allocations.values()),
      openingBalances: Array.from(this.openingBalances.values()),
    };
  }

  restoreData(data: { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] }, sync = true): void {
    this.allocations.clear();
    for (const alloc of data.allocations) {
      this.allocations.set(alloc.id, alloc);
    }
    this.openingBalances.clear();
    if (data.openingBalances) {
      for (const ob of data.openingBalances) {
        this.openingBalances.set(ob.id, ob);
      }
    }
    if (sync) {
      this.syncToStorage();
    }
  }
}

export const roiRepository = new RoiRepository(defaultLedgerRepository, StorageManager.getInstance().getAdapter());

