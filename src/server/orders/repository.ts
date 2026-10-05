import type {
  CharacterOrderSnapshot,
  OrderQueryFilters,
  OrderSummaryMetrics,
  RestockItem,
  CreateRestockItemDto,
  UpdateRestockItemDto,
} from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export interface IOrdersRepository {
  init?(): Promise<void>;
  saveOrderSnapshots(snapshots: CharacterOrderSnapshot[]): { inserted: number; updated: number };
  getOrders(filters: OrderQueryFilters): { items: CharacterOrderSnapshot[]; total: number; page: number; pageSize: number; totalPages: number };
  getOrderById(characterId: number, orderId: number): CharacterOrderSnapshot | null;
  getOrdersForCharacter(characterId: number): CharacterOrderSnapshot[];
  getSummary(characterId: number): OrderSummaryMetrics;
  markMissingOrdersAsDisappeared(characterId: number, currentOrderIds: Set<number>, observedAt: number): number;
  getRestockItems(characterId: number): RestockItem[];
  getRestockItemById(characterId: number, itemId: string): RestockItem | null;
  createRestockItem(dto: CreateRestockItemDto): RestockItem;
  updateRestockItem(characterId: number, itemId: string, updates: UpdateRestockItemDto): RestockItem | null;
  deleteRestockItem(characterId: number, itemId: string): boolean;
  clearCharacter(characterId: number): void;
  dumpData(): { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] };
  restoreData(data: { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] }): void;
}

export class PersistentOrdersRepository implements IOrdersRepository {
  private orders: Map<string, CharacterOrderSnapshot> = new Map();
  private restockItems: Map<string, RestockItem> = new Map();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.orders) {
        this.restoreData(state.data.orders, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.orders = {
        snapshots: Array.from(this.orders.values()),
        restockItems: Array.from(this.restockItems.values()),
      };
      this.adapter.persist();
    }
  }

  private makeOrderKey(characterId: number, orderId: number): string {
    return `${characterId}:${orderId}`;
  }

  public saveOrderSnapshots(snapshots: CharacterOrderSnapshot[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;

    for (const snap of snapshots) {
      const key = this.makeOrderKey(snap.characterId, snap.orderId);
      if (this.orders.has(key)) {
        const existing = this.orders.get(key)!;
        this.orders.set(key, {
          ...existing,
          ...snap,
          firstObservedAt: existing.firstObservedAt,
          lastSnapshotVolumeRemain: existing.volumeRemain,
        });
        updated++;
      } else {
        this.orders.set(key, { ...snap });
        inserted++;
      }
    }

    this.syncToStorage();
    return { inserted, updated };
  }

  public getOrderById(characterId: number, orderId: number): CharacterOrderSnapshot | null {
    return this.orders.get(this.makeOrderKey(characterId, orderId)) || null;
  }

  public getOrdersForCharacter(characterId: number): CharacterOrderSnapshot[] {
    const list: CharacterOrderSnapshot[] = [];
    for (const order of this.orders.values()) {
      if (order.characterId === characterId) {
        list.push(order);
      }
    }
    return list;
  }

  public markMissingOrdersAsDisappeared(
    characterId: number,
    currentActiveOrderIds: Set<number>,
    observedAt: number
  ): number {
    let changed = 0;
    for (const [key, order] of this.orders.entries()) {
      if (order.characterId === characterId && order.isActiveInCurrentSnapshot) {
        if (!currentActiveOrderIds.has(order.orderId)) {
          const updatedOrder: CharacterOrderSnapshot = {
            ...order,
            isActiveInCurrentSnapshot: false,
            lastObservedAt: observedAt,
          };

          if (order.state === 'ACTIVE' || order.state === 'PARTIALLY_FILLED') {
            updatedOrder.state = 'DISAPPEARED_UNCONFIRMED';
            updatedOrder.stateJustification =
              "Ordre disparu du snapshot actif sans confirmation ESI d'historique (vente complète, expiration ou annulation à confirmer).";
            changed++;
          }
          this.orders.set(key, updatedOrder);
        }
      }
    }
    if (changed > 0) {
      this.syncToStorage();
    }
    return changed;
  }

  public getOrders(filters: OrderQueryFilters): {
    items: CharacterOrderSnapshot[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    const {
      characterId,
      state,
      isBuyOrder,
      locationId,
      typeId,
      search,
      sortBy = 'issued',
      sortOrder = 'desc',
      page = 1,
      pageSize = 50,
    } = filters;

    const matched: CharacterOrderSnapshot[] = [];
    const searchLower = search ? search.trim().toLowerCase() : '';

    for (const order of this.orders.values()) {
      if (order.characterId !== characterId) continue;

      if (state && state !== 'ALL') {
        if (state === 'ACTIVE_ALL') {
          if (order.state !== 'ACTIVE' && order.state !== 'PARTIALLY_FILLED') continue;
        } else if (order.state !== state) {
          continue;
        }
      }

      if (isBuyOrder !== undefined && order.isBuyOrder !== isBuyOrder) continue;
      if (typeId !== undefined && order.typeId !== typeId) continue;
      if (locationId !== undefined && order.locationId !== locationId) continue;

      if (searchLower) {
        const matchName = order.typeName?.toLowerCase().includes(searchLower);
        const matchLoc = order.locationName?.toLowerCase().includes(searchLower);
        const matchOrderId = String(order.orderId).includes(searchLower);
        if (!matchName && !matchLoc && !matchOrderId) continue;
      }

      matched.push(order);
    }

    matched.sort((a, b) => {
      let comp = 0;
      switch (sortBy) {
        case 'issued':
          comp = new Date(a.issued).getTime() - new Date(b.issued).getTime();
          break;
        case 'lastObservedAt':
          comp = a.lastObservedAt - b.lastObservedAt;
          break;
        case 'volumeFilled':
          comp = a.volumeFilled - b.volumeFilled;
          break;
        case 'price':
          comp = a.price - b.price;
          break;
        case 'typeName':
          comp = (a.typeName || '').localeCompare(b.typeName || '');
          break;
        case 'state':
          comp = a.state.localeCompare(b.state);
          break;
        default:
          comp = new Date(a.issued).getTime() - new Date(b.issued).getTime();
      }
      return sortOrder === 'asc' ? comp : -comp;
    });

    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const offset = (validPage - 1) * validPageSize;
    const items = matched.slice(offset, offset + validPageSize);

    return { items, total, page: validPage, pageSize: validPageSize, totalPages };
  }

  public getSummary(characterId: number): OrderSummaryMetrics {
    let totalOrdersTracked = 0;
    let activeOrdersCount = 0;
    let partiallyFilledCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let expiredCount = 0;
    let disappearedCount = 0;
    let totalActiveIskValue = 0;
    let totalActiveEscrowIsk = 0;

    for (const order of this.orders.values()) {
      if (order.characterId !== characterId) continue;

      totalOrdersTracked++;
      if (order.state === 'ACTIVE') {
        activeOrdersCount++;
        totalActiveIskValue += order.price * order.volumeRemain;
        if (order.isBuyOrder && order.escrow) {
          totalActiveEscrowIsk += order.escrow;
        }
      } else if (order.state === 'PARTIALLY_FILLED') {
        partiallyFilledCount++;
        totalActiveIskValue += order.price * order.volumeRemain;
        if (order.isBuyOrder && order.escrow) {
          totalActiveEscrowIsk += order.escrow;
        }
      } else if (order.state === 'COMPLETED_CONFIRMED') {
        completedCount++;
      } else if (order.state === 'CANCELLED_CONFIRMED') {
        cancelledCount++;
      } else if (order.state === 'EXPIRED_CONFIRMED') {
        expiredCount++;
      } else if (order.state === 'DISAPPEARED_UNCONFIRMED') {
        disappearedCount++;
      }
    }

    return {
      characterId,
      asOf: Date.now(),
      totalOrdersTracked,
      activeOrdersCount,
      partiallyFilledCount,
      completedCount,
      cancelledCount,
      expiredCount,
      disappearedCount,
      totalActiveIskValue,
      totalActiveEscrowIsk,
    };
  }

  public getRestockItems(characterId: number): RestockItem[] {
    const list: RestockItem[] = [];
    for (const item of this.restockItems.values()) {
      if (item.characterId === characterId) {
        list.push(item);
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  public getRestockItemById(characterId: number, itemId: string): RestockItem | null {
    const item = this.restockItems.get(itemId);
    if (item && item.characterId === characterId) {
      return item;
    }
    return null;
  }

  public createRestockItem(dto: CreateRestockItemDto): RestockItem {
    const id = `${dto.characterId}:${dto.typeId}:${dto.sellHubId}:${Date.now()}`;
    const now = Date.now();

    const item: RestockItem = {
      id,
      characterId: dto.characterId,
      typeId: dto.typeId,
      typeName: dto.typeName || `Type #${dto.typeId}`,
      targetBuyHubId: dto.targetBuyHubId,
      targetBuyHubName: dto.targetBuyHubName || `Hub #${dto.targetBuyHubId}`,
      sellHubId: dto.sellHubId,
      sellHubName: dto.sellHubName || `Hub #${dto.sellHubId}`,
      suggestedQuantity: dto.suggestedQuantity,
      targetQuantity: dto.targetQuantity,
      estimatedBuyUnitPrice: dto.estimatedBuyUnitPrice,
      status: 'SUGGESTED',
      justification: dto.justification,
      linkedOrderId: dto.linkedOrderId,
      notes: dto.notes,
      createdAt: now,
      updatedAt: now,
    };

    this.restockItems.set(id, item);
    this.syncToStorage();
    return item;
  }

  public updateRestockItem(
    characterId: number,
    itemId: string,
    updates: UpdateRestockItemDto
  ): RestockItem | null {
    const existing = this.getRestockItemById(characterId, itemId);
    if (!existing) return null;

    const updated: RestockItem = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    this.restockItems.set(itemId, updated);
    this.syncToStorage();
    return updated;
  }

  public deleteRestockItem(characterId: number, itemId: string): boolean {
    const existing = this.getRestockItemById(characterId, itemId);
    if (!existing) return false;
    const deleted = this.restockItems.delete(itemId);
    if (deleted) {
      this.syncToStorage();
    }
    return deleted;
  }

  public clearCharacter(characterId: number): void {
    for (const [key, order] of this.orders.entries()) {
      if (order.characterId === characterId) {
        this.orders.delete(key);
      }
    }
    for (const [key, item] of this.restockItems.entries()) {
      if (item.characterId === characterId) {
        this.restockItems.delete(key);
      }
    }
    this.syncToStorage();
  }

  public dumpData(): { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] } {
    return {
      snapshots: Array.from(this.orders.values()),
      restockItems: Array.from(this.restockItems.values()),
    };
  }

  public restoreData(
    data: { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] },
    sync = true
  ): void {
    this.orders.clear();
    this.restockItems.clear();
    for (const snap of data.snapshots) {
      this.orders.set(this.makeOrderKey(snap.characterId, snap.orderId), snap);
    }
    for (const item of data.restockItems) {
      this.restockItems.set(item.id, item);
    }
    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemoryOrdersRepository extends PersistentOrdersRepository {}

/**
 * PostgreSQL implementation of Orders Repository with parameterized SQL queries,
 * transactions and B-Tree indexed access.
 */
export class PostgresOrdersRepository implements IOrdersRepository {
  constructor(private adapter: IDatabaseAdapter) {}

  private mapRowToOrder(row: Record<string, unknown>): CharacterOrderSnapshot {
    const charId = Number(row.character_id);
    const orderId = Number(row.order_id);
    const issued = String(row.issued);
    const duration = Number(row.duration);
    const expiresAt = new Date(new Date(issued).getTime() + duration * 86400000).toISOString();

    return {
      id: `${charId}:${orderId}`,
      characterId: charId,
      orderId: orderId,
      typeId: Number(row.type_id),
      typeName: row.type_name ? String(row.type_name) : undefined,
      regionId: Number(row.region_id),
      locationId: Number(row.location_id),
      locationName: row.location_name ? String(row.location_name) : undefined,
      price: Number(row.price),
      volumeTotal: Number(row.volume_total),
      volumeRemain: Number(row.volume_remain),
      volumeFilled: Number(row.volume_filled),
      isBuyOrder: Boolean(row.is_buy_order),
      duration: duration,
      expiresAt,
      escrow: row.escrow !== null && row.escrow !== undefined ? Number(row.escrow) : undefined,
      issued,
      minVolume: row.min_volume !== null && row.min_volume !== undefined ? Number(row.min_volume) : undefined,
      state: row.state as CharacterOrderSnapshot['state'],
      stateJustification: row.state_justification ? String(row.state_justification) : '',
      isActiveInCurrentSnapshot: Boolean(row.is_active_in_current_snapshot),
      firstObservedAt: Number(row.first_observed_at),
      lastObservedAt: Number(row.last_observed_at),
      lastSnapshotVolumeRemain: row.last_snapshot_volume_remain !== null && row.last_snapshot_volume_remain !== undefined ? Number(row.last_snapshot_volume_remain) : Number(row.volume_remain),
      inStockQuantity: row.in_stock_quantity !== null && row.in_stock_quantity !== undefined ? Number(row.in_stock_quantity) : undefined,
      source: `esi:/characters/${charId}/orders/`,
    };
  }

  private mapRowToRestock(row: Record<string, unknown>): RestockItem {
    return {
      id: String(row.id),
      characterId: Number(row.character_id),
      typeId: Number(row.type_id),
      typeName: String(row.type_name),
      targetBuyHubId: Number(row.target_buy_hub_id),
      targetBuyHubName: String(row.target_buy_hub_name),
      sellHubId: Number(row.sell_hub_id),
      sellHubName: String(row.sell_hub_name),
      suggestedQuantity: Number(row.suggested_quantity),
      targetQuantity: Number(row.target_quantity),
      estimatedBuyUnitPrice: row.estimated_buy_unit_price !== null && row.estimated_buy_unit_price !== undefined ? Number(row.estimated_buy_unit_price) : undefined,
      status: row.status as RestockItem['status'],
      justification: row.justification ? String(row.justification) : '',
      linkedOrderId: row.linked_order_id ? Number(row.linked_order_id) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public saveOrderSnapshots(snapshots: CharacterOrderSnapshot[]): { inserted: number; updated: number } {
    return this.saveOrderSnapshotsAsync(snapshots) as unknown as { inserted: number; updated: number };
  }

  public async saveOrderSnapshotsAsync(snapshots: CharacterOrderSnapshot[]): Promise<{ inserted: number; updated: number }> {
    if (snapshots.length === 0) return { inserted: 0, updated: 0 };

    return await this.adapter.transaction(async (tx) => {
      let inserted = 0;
      for (const item of snapshots) {
        const sql = `
          INSERT INTO order_snapshots (
            character_id, order_id, type_id, type_name, region_id,
            location_id, location_name, price, volume_total, volume_remain,
            volume_filled, is_buy_order, duration, escrow, issued,
            range, min_volume, state, state_justification,
            is_active_in_current_snapshot, first_observed_at, last_observed_at,
            last_snapshot_volume_remain, in_stock_quantity
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24
          )
          ON CONFLICT (character_id, order_id) DO UPDATE SET
            type_id = EXCLUDED.type_id,
            type_name = EXCLUDED.type_name,
            region_id = EXCLUDED.region_id,
            location_id = EXCLUDED.location_id,
            location_name = EXCLUDED.location_name,
            price = EXCLUDED.price,
            volume_total = EXCLUDED.volume_total,
            volume_remain = EXCLUDED.volume_remain,
            volume_filled = EXCLUDED.volume_filled,
            is_buy_order = EXCLUDED.is_buy_order,
            duration = EXCLUDED.duration,
            escrow = EXCLUDED.escrow,
            issued = EXCLUDED.issued,
            range = EXCLUDED.range,
            min_volume = EXCLUDED.min_volume,
            state = EXCLUDED.state,
            state_justification = EXCLUDED.state_justification,
            is_active_in_current_snapshot = EXCLUDED.is_active_in_current_snapshot,
            last_observed_at = EXCLUDED.last_observed_at,
            last_snapshot_volume_remain = EXCLUDED.last_snapshot_volume_remain,
            in_stock_quantity = EXCLUDED.in_stock_quantity
        `;
        const params = [
          item.characterId,
          item.orderId,
          item.typeId,
          item.typeName || null,
          item.regionId,
          item.locationId,
          item.locationName || null,
          item.price,
          item.volumeTotal,
          item.volumeRemain,
          item.volumeFilled,
          item.isBuyOrder,
          item.duration,
          item.escrow ?? null,
          item.issued,
          (item as unknown as { range?: string }).range || 'region',
          item.minVolume ?? null,
          item.state,
          item.stateJustification || null,
          item.isActiveInCurrentSnapshot,
          item.firstObservedAt || Date.now(),
          item.lastObservedAt || Date.now(),
          item.lastSnapshotVolumeRemain ?? null,
          item.inStockQuantity ?? null,
        ];
        await tx.execute(sql, params);
        inserted++;
      }
      return { inserted, updated: 0 };
    });
  }

  public getOrders(filters: OrderQueryFilters): {
    items: CharacterOrderSnapshot[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    return this.getOrdersAsync(filters) as unknown as {
      items: CharacterOrderSnapshot[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }

  public async getOrdersAsync(filters: OrderQueryFilters): Promise<{
    items: CharacterOrderSnapshot[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const {
      characterId,
      state,
      isBuyOrder,
      locationId,
      typeId,
      search,
      sortBy = 'issued',
      sortOrder = 'desc',
      page = 1,
      pageSize = 50,
    } = filters;

    const conditions: string[] = ['character_id = $1'];
    const params: unknown[] = [characterId];
    let paramIndex = 2;

    if (state && state !== 'ALL') {
      if (state === 'ACTIVE_ALL') {
        conditions.push("state IN ('ACTIVE', 'PARTIALLY_FILLED')");
      } else {
        conditions.push(`state = $${paramIndex++}`);
        params.push(state);
      }
    }

    if (isBuyOrder !== undefined) {
      conditions.push(`is_buy_order = $${paramIndex++}`);
      params.push(isBuyOrder);
    }
    if (typeId !== undefined) {
      conditions.push(`type_id = $${paramIndex++}`);
      params.push(typeId);
    }
    if (locationId !== undefined) {
      conditions.push(`location_id = $${paramIndex++}`);
      params.push(locationId);
    }
    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(COALESCE(type_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(location_name, '')) LIKE $${paramIndex} OR
        CAST(order_id AS TEXT) LIKE $${paramIndex}
      )`);
      params.push(s);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await this.adapter.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM order_snapshots WHERE ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.count || 0);

    const sortColMap: Record<string, string> = {
      issued: 'issued',
      lastObservedAt: 'last_observed_at',
      volumeFilled: 'volume_filled',
      price: 'price',
      typeName: 'type_name',
      state: 'state',
    };
    const col = sortColMap[sortBy] || 'issued';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;

    const dataSql = `
      SELECT * FROM order_snapshots
      WHERE ${whereClause}
      ORDER BY ${col} ${direction}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataRes = await this.adapter.query(dataSql, [...params, validPageSize, offset]);
    const items = dataRes.rows.map((r) => this.mapRowToOrder(r));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));

    return { items, total, page: validPage, pageSize: validPageSize, totalPages };
  }

  public getOrderById(characterId: number, orderId: number): CharacterOrderSnapshot | null {
    return this.getOrderByIdAsync(characterId, orderId) as unknown as (CharacterOrderSnapshot | null);
  }

  public async getOrderByIdAsync(characterId: number, orderId: number): Promise<CharacterOrderSnapshot | null> {
    const res = await this.adapter.query(
      'SELECT * FROM order_snapshots WHERE character_id = $1 AND order_id = $2',
      [characterId, orderId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToOrder(res.rows[0]);
  }

  public getOrdersForCharacter(characterId: number): CharacterOrderSnapshot[] {
    return this.getOrdersForCharacterAsync(characterId) as unknown as CharacterOrderSnapshot[];
  }

  public async getOrdersForCharacterAsync(characterId: number): Promise<CharacterOrderSnapshot[]> {
    const res = await this.adapter.query(
      'SELECT * FROM order_snapshots WHERE character_id = $1',
      [characterId]
    );
    return res.rows.map((r) => this.mapRowToOrder(r));
  }

  public getSummary(characterId: number): OrderSummaryMetrics {
    return this.getSummaryAsync(characterId) as unknown as OrderSummaryMetrics;
  }

  public async getSummaryAsync(characterId: number): Promise<OrderSummaryMetrics> {
    const sql = `
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN state = 'ACTIVE' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN state = 'PARTIALLY_FILLED' THEN 1 ELSE 0 END) as partial_count,
        SUM(CASE WHEN state = 'COMPLETED_CONFIRMED' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN state = 'CANCELLED_CONFIRMED' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(CASE WHEN state = 'EXPIRED_CONFIRMED' THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN state = 'DISAPPEARED_UNCONFIRMED' THEN 1 ELSE 0 END) as disappeared_count,
        SUM(CASE WHEN state IN ('ACTIVE', 'PARTIALLY_FILLED') THEN price * volume_remain ELSE 0 END) as total_active_isk,
        SUM(CASE WHEN state IN ('ACTIVE', 'PARTIALLY_FILLED') AND is_buy_order THEN COALESCE(escrow, 0) ELSE 0 END) as total_active_escrow
      FROM order_snapshots
      WHERE character_id = $1
    `;
    const res = await this.adapter.query(sql, [characterId]);
    const row = res.rows[0] || {};

    return {
      characterId,
      asOf: Date.now(),
      totalOrdersTracked: Number(row.total_orders || 0),
      activeOrdersCount: Number(row.active_count || 0),
      partiallyFilledCount: Number(row.partial_count || 0),
      completedCount: Number(row.completed_count || 0),
      cancelledCount: Number(row.cancelled_count || 0),
      expiredCount: Number(row.expired_count || 0),
      disappearedCount: Number(row.disappeared_count || 0),
      totalActiveIskValue: Number(row.total_active_isk || 0),
      totalActiveEscrowIsk: Number(row.total_active_escrow || 0),
    };
  }

  public markMissingOrdersAsDisappeared(
    characterId: number,
    currentActiveOrderIds: Set<number>,
    observedAt: number
  ): number {
    return this.markMissingOrdersAsDisappearedAsync(characterId, currentActiveOrderIds, observedAt) as unknown as number;
  }

  public async markMissingOrdersAsDisappearedAsync(
    characterId: number,
    currentActiveOrderIds: Set<number>,
    observedAt: number
  ): Promise<number> {
    const activeIds = Array.from(currentActiveOrderIds);
    let sql = `
      UPDATE order_snapshots
      SET
        is_active_in_current_snapshot = FALSE,
        last_observed_at = $1,
        state = CASE WHEN state IN ('ACTIVE', 'PARTIALLY_FILLED') THEN 'DISAPPEARED_UNCONFIRMED' ELSE state END,
        state_justification = CASE WHEN state IN ('ACTIVE', 'PARTIALLY_FILLED')
          THEN 'Ordre disparu du snapshot actif sans confirmation ESI d''historique (vente complète, expiration ou annulation à confirmer).'
          ELSE state_justification END
      WHERE character_id = $2 AND is_active_in_current_snapshot = TRUE
    `;
    const params: unknown[] = [observedAt, characterId];

    if (activeIds.length > 0) {
      sql += ' AND order_id != ALL($3)';
      params.push(activeIds);
    }

    return await this.adapter.execute(sql, params);
  }

  public getRestockItems(characterId: number): RestockItem[] {
    return this.getRestockItemsAsync(characterId) as unknown as RestockItem[];
  }

  public async getRestockItemsAsync(characterId: number): Promise<RestockItem[]> {
    const res = await this.adapter.query(
      'SELECT * FROM restock_items WHERE character_id = $1 ORDER BY created_at DESC',
      [characterId]
    );
    return res.rows.map((r) => this.mapRowToRestock(r));
  }

  public getRestockItemById(characterId: number, itemId: string): RestockItem | null {
    return this.getRestockItemByIdAsync(characterId, itemId) as unknown as (RestockItem | null);
  }

  public async getRestockItemByIdAsync(characterId: number, itemId: string): Promise<RestockItem | null> {
    const res = await this.adapter.query(
      'SELECT * FROM restock_items WHERE character_id = $1 AND id = $2',
      [characterId, itemId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToRestock(res.rows[0]);
  }

  public createRestockItem(dto: CreateRestockItemDto): RestockItem {
    return this.createRestockItemAsync(dto) as unknown as RestockItem;
  }

  public async createRestockItemAsync(dto: CreateRestockItemDto): Promise<RestockItem> {
    const id = `${dto.characterId}:${dto.typeId}:${dto.sellHubId}:${Date.now()}`;
    const now = Date.now();
    const item: RestockItem = {
      id,
      characterId: dto.characterId,
      typeId: dto.typeId,
      typeName: dto.typeName || `Type #${dto.typeId}`,
      targetBuyHubId: dto.targetBuyHubId,
      targetBuyHubName: dto.targetBuyHubName || `Hub #${dto.targetBuyHubId}`,
      sellHubId: dto.sellHubId,
      sellHubName: dto.sellHubName || `Hub #${dto.sellHubId}`,
      suggestedQuantity: dto.suggestedQuantity,
      targetQuantity: dto.targetQuantity,
      estimatedBuyUnitPrice: dto.estimatedBuyUnitPrice,
      status: 'SUGGESTED',
      justification: dto.justification,
      linkedOrderId: dto.linkedOrderId,
      notes: dto.notes,
      createdAt: now,
      updatedAt: now,
    };

    const sql = `
      INSERT INTO restock_items (
        id, character_id, type_id, type_name, target_buy_hub_id,
        target_buy_hub_name, sell_hub_id, sell_hub_name, suggested_quantity,
        target_quantity, estimated_buy_unit_price, status, justification,
        linked_order_id, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
    `;
    const params = [
      item.id,
      item.characterId,
      item.typeId,
      item.typeName,
      item.targetBuyHubId,
      item.targetBuyHubName,
      item.sellHubId,
      item.sellHubName,
      item.suggestedQuantity,
      item.targetQuantity,
      item.estimatedBuyUnitPrice,
      item.status,
      item.justification || null,
      item.linkedOrderId || null,
      item.notes || null,
      item.createdAt,
      item.updatedAt,
    ];
    await this.adapter.execute(sql, params);
    return item;
  }

  public updateRestockItem(
    characterId: number,
    itemId: string,
    updates: UpdateRestockItemDto
  ): RestockItem | null {
    return this.updateRestockItemAsync(characterId, itemId, updates) as unknown as (RestockItem | null);
  }

  public async updateRestockItemAsync(
    characterId: number,
    itemId: string,
    updates: UpdateRestockItemDto
  ): Promise<RestockItem | null> {
    const existing = await this.getRestockItemByIdAsync(characterId, itemId);
    if (!existing) return null;

    const merged: RestockItem = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const sql = `
      UPDATE restock_items
      SET
        target_quantity = $1,
        suggested_quantity = $2,
        estimated_buy_unit_price = $3,
        status = $4,
        justification = $5,
        notes = $6,
        updated_at = $7
      WHERE character_id = $8 AND id = $9
    `;
    await this.adapter.execute(sql, [
      merged.targetQuantity,
      merged.suggestedQuantity,
      merged.estimatedBuyUnitPrice,
      merged.status,
      merged.justification || null,
      merged.notes || null,
      merged.updatedAt,
      characterId,
      itemId,
    ]);
    return merged;
  }

  public deleteRestockItem(characterId: number, itemId: string): boolean {
    return this.deleteRestockItemAsync(characterId, itemId) as unknown as boolean;
  }

  public async deleteRestockItemAsync(characterId: number, itemId: string): Promise<boolean> {
    const res = await this.adapter.execute(
      'DELETE FROM restock_items WHERE character_id = $1 AND id = $2',
      [characterId, itemId]
    );
    return res > 0;
  }

  public clearCharacter(characterId: number): void {
    this.clearCharacterAsync(characterId).catch(() => {});
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    await this.adapter.execute('DELETE FROM order_snapshots WHERE character_id = $1', [characterId]);
    await this.adapter.execute('DELETE FROM restock_items WHERE character_id = $1', [characterId]);
  }

  public dumpData(): { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] } {
    return this.dumpDataAsync() as unknown as { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] };
  }

  public async dumpDataAsync(): Promise<{ snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] }> {
    const snapRes = await this.adapter.query('SELECT * FROM order_snapshots');
    const restockRes = await this.adapter.query('SELECT * FROM restock_items');
    return {
      snapshots: snapRes.rows.map((r) => this.mapRowToOrder(r)),
      restockItems: restockRes.rows.map((r) => this.mapRowToRestock(r)),
    };
  }

  public restoreData(data: { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] }): void {
    this.restoreDataAsync(data).catch(() => {});
  }

  public async restoreDataAsync(data: { snapshots: CharacterOrderSnapshot[]; restockItems: RestockItem[] }): Promise<void> {
    await this.saveOrderSnapshotsAsync(data.snapshots);
    for (const r of data.restockItems) {
      await this.createRestockItemAsync({
        characterId: r.characterId,
        typeId: r.typeId,
        typeName: r.typeName,
        targetBuyHubId: r.targetBuyHubId,
        targetBuyHubName: r.targetBuyHubName,
        sellHubId: r.sellHubId,
        sellHubName: r.sellHubName,
        suggestedQuantity: r.suggestedQuantity,
        targetQuantity: r.targetQuantity,
        estimatedBuyUnitPrice: r.estimatedBuyUnitPrice,
        justification: r.justification,
        linkedOrderId: r.linkedOrderId,
        notes: r.notes,
      });
    }
  }
}

export const defaultOrdersRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresOrdersRepository(StorageManager.getInstance().getAdapter())
  : new PersistentOrdersRepository(StorageManager.getInstance().getAdapter());
export const ordersRepository = defaultOrdersRepository;
