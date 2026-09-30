import { ExplicitCostAllocation, UnsoldInventoryItem } from './types';
import { defaultLedgerRepository, type ILedgerRepository } from '../ledger/repository';
import { hubsService } from '../hubs/service';
import { roundIsk } from './calculator';

export class RoiRepository {
  // Map of allocation_id -> ExplicitCostAllocation
  private allocations = new Map<string, ExplicitCostAllocation>();

  constructor(private ledgerRepo: ILedgerRepository = defaultLedgerRepository) {}

  reset(): void {
    this.allocations.clear();
  }

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

  saveAllocation(allocation: ExplicitCostAllocation): void {
    this.allocations.set(allocation.id, { ...allocation });
  }

  deleteAllocation(id: string): boolean {
    return this.allocations.delete(id);
  }

  clearAutoAllocations(characterId?: number, characterIds?: number[]): void {
    const charSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    for (const [id, alloc] of this.allocations.entries()) {
      if (alloc.reconciliation_mode === 'FIFO_AUTOMATIC') {
        if (charSet) {
          if (
            charSet.has(alloc.character_id) ||
            (alloc.buy_character_id && charSet.has(alloc.buy_character_id)) ||
            (alloc.sell_character_id && charSet.has(alloc.sell_character_id))
          ) {
            this.allocations.delete(id);
          }
        } else if (!characterId || alloc.character_id === characterId || alloc.buy_character_id === characterId || alloc.sell_character_id === characterId) {
          this.allocations.delete(id);
        }
      }
    }
  }

  /**
   * Computes the remaining unsold (unallocated) quantity for all buy transactions.
   * If characterId is undefined, computes across all characters in the ecosystem.
   */
  getUnsoldInventory(characterId?: number, characterIds?: number[]): UnsoldInventoryItem[] {
    const effectiveCharId = characterIds && characterIds.length > 0 ? undefined : characterId;
    const { items: transactions } = this.ledgerRepo.getTransactions({
      characterId: effectiveCharId,
      pageSize: 100000,
    });

    let buyTxs = transactions.filter((t) => t.isBuy);
    if (characterIds && characterIds.length > 0) {
      const set = new Set(characterIds);
      buyTxs = buyTxs.filter((t) => set.has(t.characterId));
    }

    const inventory: UnsoldInventoryItem[] = [];

    for (const buyTx of buyTxs) {
      const existingAllocations = this.getAllocationsForBuyTx(buyTx.transactionId);
      const allocatedQty = existingAllocations.reduce((acc, a) => acc + a.quantity_allocated, 0);
      const remainingQty = Math.max(0, buyTx.quantity - allocatedQty);

      if (remainingQty > 0) {
        const resolvedHub = hubsService.resolveLocationToHub(buyTx.locationId, buyTx.locationName);
        const tiedCapital = roundIsk(remainingQty * buyTx.unitPrice);
        
        // Find linked broker fees for this buy transaction
        const { brokerFee: totalBuyFees } = this.ledgerRepo.getJournalEntriesForTransaction(
          buyTx.characterId,
          buyTx.transactionId,
          buyTx.journalRefId
        );

        const feeRatio = buyTx.quantity > 0 ? remainingQty / buyTx.quantity : 0;
        const remainingFees = roundIsk(totalBuyFees * feeRatio);

        inventory.push({
          character_id: buyTx.characterId,
          buy_transaction_id: buyTx.transactionId,
          type_id: buyTx.typeId,
          type_name: buyTx.typeName || `Type #${buyTx.typeId}`,
          buy_date: buyTx.date,
          original_quantity: buyTx.quantity,
          allocated_quantity: allocatedQty,
          remaining_quantity: remainingQty,
          unit_buy_price: buyTx.unitPrice,
          tied_capital_isk: tiedCapital,
          allocated_buy_fees_remaining: remainingFees,
          location_id: buyTx.locationId,
          hub_id: resolvedHub.hub_id,
          hub_name: resolvedHub.hub_name,
        });
      }
    }

    return inventory;
  }

  dumpData(): { allocations: ExplicitCostAllocation[] } {
    return {
      allocations: Array.from(this.allocations.values()),
    };
  }

  restoreData(data: { allocations: ExplicitCostAllocation[] }): void {
    this.allocations.clear();
    for (const alloc of data.allocations) {
      this.allocations.set(alloc.id, alloc);
    }
  }
}

export const roiRepository = new RoiRepository();
