import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { RoiRepository, roiRepository as defaultRoiRepository } from '../roi/repository.ts';
import { HubsService, hubsService as defaultHubsService } from '../hubs/service.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { roundIsk } from '../roi/calculator.ts';
import type {
  PhysicalStockClassification,
  CostBasisStatus,
  PhysicalStockPosition,
  MonetaryCapitalSummary,
  PhysicalSummaryMetrics,
  DormantSummaryMetrics,
  CapitalSummaryResponse,
  CapitalBreakdownFilters,
  CapitalBreakdownResponse,
} from './types.ts';

const IN_TRANSIT_FLAGS = new Set([
  'cargohold',
  'fleethangar',
  'specializedfuelbay',
  'specializedorehold',
  'specializedgashold',
  'specializedmineralhold',
  'specializedshiphold',
  'specializedammohold',
  'deliveries',
  'secondarystorage',
  'structureactive',
]);

export class CapitalService {
  constructor(
    private assetsRepo: IAssetsRepository = defaultAssetsRepository,
    private ordersRepo: IOrdersRepository = defaultOrdersRepository,
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private roiRepo: RoiRepository = defaultRoiRepository,
    private hubsService: HubsService = defaultHubsService,
    private universeService: UniverseService = defaultUniverseService
  ) {}

  /**
   * Identifies whether an asset is currently in-transit based on location type and flag
   */
  private isInTransit(locationType: string, locationFlag: string): boolean {
    const normFlag = (locationFlag || '').toLowerCase();
    const normType = (locationType || '').toLowerCase();

    if (IN_TRANSIT_FLAGS.has(normFlag)) return true;
    if (normType === 'solar_system') return true;
    return false;
  }

  /**
   * Builds the consolidated list of physical stock positions with mutually exclusive decomposition
   */
  public getPositions(
    characterId?: number,
    characterIds?: number[]
  ): PhysicalStockPosition[] {
    const rawAssets = this.assetsRepo.getAllAssets(characterId, characterIds);
    const effectiveCharIds = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : Array.from(new Set(rawAssets.map((a) => a.characterId)));

    // Load active orders and unsold inventory lots in bulk
    const activeSellOrdersByCharTypeLoc = new Map<string, { totalRemain: number; notionalValue: number; count: number }>();
    for (const charId of effectiveCharIds) {
      const orders = this.ordersRepo.getOrdersForCharacter(charId);
      for (const order of orders) {
        if (!order.isBuyOrder && (order.state === 'ACTIVE' || order.state === 'PARTIALLY_FILLED')) {
          const key = `${charId}:${order.typeId}:${order.locationId}`;
          const current = activeSellOrdersByCharTypeLoc.get(key) || { totalRemain: 0, notionalValue: 0, count: 0 };
          current.totalRemain += order.volumeRemain;
          current.notionalValue += roundIsk(order.price * order.volumeRemain);
          current.count += 1;
          activeSellOrdersByCharTypeLoc.set(key, current);
        }
      }
    }

    // Load transactions to determine inactivity and dormancy
    const allTxs = this.ledgerRepo.getAllTransactions(characterId, characterIds);
    const lastActivityByCharTypeLoc = new Map<string, number>();
    for (const tx of allTxs) {
      const key = `${tx.characterId}:${tx.typeId}:${tx.locationId}`;
      const txTime = new Date(tx.date).getTime();
      const existing = lastActivityByCharTypeLoc.get(key) || 0;
      if (txTime > existing) {
        lastActivityByCharTypeLoc.set(key, txTime);
      }
    }

    // Group raw assets by characterId + typeId + locationId + inTransit
    const assetGroups = new Map<string, {
      characterId: number;
      typeId: number;
      typeName: string;
      locationId: number;
      locationName: string;
      locationType: string;
      locationFlag: string;
      totalQuantity: number;
      inTransit: boolean;
    }>();

    for (const asset of rawAssets) {
      const inTransit = this.isInTransit(asset.locationType, asset.locationFlag);
      const groupKey = `${asset.characterId}:${asset.typeId}:${asset.locationId}:${inTransit ? 'transit' : 'station'}`;
      const typeName = asset.typeName || this.universeService.getNameSync(asset.typeId, 'Item');
      const locationName = asset.locationName || this.universeService.getNameSync(asset.locationId, 'Station');

      const existing = assetGroups.get(groupKey);
      if (existing) {
        existing.totalQuantity += asset.quantity;
      } else {
        assetGroups.set(groupKey, {
          characterId: asset.characterId,
          typeId: asset.typeId,
          typeName,
          locationId: asset.locationId,
          locationName,
          locationType: asset.locationType,
          locationFlag: asset.locationFlag,
          totalQuantity: asset.quantity,
          inTransit,
        });
      }
    }

    // Load inventory lots for cost resolution
    const inventoryLots = this.roiRepo.getInventoryLots(characterId, characterIds);
    const costMapByType = new Map<number, { remainingQty: number; remainingCost: number }>();
    for (const lot of inventoryLots) {
      const current = costMapByType.get(lot.type_id) || { remainingQty: 0, remainingCost: 0 };
      current.remainingQty += lot.remaining_quantity;
      current.remainingCost += lot.remaining_cost_isk + lot.remaining_buy_fees_isk;
      costMapByType.set(lot.type_id, current);
    }

    const positions: PhysicalStockPosition[] = [];
    const now = Date.now();

    for (const group of assetGroups.values()) {
      const {
        characterId: charId,
        typeId,
        typeName,
        locationId,
        locationName,
        locationType,
        locationFlag,
        totalQuantity,
        inTransit,
      } = group;

      const hubResolution = this.hubsService.resolveLocationToHub(locationId, locationName);
      const isConfiguredHub = hubResolution.hub_id !== 'UNKNOWN_HUB';

      let committedSellOrderQuantity = 0;
      let freeHubStockQuantity = 0;
      let remoteDormantStockQuantity = 0;
      let inTransitQuantity = 0;
      let activeSellOrdersCount = 0;
      let sellOrderNotionalValueIsk = 0;

      if (inTransit) {
        inTransitQuantity = totalQuantity;
      } else {
        const orderKey = `${charId}:${typeId}:${locationId}`;
        const orderData = activeSellOrdersByCharTypeLoc.get(orderKey);

        if (orderData) {
          activeSellOrdersCount = orderData.count;
          sellOrderNotionalValueIsk = orderData.notionalValue;
          committedSellOrderQuantity = Math.min(totalQuantity, orderData.totalRemain);
        }

        const uncommitted = Math.max(0, totalQuantity - committedSellOrderQuantity);

        if (isConfiguredHub) {
          freeHubStockQuantity = uncommitted;
        } else {
          remoteDormantStockQuantity = uncommitted;
        }
      }

      // Check dormancy & inactivity
      const actKey = `${charId}:${typeId}:${locationId}`;
      const lastActivity = lastActivityByCharTypeLoc.get(actKey);
      const daysInactive = lastActivity
        ? Math.max(0, Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24)))
        : 999;
      const isDormant = (!isConfiguredHub && remoteDormantStockQuantity > 0) || daysInactive >= 30;

      // Valuation basis
      const costData = costMapByType.get(typeId);
      let unitCostIsk: number | null = null;
      let costBasisStatus: CostBasisStatus = 'UNKNOWN';
      let totalCostBasisIsk: number | null = null;

      if (costData && costData.remainingQty > 0) {
        unitCostIsk = roundIsk(costData.remainingCost / costData.remainingQty);
        costBasisStatus = 'KNOWN';
        totalCostBasisIsk = roundIsk(unitCostIsk * totalQuantity);
      }

      // Determine primary classification
      let primaryClassification: PhysicalStockClassification = 'FREE_HUB_STOCK';
      if (inTransitQuantity > 0) {
        primaryClassification = 'IN_TRANSIT_STOCK';
      } else if (committedSellOrderQuantity >= totalQuantity) {
        primaryClassification = 'COMMITTED_SELL_ORDER';
      } else if (remoteDormantStockQuantity > 0) {
        primaryClassification = 'REMOTE_DORMANT_STOCK';
      } else if (costBasisStatus === 'UNKNOWN') {
        primaryClassification = 'UNRECONCILED_STOCK';
      } else {
        primaryClassification = 'FREE_HUB_STOCK';
      }

      // Arithmetic Invariance Proof
      const sumDecomposed =
        committedSellOrderQuantity +
        freeHubStockQuantity +
        remoteDormantStockQuantity +
        inTransitQuantity;
      const isSumExact = sumDecomposed === totalQuantity;

      positions.push({
        id: `${charId}:${typeId}:${locationId}:${inTransit ? 'transit' : 'station'}`,
        characterId: charId,
        typeId,
        typeName,
        locationId,
        locationName,
        locationType,
        locationFlag,
        hubId: hubResolution.hub_id,
        hubName: hubResolution.hub_name,
        isConfiguredHub,
        totalPhysicalQuantity: totalQuantity,
        committedSellOrderQuantity,
        freeHubStockQuantity,
        remoteDormantStockQuantity,
        inTransitQuantity,
        primaryClassification,
        daysInactive,
        isDormant,
        unitCostIsk,
        costBasisStatus,
        totalCostBasisIsk,
        activeSellOrdersCount,
        sellOrderNotionalValueIsk,
        decompositionProof: {
          totalPhysical: totalQuantity,
          committedSell: committedSellOrderQuantity,
          freeHub: freeHubStockQuantity,
          remoteDormant: remoteDormantStockQuantity,
          inTransit: inTransitQuantity,
          isSumExact,
        },
      });
    }

    return positions;
  }

  /**
   * Computes the monetary capital summary (mutually exclusive ISK categories)
   */
  public getMonetaryCapital(
    characterId?: number,
    characterIds?: number[]
  ): MonetaryCapitalSummary {
    const effectiveCharIds = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : [];

    // 1. Liquid Wallet Balance: Most recent balance from journal entries for each character
    let liquidWalletBalanceIsk = 0;
    const targetCharIds = effectiveCharIds.length > 0
      ? effectiveCharIds
      : Array.from(new Set(this.ledgerRepo.getAllTransactions().map((t) => t.characterId)));

    for (const charId of targetCharIds) {
      const { items: journalItems } = this.ledgerRepo.getJournalEntries(charId, 1, 100);
      const latestWithBalance = journalItems.find((j) => j.balance !== undefined && j.balance !== null);
      if (latestWithBalance && latestWithBalance.balance !== undefined) {
        liquidWalletBalanceIsk += latestWithBalance.balance;
      }
    }
    liquidWalletBalanceIsk = roundIsk(liquidWalletBalanceIsk);

    // 2. Market Buy Escrow & 4. Notional Market Ask Value
    let marketBuyEscrowIsk = 0;
    let notionalMarketAskValueIsk = 0;

    for (const charId of targetCharIds) {
      const orders = this.ordersRepo.getOrdersForCharacter(charId);
      for (const order of orders) {
        if (order.state === 'ACTIVE' || order.state === 'PARTIALLY_FILLED') {
          if (order.isBuyOrder) {
            marketBuyEscrowIsk += (order.escrow || 0);
          } else {
            notionalMarketAskValueIsk += roundIsk(order.price * order.volumeRemain);
          }
        }
      }
    }
    marketBuyEscrowIsk = roundIsk(marketBuyEscrowIsk);
    notionalMarketAskValueIsk = roundIsk(notionalMarketAskValueIsk);

    // 3. Inventory Cost Value (Acquisition cost of unsold lots from Phase 08)
    const unsoldLots = this.roiRepo.getUnsoldInventory(characterId, characterIds);
    let inventoryCostValueIsk = 0;
    for (const lot of unsoldLots) {
      inventoryCostValueIsk += lot.tied_capital_isk + (lot.allocated_buy_fees_remaining || 0);
    }
    inventoryCostValueIsk = roundIsk(inventoryCostValueIsk);

    // Net Real Capital = Liquid cash + Buy Escrow + Unsold Inventory Cost
    const netRealCapitalIsk = roundIsk(
      liquidWalletBalanceIsk + marketBuyEscrowIsk + inventoryCostValueIsk
    );

    // Count physical stock units without cost basis
    const positions = this.getPositions(characterId, characterIds);
    let unreconciledStockUnitsCount = 0;
    for (const pos of positions) {
      if (pos.costBasisStatus === 'UNKNOWN') {
        unreconciledStockUnitsCount += pos.totalPhysicalQuantity;
      }
    }

    const unreconciledStockEstimatedValueStatus: CostBasisStatus =
      unreconciledStockUnitsCount === 0
        ? 'KNOWN'
        : inventoryCostValueIsk > 0
        ? 'PARTIAL'
        : 'UNKNOWN';

    return {
      liquidWalletBalanceIsk,
      marketBuyEscrowIsk,
      inventoryCostValueIsk,
      netRealCapitalIsk,
      notionalMarketAskValueIsk,
      unreconciledStockUnitsCount,
      unreconciledStockEstimatedValueStatus,
    };
  }

  /**
   * Returns a complete capital and inventory summary
   */
  public getCapitalSummary(
    characterId?: number,
    characterIds?: number[]
  ): CapitalSummaryResponse {
    const monetary = this.getMonetaryCapital(characterId, characterIds);
    const positions = this.getPositions(characterId, characterIds);

    const typeSet = new Set<number>();
    const locSet = new Set<number>();
    let totalUnits = 0;
    let committedSellOrderUnits = 0;
    let freeHubStockUnits = 0;
    let remoteDormantStockUnits = 0;
    let inTransitStockUnits = 0;
    let unreconciledCostUnits = 0;

    let dormantItemsCount = 0;
    let dormantTotalUnits = 0;
    let dormantCostValueIsk = 0;
    const dormantLocSet = new Set<number>();

    for (const pos of positions) {
      typeSet.add(pos.typeId);
      locSet.add(pos.locationId);
      totalUnits += pos.totalPhysicalQuantity;
      committedSellOrderUnits += pos.committedSellOrderQuantity;
      freeHubStockUnits += pos.freeHubStockQuantity;
      remoteDormantStockUnits += pos.remoteDormantStockQuantity;
      inTransitStockUnits += pos.inTransitQuantity;

      if (pos.costBasisStatus === 'UNKNOWN') {
        unreconciledCostUnits += pos.totalPhysicalQuantity;
      }

      if (pos.isDormant) {
        dormantItemsCount++;
        dormantTotalUnits += pos.totalPhysicalQuantity;
        if (pos.totalCostBasisIsk !== null) {
          dormantCostValueIsk += pos.totalCostBasisIsk;
        }
        dormantLocSet.add(pos.locationId);
      }
    }

    const charList = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : Array.from(new Set(positions.map((p) => p.characterId)));

    const physicalSummary: PhysicalSummaryMetrics = {
      totalItemsTracked: positions.length,
      distinctTypes: typeSet.size,
      distinctLocations: locSet.size,
      totalUnits,
      committedSellOrderUnits,
      freeHubStockUnits,
      remoteDormantStockUnits,
      inTransitStockUnits,
      unreconciledCostUnits,
    };

    const dormantSummary: DormantSummaryMetrics = {
      dormantItemsCount,
      dormantTotalUnits,
      dormantCostValueIsk: roundIsk(dormantCostValueIsk),
      dormantLocationsCount: dormantLocSet.size,
    };

    return {
      asOf: Date.now(),
      characterCount: charList.length,
      characterIds: charList,
      monetary,
      physicalSummary,
      dormantSummary,
    };
  }

  /**
   * Returns a filtered and paginated breakdown of physical stock positions
   */
  public getCapitalBreakdown(
    filters: CapitalBreakdownFilters
  ): CapitalBreakdownResponse {
    const {
      characterId,
      characterIds,
      hubId,
      typeId,
      classification,
      isDormantOnly,
      search,
      sortBy = 'typeName',
      sortOrder = 'asc',
      page = 1,
      pageSize = 50,
    } = filters;

    const summary = this.getCapitalSummary(characterId, characterIds);
    let positions = this.getPositions(characterId, characterIds);

    const searchLower = search ? search.trim().toLowerCase() : '';

    positions = positions.filter((pos) => {
      if (hubId && pos.hubId !== hubId) return false;
      if (typeId !== undefined && pos.typeId !== typeId) return false;
      if (classification && classification !== 'ALL' && pos.primaryClassification !== classification) {
        return false;
      }
      if (isDormantOnly && !pos.isDormant) return false;
      if (searchLower) {
        const matchName = pos.typeName.toLowerCase().includes(searchLower);
        const matchLoc = pos.locationName.toLowerCase().includes(searchLower);
        const matchHub = pos.hubName.toLowerCase().includes(searchLower);
        const matchType = String(pos.typeId).includes(searchLower);
        if (!matchName && !matchLoc && !matchHub && !matchType) return false;
      }
      return true;
    });

    positions.sort((a, b) => {
      let comp = 0;
      switch (sortBy) {
        case 'typeName':
          comp = a.typeName.localeCompare(b.typeName);
          break;
        case 'totalPhysicalQuantity':
          comp = a.totalPhysicalQuantity - b.totalPhysicalQuantity;
          break;
        case 'totalCostBasisIsk':
          comp = (a.totalCostBasisIsk || 0) - (b.totalCostBasisIsk || 0);
          break;
        case 'committedSellOrderQuantity':
          comp = a.committedSellOrderQuantity - b.committedSellOrderQuantity;
          break;
        case 'daysInactive':
          comp = a.daysInactive - b.daysInactive;
          break;
        default:
          comp = a.typeName.localeCompare(b.typeName);
      }
      return sortOrder === 'asc' ? comp : -comp;
    });

    const total = positions.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const offset = (validPage - 1) * validPageSize;
    const paginatedPositions = positions.slice(offset, offset + validPageSize);

    return {
      summary,
      positions: paginatedPositions,
      total,
      page: validPage,
      pageSize: validPageSize,
      totalPages,
    };
  }
}

export const capitalService = new CapitalService();
