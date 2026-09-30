import type { IOrdersRepository } from './repository.ts';
import { defaultOrdersRepository } from './repository.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { UniverseService } from '../universe/service.ts';
import { defaultUniverseService } from '../universe/service.ts';
import type { AssetsService } from '../assets/service.ts';
import { defaultAssetsService } from '../assets/service.ts';
import type {
  CharacterOrderSnapshot,
  OrderQueryFilters,
  OrderSummaryMetrics,
  RestockItem,
  CreateRestockItemDto,
  UpdateRestockItemDto,
} from './types.ts';

export interface OrderDetailResult {
  order: CharacterOrderSnapshot;
  relatedTransactionsCount: number;
  recentTransactionsVolume: number;
  inStockQuantity?: number;
}

export class OrdersService {
  private repo: IOrdersRepository;
  private ledgerRepo: ILedgerRepository;
  private universeService: UniverseService;
  private assetsService: AssetsService;

  constructor(
    repo: IOrdersRepository = defaultOrdersRepository,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    universeService: UniverseService = defaultUniverseService,
    assetsService: AssetsService = defaultAssetsService
  ) {
    this.repo = repo;
    this.ledgerRepo = ledgerRepo;
    this.universeService = universeService;
    this.assetsService = assetsService;
  }

  public getOrders(characterId: number, filters: Partial<OrderQueryFilters>) {
    const fullFilters: OrderQueryFilters = {
      characterId,
      state: filters.state || 'ALL',
      isBuyOrder: filters.isBuyOrder,
      locationId: filters.locationId !== undefined ? Number(filters.locationId) : undefined,
      typeId: filters.typeId !== undefined ? Number(filters.typeId) : undefined,
      search: filters.search,
      sortBy: filters.sortBy || 'issued',
      sortOrder: filters.sortOrder || 'desc',
      page: filters.page ? Number(filters.page) : 1,
      pageSize: filters.pageSize ? Number(filters.pageSize) : 50,
    };

    const result = this.repo.getOrders(fullFilters);
    const enrichedItems = result.items.map((order) => {
      const inStockQuantity = this.assetsService.getStockForType(order.typeId, order.locationId, [characterId]);
      return {
        ...order,
        inStockQuantity,
      };
    });

    return {
      ...result,
      items: enrichedItems,
    };
  }

  public getOrderDetail(characterId: number, orderId: number): OrderDetailResult | null {
    const rawOrder = this.repo.getOrderById(characterId, orderId);
    if (!rawOrder) return null;

    const inStockQuantity = this.assetsService.getStockForType(rawOrder.typeId, rawOrder.locationId, [characterId]);
    const order: CharacterOrderSnapshot = {
      ...rawOrder,
      inStockQuantity,
    };

    // Check transactions for the same type & location
    const txList = this.ledgerRepo.getTransactions({
      characterId,
      typeId: order.typeId,
      locationId: order.locationId,
      pageSize: 500,
    });

    let recentTransactionsVolume = 0;
    for (const tx of txList.items) {
      if (tx.isBuy === order.isBuyOrder) {
        recentTransactionsVolume += tx.quantity;
      }
    }

    return {
      order,
      relatedTransactionsCount: txList.items.length,
      recentTransactionsVolume,
      inStockQuantity,
    };
  }

  public getSummary(characterId: number): OrderSummaryMetrics {
    return this.repo.getSummary(characterId);
  }

  // --- Restock Suggestions & List Management ---

  public getRestockItems(characterId: number): RestockItem[] {
    return this.repo.getRestockItems(characterId);
  }

  /**
   * Generates restock suggestions based on sell orders that are completed,
   * partially filled (>50%), or disappeared
   */
  public generateRestockSuggestions(characterId: number): { generated: number; items: RestockItem[] } {
    const orders = this.repo.getOrdersForCharacter(characterId);
    const existingItems = this.repo.getRestockItems(characterId);
    const existingTypeHubSet = new Set(
      existingItems.map((item) => `${item.typeId}:${item.sellHubId}`)
    );

    const created: RestockItem[] = [];

    // Major default source hub: Jita 4-4 (60003760)
    const DEFAULT_BUY_HUB_ID = 60003760;
    const DEFAULT_BUY_HUB_NAME = this.universeService.getNameSync(DEFAULT_BUY_HUB_ID, 'Station');

    for (const order of orders) {
      // Only consider sell orders (isBuyOrder === false)
      if (order.isBuyOrder) continue;

      const needsRestock =
        order.state === 'COMPLETED_CONFIRMED' ||
        order.state === 'DISAPPEARED_UNCONFIRMED' ||
        (order.state === 'PARTIALLY_FILLED' && order.volumeRemain <= order.volumeTotal * 0.3);

      if (needsRestock) {
        const key = `${order.typeId}:${order.locationId}`;
        if (!existingTypeHubSet.has(key)) {
          let justification = `Ordre de vente #${order.orderId} complété`;
          let suggestedQty = order.volumeTotal;

          if (order.state === 'PARTIALLY_FILLED') {
            justification = `Stock faible sur l'ordre #${order.orderId} (${order.volumeRemain}/${order.volumeTotal} restants)`;
            suggestedQty = order.volumeFilled || Math.ceil(order.volumeTotal * 0.7);
          } else if (order.state === 'DISAPPEARED_UNCONFIRMED') {
            justification = `Ordre #${order.orderId} disparu du marché`;
            suggestedQty = order.volumeTotal;
          }

          const item = this.repo.createRestockItem({
            characterId,
            typeId: order.typeId,
            typeName: order.typeName,
            targetBuyHubId: DEFAULT_BUY_HUB_ID,
            targetBuyHubName: DEFAULT_BUY_HUB_NAME,
            sellHubId: order.locationId,
            sellHubName: order.locationName,
            suggestedQuantity: suggestedQty,
            targetQuantity: suggestedQty,
            justification,
            linkedOrderId: order.orderId,
            notes: 'Suggestion générée à partir du cycle des ordres',
          });

          existingTypeHubSet.add(key);
          created.push(item);
        }
      }
    }

    return { generated: created.length, items: this.repo.getRestockItems(characterId) };
  }

  public createRestockItem(characterId: number, dto: CreateRestockItemDto): RestockItem {
    return this.repo.createRestockItem({ ...dto, characterId });
  }

  public updateRestockItem(
    characterId: number,
    itemId: string,
    updates: UpdateRestockItemDto
  ): RestockItem | null {
    return this.repo.updateRestockItem(characterId, itemId, updates);
  }

  public deleteRestockItem(characterId: number, itemId: string): boolean {
    return this.repo.deleteRestockItem(characterId, itemId);
  }
}

export const defaultOrdersService = new OrdersService();
