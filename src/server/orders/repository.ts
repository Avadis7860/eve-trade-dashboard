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
export const defaultOrdersRepository = new PersistentOrdersRepository(StorageManager.getInstance().getAdapter());
export const ordersRepository = defaultOrdersRepository;
