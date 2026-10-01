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

export interface IRoiRepository {
  reset(): void;
  listAllocations(characterId?: number, characterIds?: number[]): ExplicitCostAllocation[];
  getAllocation(id: string): ExplicitCostAllocation | undefined;
  getAllocationsForSellTx(sellTransactionId: number): ExplicitCostAllocation[];
  getAllocationsForBuyTx(buyTransactionId: number): ExplicitCostAllocation[];
  getAllocationsForOpeningBalance(openingBalanceId: string): ExplicitCostAllocation[];
  saveAllocation(allocation: ExplicitCostAllocation): void;
  saveAllocations(allocations: ExplicitCostAllocation[]): void;
  deleteAllocation(id: string): boolean;
  clearAutoAllocations(characterId?: number, characterIds?: number[]): void;
  saveOpeningBalance(lot: OpeningBalanceLot): void;
  getOpeningBalance(id: string): OpeningBalanceLot | undefined;
  deleteOpeningBalance(id: string): boolean;
  listOpeningBalances(characterId?: number, characterIds?: number[]): OpeningBalanceLot[];
  getInventoryLots(characterId?: number, characterIds?: number[], typeId?: number): InventoryLot[];
  getUnsoldInventory(characterId?: number, characterIds?: number[]): UnsoldInventoryItem[];
  dumpData(): { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] };
  clearCharacter(characterId: number): void;
  restoreData(data: { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] }, sync?: boolean): void;
}

export class PersistentRoiRepository implements IRoiRepository {
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

    // 1. Purchase Transactions from Ledger (exhaustive historical buy lots without truncation)
    let buyTxs = typeof this.ledgerRepo.getHistoricalBuyLots === 'function'
      ? this.ledgerRepo.getHistoricalBuyLots(effectiveCharId, characterIds, typeId)
      : this.ledgerRepo.getAllTransactions(effectiveCharId, characterIds).filter(
          (t) => t.isBuy && (typeId === undefined || t.typeId === typeId)
        );

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

  clearCharacter(characterId: number): void {
    let modified = false;
    for (const [id, alloc] of Array.from(this.allocations.entries())) {
      if (
        alloc.character_id === characterId ||
        alloc.buy_character_id === characterId ||
        alloc.sell_character_id === characterId
      ) {
        this.allocations.delete(id);
        modified = true;
      }
    }
    for (const [id, ob] of Array.from(this.openingBalances.entries())) {
      if (ob.character_id === characterId) {
        this.openingBalances.delete(id);
        modified = true;
      }
    }
    if (modified) {
      this.syncToStorage();
    }
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

export class InMemoryRoiRepository extends PersistentRoiRepository {}

/**
 * PostgreSQL implementation of ROI repository with SQL transactions,
 * parameterized queries and FIFO allocation management.
 */
export class PostgresRoiRepository implements IRoiRepository {
  private fallbackMemory: PersistentRoiRepository;

  constructor(
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private adapter: IDatabaseAdapter
  ) {
    this.fallbackMemory = new PersistentRoiRepository(this.ledgerRepo, null);
  }

  private mapRowToAlloc(row: Record<string, unknown>): ExplicitCostAllocation {
    return {
      id: String(row.id),
      character_id: Number(row.character_id),
      buy_character_id: row.buy_character_id ? Number(row.buy_character_id) : undefined,
      sell_character_id: row.sell_character_id ? Number(row.sell_character_id) : undefined,
      sell_transaction_id: Number(row.sell_transaction_id),
      buy_transaction_id: row.buy_transaction_id ? Number(row.buy_transaction_id) : undefined,
      opening_balance_id: row.opening_balance_id ? String(row.opening_balance_id) : undefined,
      lot_id: row.lot_id ? String(row.lot_id) : undefined,
      source_type: (row.source_type as ExplicitCostAllocation['source_type']) || 'TRANSACTION',
      type_id: Number(row.type_id),
      type_name: String(row.type_name),
      quantity_allocated: Number(row.quantity_allocated),
      unit_buy_price: Number(row.unit_cost_isk || row.unit_buy_price || 0),
      allocated_buy_cost: Number(row.unit_cost_isk || row.unit_buy_price || 0) * Number(row.quantity_allocated),
      allocated_buy_fees: Number(row.allocated_buy_broker_fee_isk || row.allocated_buy_fees || 0),
      allocated_sell_fees: Number(row.allocated_sell_broker_fee_isk || row.allocated_sell_fees || 0),
      buy_location_id: Number(row.buy_location_id || 0),
      buy_hub_id: String(row.buy_hub_id || 'UNKNOWN_HUB'),
      buy_hub_name: String(row.buy_hub_name || 'Hub Inconnu'),
      sell_location_id: Number(row.sell_location_id || 0),
      sell_hub_id: String(row.sell_hub_id || 'UNKNOWN_HUB'),
      sell_hub_name: String(row.sell_hub_name || 'Hub Inconnu'),
      reconciliation_mode: row.reconciliation_mode as ExplicitCostAllocation['reconciliation_mode'],
      created_at: String(row.allocated_at || row.created_at || new Date().toISOString()),
      updated_at: String(row.updated_at || row.allocated_at || new Date().toISOString()),
      notes: row.notes ? String(row.notes) : undefined,
      version: Number(row.version || 1),
    };
  }

  private mapRowToOpening(row: Record<string, unknown>): OpeningBalanceLot {
    return {
      id: String(row.id),
      character_id: Number(row.character_id),
      type_id: Number(row.type_id),
      type_name: String(row.type_name),
      quantity: Number(row.quantity),
      allocated_quantity: Number(row.allocated_quantity || 0),
      remaining_quantity: Number(row.remaining_quantity),
      unit_cost_isk: Number(row.unit_cost_isk),
      total_cost_isk: Number(row.total_cost_isk),
      location_id: Number(row.location_id),
      location_name: row.location_name ? String(row.location_name) : undefined,
      hub_id: String(row.hub_id),
      hub_name: String(row.hub_name),
      acquisition_date: String(row.acquisition_date),
      justification: String(row.justification),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      version: Number(row.version || 1),
    };
  }

  public reset(): void {
    this.fallbackMemory.reset();
    this.resetAsync().catch(() => {});
  }

  public async resetAsync(): Promise<void> {
    await this.adapter.execute('DELETE FROM explicit_cost_allocations');
    await this.adapter.execute('DELETE FROM opening_balances');
  }

  public listAllocations(characterId?: number, characterIds?: number[]): ExplicitCostAllocation[] {
    return this.fallbackMemory.listAllocations(characterId, characterIds);
  }

  public async listAllocationsAsync(characterId?: number, characterIds?: number[]): Promise<ExplicitCostAllocation[]> {
    let sql = 'SELECT * FROM explicit_cost_allocations';
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1) OR buy_character_id = ANY($1) OR sell_character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId) {
      sql += ' WHERE character_id = $1 OR buy_character_id = $1 OR sell_character_id = $1';
      params.push(characterId);
    }
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToAlloc(r));
  }

  public getAllocation(id: string): ExplicitCostAllocation | undefined {
    return this.fallbackMemory.getAllocation(id);
  }

  public async getAllocationAsync(id: string): Promise<ExplicitCostAllocation | undefined> {
    const res = await this.adapter.query('SELECT * FROM explicit_cost_allocations WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToAlloc(res.rows[0]);
  }

  public getAllocationsForSellTx(sellTransactionId: number): ExplicitCostAllocation[] {
    return this.fallbackMemory.getAllocationsForSellTx(sellTransactionId);
  }

  public async getAllocationsForSellTxAsync(sellTransactionId: number): Promise<ExplicitCostAllocation[]> {
    const res = await this.adapter.query(
      'SELECT * FROM explicit_cost_allocations WHERE sell_transaction_id = $1',
      [sellTransactionId]
    );
    return res.rows.map((r) => this.mapRowToAlloc(r));
  }

  public getAllocationsForBuyTx(buyTransactionId: number): ExplicitCostAllocation[] {
    return this.fallbackMemory.getAllocationsForBuyTx(buyTransactionId);
  }

  public async getAllocationsForBuyTxAsync(buyTransactionId: number): Promise<ExplicitCostAllocation[]> {
    const res = await this.adapter.query(
      'SELECT * FROM explicit_cost_allocations WHERE buy_transaction_id = $1',
      [buyTransactionId]
    );
    return res.rows.map((r) => this.mapRowToAlloc(r));
  }

  public getAllocationsForOpeningBalance(openingBalanceId: string): ExplicitCostAllocation[] {
    return this.fallbackMemory.getAllocationsForOpeningBalance(openingBalanceId);
  }

  public async getAllocationsForOpeningBalanceAsync(openingBalanceId: string): Promise<ExplicitCostAllocation[]> {
    const res = await this.adapter.query(
      'SELECT * FROM explicit_cost_allocations WHERE opening_balance_id = $1',
      [openingBalanceId]
    );
    return res.rows.map((r) => this.mapRowToAlloc(r));
  }

  public saveAllocation(allocation: ExplicitCostAllocation): void {
    this.fallbackMemory.saveAllocation(allocation);
    this.saveAllocationAsync(allocation).catch(() => {});
  }

  public async saveAllocationAsync(allocation: ExplicitCostAllocation): Promise<void> {
    const sql = `
      INSERT INTO explicit_cost_allocations (
        id, character_id, buy_character_id, sell_character_id, sell_transaction_id,
        buy_transaction_id, opening_balance_id, source_type, type_id, type_name,
        quantity_allocated, unit_cost_isk, unit_sale_price_isk,
        allocated_buy_broker_fee_isk, allocated_sell_broker_fee_isk,
        allocated_sales_tax_isk, reconciliation_mode, allocated_at, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      ON CONFLICT (id) DO UPDATE SET
        character_id = EXCLUDED.character_id,
        buy_character_id = EXCLUDED.buy_character_id,
        sell_character_id = EXCLUDED.sell_character_id,
        sell_transaction_id = EXCLUDED.sell_transaction_id,
        buy_transaction_id = EXCLUDED.buy_transaction_id,
        opening_balance_id = EXCLUDED.opening_balance_id,
        source_type = EXCLUDED.source_type,
        type_id = EXCLUDED.type_id,
        type_name = EXCLUDED.type_name,
        quantity_allocated = EXCLUDED.quantity_allocated,
        unit_cost_isk = EXCLUDED.unit_cost_isk,
        unit_sale_price_isk = EXCLUDED.unit_sale_price_isk,
        allocated_buy_broker_fee_isk = EXCLUDED.allocated_buy_broker_fee_isk,
        allocated_sell_broker_fee_isk = EXCLUDED.allocated_sell_broker_fee_isk,
        allocated_sales_tax_isk = EXCLUDED.allocated_sales_tax_isk,
        reconciliation_mode = EXCLUDED.reconciliation_mode,
        allocated_at = EXCLUDED.allocated_at,
        notes = EXCLUDED.notes
    `;
    const params = [
      allocation.id,
      allocation.character_id,
      allocation.buy_character_id || null,
      allocation.sell_character_id || null,
      allocation.sell_transaction_id,
      allocation.buy_transaction_id || null,
      allocation.opening_balance_id || null,
      allocation.source_type || 'TRANSACTION',
      allocation.type_id,
      allocation.type_name,
      allocation.quantity_allocated,
      allocation.unit_buy_price,
      allocation.unit_buy_price,
      allocation.allocated_buy_fees || 0,
      allocation.allocated_sell_fees || 0,
      allocation.allocated_sell_fees || 0,
      allocation.reconciliation_mode,
      allocation.created_at || new Date().toISOString(),
      allocation.notes || null,
    ];
    await this.adapter.execute(sql, params);
  }

  public saveAllocations(allocations: ExplicitCostAllocation[]): void {
    this.fallbackMemory.saveAllocations(allocations);
    this.saveAllocationsAsync(allocations).catch(() => {});
  }

  public async saveAllocationsAsync(allocations: ExplicitCostAllocation[]): Promise<void> {
    if (allocations.length === 0) return;
    await this.adapter.transaction(async (tx) => {
      for (const allocation of allocations) {
        const sql = `
          INSERT INTO explicit_cost_allocations (
            id, character_id, buy_character_id, sell_character_id, sell_transaction_id,
            buy_transaction_id, opening_balance_id, source_type, type_id, type_name,
            quantity_allocated, unit_cost_isk, unit_sale_price_isk,
            allocated_buy_broker_fee_isk, allocated_sell_broker_fee_isk,
            allocated_sales_tax_isk, reconciliation_mode, allocated_at, notes
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19
          )
          ON CONFLICT (id) DO UPDATE SET
            character_id = EXCLUDED.character_id,
            buy_character_id = EXCLUDED.buy_character_id,
            sell_character_id = EXCLUDED.sell_character_id,
            sell_transaction_id = EXCLUDED.sell_transaction_id,
            buy_transaction_id = EXCLUDED.buy_transaction_id,
            opening_balance_id = EXCLUDED.opening_balance_id,
            source_type = EXCLUDED.source_type,
            type_id = EXCLUDED.type_id,
            type_name = EXCLUDED.type_name,
            quantity_allocated = EXCLUDED.quantity_allocated,
            unit_cost_isk = EXCLUDED.unit_cost_isk,
            unit_sale_price_isk = EXCLUDED.unit_sale_price_isk,
            allocated_buy_broker_fee_isk = EXCLUDED.allocated_buy_broker_fee_isk,
            allocated_sell_broker_fee_isk = EXCLUDED.allocated_sell_broker_fee_isk,
            allocated_sales_tax_isk = EXCLUDED.allocated_sales_tax_isk,
            reconciliation_mode = EXCLUDED.reconciliation_mode,
            allocated_at = EXCLUDED.allocated_at,
            notes = EXCLUDED.notes
        `;
        const params = [
          allocation.id,
          allocation.character_id,
          allocation.buy_character_id || null,
          allocation.sell_character_id || null,
          allocation.sell_transaction_id,
          allocation.buy_transaction_id || null,
          allocation.opening_balance_id || null,
          allocation.source_type || 'TRANSACTION',
          allocation.type_id,
          allocation.type_name,
          allocation.quantity_allocated,
          allocation.unit_buy_price,
          allocation.unit_buy_price,
          allocation.allocated_buy_fees || 0,
          allocation.allocated_sell_fees || 0,
          allocation.allocated_sell_fees || 0,
          allocation.reconciliation_mode,
          allocation.created_at || new Date().toISOString(),
          allocation.notes || null,
        ];
        await tx.execute(sql, params);
      }
    });
  }

  public deleteAllocation(id: string): boolean {
    const deleted = this.fallbackMemory.deleteAllocation(id);
    this.deleteAllocationAsync(id).catch(() => {});
    return deleted;
  }

  public async deleteAllocationAsync(id: string): Promise<boolean> {
    const res = await this.adapter.execute('DELETE FROM explicit_cost_allocations WHERE id = $1', [id]);
    return res > 0;
  }

  public clearAutoAllocations(characterId?: number, characterIds?: number[]): void {
    this.fallbackMemory.clearAutoAllocations(characterId, characterIds);
    this.clearAutoAllocationsAsync(characterId, characterIds).catch(() => {});
  }

  public async clearAutoAllocationsAsync(characterId?: number, characterIds?: number[]): Promise<void> {
    let sql = "DELETE FROM explicit_cost_allocations WHERE reconciliation_mode = 'FIFO_AUTOMATIC'";
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' AND (character_id = ANY($1) OR buy_character_id = ANY($1) OR sell_character_id = ANY($1))';
      params.push(characterIds);
    } else if (characterId) {
      sql += ' AND (character_id = $1 OR buy_character_id = $1 OR sell_character_id = $1)';
      params.push(characterId);
    }
    await this.adapter.execute(sql, params);
  }

  public saveOpeningBalance(lot: OpeningBalanceLot): void {
    this.fallbackMemory.saveOpeningBalance(lot);
    this.saveOpeningBalanceAsync(lot).catch(() => {});
  }

  public async saveOpeningBalanceAsync(lot: OpeningBalanceLot): Promise<void> {
    const sql = `
      INSERT INTO opening_balances (
        id, character_id, type_id, type_name, quantity, allocated_quantity,
        remaining_quantity, unit_cost_isk, total_cost_isk, location_id,
        location_name, hub_id, hub_name, acquisition_date, justification,
        created_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18
      )
      ON CONFLICT (id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        allocated_quantity = EXCLUDED.allocated_quantity,
        remaining_quantity = EXCLUDED.remaining_quantity,
        unit_cost_isk = EXCLUDED.unit_cost_isk,
        total_cost_isk = EXCLUDED.total_cost_isk,
        location_id = EXCLUDED.location_id,
        location_name = EXCLUDED.location_name,
        hub_id = EXCLUDED.hub_id,
        hub_name = EXCLUDED.hub_name,
        acquisition_date = EXCLUDED.acquisition_date,
        justification = EXCLUDED.justification,
        updated_at = EXCLUDED.updated_at,
        version = EXCLUDED.version
    `;
    const params = [
      lot.id,
      lot.character_id,
      lot.type_id,
      lot.type_name,
      lot.quantity,
      lot.allocated_quantity || 0,
      lot.remaining_quantity,
      lot.unit_cost_isk,
      lot.total_cost_isk,
      lot.location_id,
      lot.location_name || null,
      lot.hub_id,
      lot.hub_name,
      lot.acquisition_date,
      lot.justification,
      lot.created_at,
      lot.updated_at,
      lot.version || 1,
    ];
    await this.adapter.execute(sql, params);
  }

  public getOpeningBalance(id: string): OpeningBalanceLot | undefined {
    return this.fallbackMemory.getOpeningBalance(id);
  }

  public async getOpeningBalanceAsync(id: string): Promise<OpeningBalanceLot | undefined> {
    const res = await this.adapter.query('SELECT * FROM opening_balances WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToOpening(res.rows[0]);
  }

  public deleteOpeningBalance(id: string): boolean {
    const deleted = this.fallbackMemory.deleteOpeningBalance(id);
    this.deleteOpeningBalanceAsync(id).catch(() => {});
    return deleted;
  }

  public async deleteOpeningBalanceAsync(id: string): Promise<boolean> {
    const res = await this.adapter.execute('DELETE FROM opening_balances WHERE id = $1', [id]);
    return res > 0;
  }

  public listOpeningBalances(characterId?: number, characterIds?: number[]): OpeningBalanceLot[] {
    return this.fallbackMemory.listOpeningBalances(characterId, characterIds);
  }

  public async listOpeningBalancesAsync(characterId?: number, characterIds?: number[]): Promise<OpeningBalanceLot[]> {
    let sql = 'SELECT * FROM opening_balances';
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId) {
      sql += ' WHERE character_id = $1';
      params.push(characterId);
    }
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToOpening(r));
  }

  public getInventoryLots(characterId?: number, characterIds?: number[], typeId?: number): InventoryLot[] {
    return this.fallbackMemory.getInventoryLots(characterId, characterIds, typeId);
  }

  public getUnsoldInventory(characterId?: number, characterIds?: number[]): UnsoldInventoryItem[] {
    return this.fallbackMemory.getUnsoldInventory(characterId, characterIds);
  }

  public dumpData(): { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] } {
    return this.fallbackMemory.dumpData();
  }

  public clearCharacter(characterId: number): void {
    this.fallbackMemory.clearCharacter(characterId);
    this.clearCharacterAsync(characterId).catch(() => {});
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    await this.adapter.execute(
      'DELETE FROM explicit_cost_allocations WHERE character_id = $1 OR buy_character_id = $1 OR sell_character_id = $1',
      [characterId]
    );
    await this.adapter.execute('DELETE FROM opening_balances WHERE character_id = $1', [characterId]);
  }

  public restoreData(data: { allocations: ExplicitCostAllocation[]; openingBalances?: OpeningBalanceLot[] }, sync = true): void {
    this.fallbackMemory.restoreData(data, sync);
  }
}

export type RoiRepository = IRoiRepository;
export const RoiRepository = PersistentRoiRepository;

export const defaultRoiRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresRoiRepository(defaultLedgerRepository, StorageManager.getInstance().getAdapter())
  : new PersistentRoiRepository(defaultLedgerRepository, StorageManager.getInstance().getAdapter());
export const roiRepository = defaultRoiRepository;

