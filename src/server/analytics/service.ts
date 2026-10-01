import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { RoiRepository, roiRepository as defaultRoiRepository } from '../roi/repository.ts';
import { HubsService, hubsService as defaultHubsService } from '../hubs/service.ts';
import { UniverseService, defaultUniverseService } from '../universe/service.ts';
import { CapitalService, capitalService as defaultCapitalService } from '../capital/service.ts';
import type { ISyncRepository } from '../sync/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import { roundIsk } from '../roi/calculator.ts';
import type {
  TimeframeOption,
  GroupByOption,
  Product360Response,
  Product360KPIs,
  Product360LocationBreakdown,
  Product360OpenOrder,
  Product360Transaction,
  ActivityTimeSeriesResponse,
  TimeSeriesDataPoint,
  LotAgeDistributionBracket,
  HubFlowSummary,
  AgeBracketId,
} from './types.ts';
import type { ExplicitCostAllocation, FormulaProof } from '../roi/types.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';

export interface AnalyticsQueryOptions {
  typeId?: number;
  timeframe?: TimeframeOption;
  groupBy?: GroupByOption;
  characterId?: number;
  characterIds?: number[];
  hubId?: string;
  now?: Date;
}

export class AnalyticsService {
  constructor(
    private ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    private ordersRepo: IOrdersRepository = defaultOrdersRepository,
    private roiRepo: RoiRepository = defaultRoiRepository,
    private hubsService: HubsService = defaultHubsService,
    private universeService: UniverseService = defaultUniverseService,
    private capitalService: CapitalService = defaultCapitalService,
    private syncRepo: ISyncRepository = defaultSyncRepository
  ) {}

  /**
   * Helper to parse timeframe into start date, end date and total days
   */
  private resolveTimeRange(
    timeframe: TimeframeOption = '90d',
    earliestTxDate?: string,
    now: Date = new Date()
  ): { startDate: Date; endDate: Date; daysCount: number } {
    const endDate = new Date(now);
    let daysCount = 90;

    switch (timeframe) {
      case '7d':
        daysCount = 7;
        break;
      case '14d':
        daysCount = 14;
        break;
      case '30d':
        daysCount = 30;
        break;
      case '90d':
        daysCount = 90;
        break;
      case '180d':
        daysCount = 180;
        break;
      case 'all': {
        if (earliestTxDate) {
          const earliest = new Date(earliestTxDate);
          const diffMs = endDate.getTime() - earliest.getTime();
          daysCount = Math.max(1, Math.ceil(diffMs / (24 * 3600 * 1000)));
        } else {
          daysCount = 90;
        }
        break;
      }
      default:
        daysCount = 90;
    }

    const startDate = new Date(endDate.getTime() - daysCount * 24 * 3600 * 1000);
    return { startDate, endDate, daysCount };
  }

  /**
   * Builds the comprehensive Product 360 view for a specific type_id
   */
  public async getProduct360(
    typeId: number,
    options: AnalyticsQueryOptions = {}
  ): Promise<Product360Response> {
    const timeframe: TimeframeOption = options.timeframe || '90d';
    const now = options.now || new Date();
    const characterId = options.characterId;
    const characterIds = options.characterIds;
    const hubFilter = options.hubId;

    // Resolve item name and category
    let typeName = `Type #${typeId}`;
    try {
      const resolved = await this.universeService.resolveNames([typeId]);
      if (resolved.get(typeId)) {
        typeName = resolved.get(typeId)!;
      }
    } catch {
      // Keep fallback
    }

    // 1. Fetch transactions for this item
    const allItemTxs = this.ledgerRepo.getTransactionsByTypeId
      ? this.ledgerRepo.getTransactionsByTypeId(typeId, characterId, characterIds)
      : this.ledgerRepo.getAllTransactions(characterId, characterIds).filter((tx) => tx.typeId === typeId);

    // Determine earliest date for "all" timeframe
    let earliestTxDate: string | undefined;
    for (const tx of allItemTxs) {
      if (!earliestTxDate || new Date(tx.date).getTime() < new Date(earliestTxDate).getTime()) {
        earliestTxDate = tx.date;
      }
    }

    const { startDate, endDate, daysCount } = this.resolveTimeRange(timeframe, earliestTxDate, now);

    // Filter transactions in timeframe & optional hub
    const periodTxs: CharacterTransaction[] = [];
    for (const tx of allItemTxs) {
      const txDate = new Date(tx.date);
      if (txDate >= startDate && txDate <= endDate) {
        if (hubFilter) {
          const hub = this.hubsService.resolveLocationToHub(tx.locationId, tx.locationName);
          if (hub.hub_id !== hubFilter) continue;
        }
        periodTxs.push(tx);
      }
    }

    // Sort transactions chronologically desc for table
    periodTxs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 2. Fetch all allocations and buy transactions for holding duration & FIFO details
    const allAllocations = this.roiRepo.listAllocations(characterId, characterIds);
    const itemAllocations = allAllocations.filter((a) => a.type_id === typeId);
    const itemAllocationsBySellTx = new Map<number, ExplicitCostAllocation[]>();
    for (const alloc of itemAllocations) {
      const current = itemAllocationsBySellTx.get(alloc.sell_transaction_id) || [];
      current.push(alloc);
      itemAllocationsBySellTx.set(alloc.sell_transaction_id, current);
    }

    // Buy transactions map for date resolution
    const buyTxsMap = new Map<number, CharacterTransaction>();
    for (const tx of allItemTxs) {
      if (tx.isBuy) {
        buyTxsMap.set(tx.transactionId, tx);
      }
    }

    // 3. Compute transaction details & KPI metrics
    let grossRevenueIsk = 0;
    let unitsSold = 0;
    let unitsBought = 0;
    let salesCount = 0;
    let buysCount = 0;
    let totalAllocatedCogsIsk = 0;
    let totalAllocatedSellFeesIsk = 0;
    let totalAllocatedProfitIsk = 0;
    let hasAtLeastOneReconciledSale = false;

    let weightedHoldingDaysSum = 0;
    let weightedAllocatedUnitsSum = 0;

    const formattedTxs: Product360Transaction[] = [];

    for (const tx of periodTxs) {
      const hub = this.hubsService.resolveLocationToHub(tx.locationId, tx.locationName);
      const txAmount = roundIsk(tx.quantity * tx.unitPrice);

      if (tx.isBuy) {
        unitsBought += tx.quantity;
        buysCount += 1;
        formattedTxs.push({
          transaction_id: tx.transactionId,
          character_id: tx.characterId,
          date: tx.date,
          is_buy: true,
          quantity: tx.quantity,
          unit_price: tx.unitPrice,
          total_amount_isk: txAmount,
          location_id: tx.locationId,
          location_name: tx.locationName || `Location #${tx.locationId}`,
          hub_id: hub.hub_id,
          hub_name: hub.hub_name,
          reconciliation_status: 'COMPLETE',
          allocated_buy_cost_isk: null,
          allocated_profit_ttc_isk: null,
          proof: null,
        });
      } else {
        unitsSold += tx.quantity;
        salesCount += 1;
        grossRevenueIsk += txAmount;

        const allocs = itemAllocationsBySellTx.get(tx.transactionId) || [];
        let allocatedUnitsForThisSale = 0;
        let saleAllocatedBuyCost = 0;
        let saleAllocatedBuyFees = 0;
        let saleAllocatedSellFees = 0;

        for (const alloc of allocs) {
          allocatedUnitsForThisSale += alloc.quantity_allocated;
          saleAllocatedBuyCost += alloc.allocated_buy_cost;
          saleAllocatedBuyFees += alloc.allocated_buy_fees;
          saleAllocatedSellFees += alloc.allocated_sell_fees;

          // Compute holding duration for this allocation
          let buyDateStr: string | undefined;
          if (alloc.buy_transaction_id) {
            const buyTx = buyTxsMap.get(alloc.buy_transaction_id);
            if (buyTx) {
              buyDateStr = buyTx.date;
            }
          } else if (alloc.opening_balance_id) {
            const ob = this.roiRepo.getOpeningBalance(alloc.opening_balance_id);
            if (ob) {
              buyDateStr = ob.acquisition_date;
            }
          }

          if (buyDateStr) {
            const sellTime = new Date(tx.date).getTime();
            const buyTime = new Date(buyDateStr).getTime();
            const daysDiff = Math.max(0, (sellTime - buyTime) / (24 * 3600 * 1000));
            weightedHoldingDaysSum += daysDiff * alloc.quantity_allocated;
            weightedAllocatedUnitsSum += alloc.quantity_allocated;
          }
        }

        let reconciliationStatus: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' = 'UNKNOWN';
        let saleProfitIsk: number | null = null;
        let saleProof: FormulaProof | null = null;

        if (allocatedUnitsForThisSale >= tx.quantity) {
          reconciliationStatus = 'COMPLETE';
        } else if (allocatedUnitsForThisSale > 0) {
          reconciliationStatus = 'PARTIAL';
        }

        if (reconciliationStatus !== 'UNKNOWN') {
          hasAtLeastOneReconciledSale = true;
          const ratio = tx.quantity > 0 ? allocatedUnitsForThisSale / tx.quantity : 1;
          const matchedGrossRevenue = roundIsk(txAmount * ratio);
          const totalAllocatedInvTtc = roundIsk(saleAllocatedBuyCost + saleAllocatedBuyFees);
          saleProfitIsk = roundIsk(matchedGrossRevenue - totalAllocatedInvTtc - saleAllocatedSellFees);

          totalAllocatedCogsIsk += totalAllocatedInvTtc;
          totalAllocatedSellFeesIsk += saleAllocatedSellFees;
          totalAllocatedProfitIsk += saleProfitIsk;

          const saleRoiPercent = totalAllocatedInvTtc > 0
            ? roundIsk((saleProfitIsk / totalAllocatedInvTtc) * 100)
            : null;

          saleProof = {
            as_of: new Date().toISOString(),
            gross_revenue_isk: matchedGrossRevenue,
            allocated_buy_cost_isk: roundIsk(saleAllocatedBuyCost),
            allocated_buy_fees_isk: roundIsk(saleAllocatedBuyFees),
            allocated_sell_fees_isk: roundIsk(saleAllocatedSellFees),
            total_investment_ttc_isk: totalAllocatedInvTtc,
            realized_profit_ttc_isk: saleProfitIsk,
            roi_percent_ttc: saleRoiPercent,
            formula_expression: `Profit TTC = CA alloué (${matchedGrossRevenue.toLocaleString()} ISK) - Inv TTC (${totalAllocatedInvTtc.toLocaleString()} ISK) - Taxes TTC (${saleAllocatedSellFees.toLocaleString()} ISK)`,
            numerator_isk: saleProfitIsk,
            denominator_isk: totalAllocatedInvTtc,
          };
        }

        formattedTxs.push({
          transaction_id: tx.transactionId,
          character_id: tx.characterId,
          date: tx.date,
          is_buy: false,
          quantity: tx.quantity,
          unit_price: tx.unitPrice,
          total_amount_isk: txAmount,
          location_id: tx.locationId,
          location_name: tx.locationName || `Location #${tx.locationId}`,
          hub_id: hub.hub_id,
          hub_name: hub.hub_name,
          reconciliation_status: reconciliationStatus,
          allocated_buy_cost_isk: reconciliationStatus !== 'UNKNOWN' ? roundIsk(saleAllocatedBuyCost + saleAllocatedBuyFees) : null,
          allocated_profit_ttc_isk: saleProfitIsk,
          proof: saleProof,
        });
      }
    }

    grossRevenueIsk = roundIsk(grossRevenueIsk);
    totalAllocatedCogsIsk = roundIsk(totalAllocatedCogsIsk);
    totalAllocatedSellFeesIsk = roundIsk(totalAllocatedSellFeesIsk);
    totalAllocatedProfitIsk = roundIsk(totalAllocatedProfitIsk);

    // Velocity V_jour = unitsSold / daysCount
    const velocityDaily = daysCount > 0 ? Number((unitsSold / daysCount).toFixed(2)) : 0;

    // Average holding duration D_detention
    const averageHoldingDays = weightedAllocatedUnitsSum > 0
      ? Number((weightedHoldingDaysSum / weightedAllocatedUnitsSum).toFixed(1))
      : null;

    const coverageRatioHoldingDays = unitsSold > 0
      ? Number(Math.min(1, weightedAllocatedUnitsSum / unitsSold).toFixed(3))
      : 1;

    // Realized Profit and ROI TTC
    const realizedProfitTtcIsk = hasAtLeastOneReconciledSale ? totalAllocatedProfitIsk : null;
    const roiPercentTtc = hasAtLeastOneReconciledSale && totalAllocatedCogsIsk > 0
      ? Number(((totalAllocatedProfitIsk / totalAllocatedCogsIsk) * 100).toFixed(2))
      : null;

    // Yield per capital-day: R_cap_jour = ROI_TTC / D_detention
    let yieldPerCapitalDayPercent: number | null = null;
    if (roiPercentTtc !== null && averageHoldingDays !== null && averageHoldingDays > 0) {
      yieldPerCapitalDayPercent = Number((roiPercentTtc / averageHoldingDays).toFixed(2));
    }

    // 4. Physical Stock and Location breakdown
    const physicalPositions = this.capitalService.getPositions(characterId, characterIds);
    const itemPositions = physicalPositions.filter((p) => p.typeId === typeId);

    let committedSellOrderQty = 0;
    let freeHubStockQty = 0;
    let remoteDormantStockQty = 0;
    let inTransitStockQty = 0;
    const unreconciledStockQty = 0;
    let totalPhysicalQuantity = 0;
    let totalCostIsk = 0;
    let totalNotionalSellIsk = 0;

    const locationsBreakdown: Product360LocationBreakdown[] = itemPositions.map((p) => {
      committedSellOrderQty += p.committedSellOrderQuantity;
      freeHubStockQty += p.freeHubStockQuantity;
      remoteDormantStockQty += p.remoteDormantStockQuantity;
      inTransitStockQty += p.inTransitQuantity;
      totalPhysicalQuantity += p.totalPhysicalQuantity;
      totalCostIsk += p.totalCostBasisIsk || 0;
      totalNotionalSellIsk += p.sellOrderNotionalValueIsk || 0;

      return {
        location_id: p.locationId,
        location_name: p.locationName,
        hub_id: p.hubId,
        hub_name: p.hubName,
        classification: p.primaryClassification,
        quantity: p.totalPhysicalQuantity,
        cost_basis_unit_isk: p.unitCostIsk,
        cost_basis_total_isk: p.totalCostBasisIsk,
        notional_unit_price_isk: p.committedSellOrderQuantity > 0 ? roundIsk(p.sellOrderNotionalValueIsk / p.committedSellOrderQuantity) : null,
        notional_total_isk: p.sellOrderNotionalValueIsk,
        days_inactive: p.daysInactive,
        is_dormant: p.isDormant,
      };
    });

    // 5. Open Market Orders for this item
    const effectiveCharIds = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : [];

    const activeItemOrders: CharacterOrderSnapshot[] = [];
    if (effectiveCharIds.length > 0) {
      for (const cId of effectiveCharIds) {
        const charOrders = this.ordersRepo.getOrdersForCharacter(cId);
        for (const o of charOrders) {
          if (o.typeId === typeId && (o.state === 'ACTIVE' || o.state === 'PARTIALLY_FILLED')) {
            activeItemOrders.push(o);
          }
        }
      }
    } else {
      const allSnapshots = this.ordersRepo.dumpData().snapshots;
      for (const o of allSnapshots) {
        if (o.typeId === typeId && (o.state === 'ACTIVE' || o.state === 'PARTIALLY_FILLED')) {
          activeItemOrders.push(o);
        }
      }
    }

    const openOrders: Product360OpenOrder[] = activeItemOrders.map((o) => {
      const hub = this.hubsService.resolveLocationToHub(o.locationId, o.locationName);
      const progressPercent = o.volumeTotal > 0
        ? Number((((o.volumeTotal - o.volumeRemain) / o.volumeTotal) * 100).toFixed(1))
        : 0;

      return {
        order_id: o.orderId,
        character_id: o.characterId,
        character_name: `Character #${o.characterId}`,
        is_buy_order: o.isBuyOrder,
        price: o.price,
        volume_remain: o.volumeRemain,
        volume_total: o.volumeTotal,
        location_id: o.locationId,
        location_name: o.locationName || `Location #${o.locationId}`,
        hub_id: hub.hub_id,
        hub_name: hub.hub_name,
        issued_at: o.issued,
        duration_days: o.duration,
        progress_percent: progressPercent,
        total_value_isk: roundIsk(o.price * o.volumeRemain),
        state: o.state,
      };
    });

    // 6. Timeseries for this item
    const timeseries = await this.getTimeSeries({
      typeId,
      timeframe,
      groupBy: 'day',
      characterId,
      characterIds,
      hubId: hubFilter,
      now,
    });

    const kpis: Product360KPIs = {
      gross_revenue_isk: grossRevenueIsk,
      cogs_allocated_isk: totalAllocatedCogsIsk,
      allocated_sell_fees_isk: totalAllocatedSellFeesIsk,
      realized_profit_ttc_isk: realizedProfitTtcIsk,
      roi_percent_ttc: roiPercentTtc,
      units_sold: unitsSold,
      units_bought: unitsBought,
      sales_transactions_count: salesCount,
      buy_transactions_count: buysCount,
      velocity_daily: velocityDaily,
      velocity_observation_days: daysCount,
      average_holding_days: averageHoldingDays,
      coverage_ratio_holding_days: coverageRatioHoldingDays,
      yield_per_capital_day_percent: yieldPerCapitalDayPercent,
      committed_capital_isk: roundIsk(totalCostIsk),
      stock_summary: {
        total_quantity: totalPhysicalQuantity,
        committed_sell_order_qty: committedSellOrderQty,
        free_hub_stock_qty: freeHubStockQty,
        remote_dormant_stock_qty: remoteDormantStockQty,
        in_transit_stock_qty: inTransitStockQty,
        unreconciled_stock_qty: unreconciledStockQty,
        total_cost_isk: roundIsk(totalCostIsk),
        total_notional_sell_isk: roundIsk(totalNotionalSellIsk),
      },
    };

    return {
      type_id: typeId,
      type_name: typeName,
      image_url: `https://images.evetech.net/types/${typeId}/icon?size=64`,
      as_of: new Date().toISOString(),
      timeframe,
      kpis,
      locations_breakdown: locationsBreakdown,
      open_orders: openOrders,
      transactions_history: formattedTxs,
      timeseries,
    };
  }

  /**
   * Builds time series data points, lot age distribution pyramid, and hub flow matrix
   */
  public async getTimeSeries(options: AnalyticsQueryOptions = {}): Promise<ActivityTimeSeriesResponse> {
    const timeframe: TimeframeOption = options.timeframe || '90d';
    const groupBy: GroupByOption = options.groupBy || 'day';
    const now = options.now || new Date();
    const typeId = options.typeId;
    const characterId = options.characterId;
    const characterIds = options.characterIds;
    const hubFilter = options.hubId;

    // Get transactions
    const itemTxs = typeId !== undefined
      ? (this.ledgerRepo.getTransactionsByTypeId
          ? this.ledgerRepo.getTransactionsByTypeId(typeId, characterId, characterIds)
          : this.ledgerRepo.getAllTransactions(characterId, characterIds).filter((tx) => tx.typeId === typeId))
      : this.ledgerRepo.getAllTransactions(characterId, characterIds);

    let earliestTxDate: string | undefined;
    for (const tx of itemTxs) {
      if (!earliestTxDate || new Date(tx.date).getTime() < new Date(earliestTxDate).getTime()) {
        earliestTxDate = tx.date;
      }
    }

    const { startDate, endDate, daysCount } = this.resolveTimeRange(timeframe, earliestTxDate, now);

    // Filter transactions by date and hub
    const filteredTxs: CharacterTransaction[] = [];
    for (const tx of itemTxs) {
      const txDate = new Date(tx.date);
      if (txDate >= startDate && txDate <= endDate) {
        if (hubFilter) {
          const hub = this.hubsService.resolveLocationToHub(tx.locationId, tx.locationName);
          if (hub.hub_id !== hubFilter) continue;
        }
        filteredTxs.push(tx);
      }
    }

    // Sort chronologically ascending
    filteredTxs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Load allocations
    const allAllocations = this.roiRepo.listAllocations(characterId, characterIds);
    const allocsBySellTx = new Map<number, ExplicitCostAllocation[]>();
    for (const alloc of allAllocations) {
      if (typeId !== undefined && alloc.type_id !== typeId) continue;
      const current = allocsBySellTx.get(alloc.sell_transaction_id) || [];
      current.push(alloc);
      allocsBySellTx.set(alloc.sell_transaction_id, current);
    }

    // Grouping helper
    const getPeriodKey = (date: Date): { key: string; start: string; end: string } => {
      if (groupBy === 'month') {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const key = `${year}-${month}`;
        const start = `${year}-${month}-01T00:00:00.000Z`;
        const nextMonth = new Date(Date.UTC(year, date.getUTCMonth() + 1, 1));
        const end = new Date(nextMonth.getTime() - 1).toISOString();
        return { key, start, end };
      }
      if (groupBy === 'week') {
        // ISO week
        const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const dayNum = temp.getUTCDay() || 7;
        temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((temp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        const key = `${temp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
        
        // Compute start of that week (Monday)
        const monday = new Date(temp);
        monday.setUTCDate(temp.getUTCDate() - 3);
        monday.setUTCHours(0, 0, 0, 0);
        const sunday = new Date(monday.getTime() + 7 * 86400000 - 1);
        return { key, start: monday.toISOString(), end: sunday.toISOString() };
      }
      // Day
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const key = `${year}-${month}-${day}`;
      const start = `${key}T00:00:00.000Z`;
      const end = `${key}T23:59:59.999Z`;
      return { key, start, end };
    };

    // Pre-populate continuous periods between startDate and endDate
    const bucketsMap = new Map<string, TimeSeriesDataPoint>();
    const iterDate = new Date(startDate);
    while (iterDate <= endDate) {
      const { key, start, end } = getPeriodKey(iterDate);
      if (!bucketsMap.has(key)) {
        bucketsMap.set(key, {
          period_label: key,
          period_start: start,
          period_end: end,
          units_sold: 0,
          units_bought: 0,
          gross_revenue_isk: 0,
          buy_spend_isk: 0,
          realized_profit_ttc_isk: 0,
          fees_and_taxes_isk: 0,
          cumulative_profit_ttc_isk: 0,
          cumulative_gross_revenue_isk: 0,
          sales_count: 0,
          buys_count: 0,
        });
      }
      // advance 1 day
      iterDate.setUTCDate(iterDate.getUTCDate() + 1);
    }

    // Populate data into buckets
    for (const tx of filteredTxs) {
      const txDate = new Date(tx.date);
      const { key } = getPeriodKey(txDate);
      const bucket = bucketsMap.get(key);
      if (!bucket) continue;

      const txAmount = roundIsk(tx.quantity * tx.unitPrice);

      if (tx.isBuy) {
        bucket.units_bought += tx.quantity;
        bucket.buy_spend_isk += txAmount;
        bucket.buys_count += 1;
      } else {
        bucket.units_sold += tx.quantity;
        bucket.gross_revenue_isk += txAmount;
        bucket.sales_count += 1;

        const allocs = allocsBySellTx.get(tx.transactionId) || [];
        let allocatedUnits = 0;
        let cogs = 0;
        let sellFees = 0;

        for (const a of allocs) {
          allocatedUnits += a.quantity_allocated;
          cogs += a.allocated_buy_cost + a.allocated_buy_fees;
          sellFees += a.allocated_sell_fees;
        }

        if (allocatedUnits > 0) {
          const ratio = tx.quantity > 0 ? allocatedUnits / tx.quantity : 1;
          const matchedRevenue = txAmount * ratio;
          const profit = matchedRevenue - cogs - sellFees;
          bucket.realized_profit_ttc_isk += profit;
          bucket.fees_and_taxes_isk += sellFees;
        }
      }
    }

    // Sort buckets by date and compute cumulative metrics
    const dataPoints = Array.from(bucketsMap.values()).sort((a, b) =>
      a.period_start.localeCompare(b.period_start)
    );

    let runningCumProfit = 0;
    let runningCumRevenue = 0;

    for (const dp of dataPoints) {
      dp.gross_revenue_isk = roundIsk(dp.gross_revenue_isk);
      dp.buy_spend_isk = roundIsk(dp.buy_spend_isk);
      dp.realized_profit_ttc_isk = roundIsk(dp.realized_profit_ttc_isk);
      dp.fees_and_taxes_isk = roundIsk(dp.fees_and_taxes_isk);

      runningCumProfit += dp.realized_profit_ttc_isk;
      runningCumRevenue += dp.gross_revenue_isk;

      dp.cumulative_profit_ttc_isk = roundIsk(runningCumProfit);
      dp.cumulative_gross_revenue_isk = roundIsk(runningCumRevenue);
    }

    // 2. Inventory Lot Age Distribution Pyramid
    const itemUnsoldLots = this.roiRepo
      .getInventoryLots(characterId, characterIds, typeId)
      .filter((lot) => lot.remaining_quantity > 0);

    const bracketsConfig: { id: AgeBracketId; label: string; minDays: number; maxDays: number }[] = [
      { id: '0-14d', label: '0 à 14 jours (Frais)', minDays: 0, maxDays: 14 },
      { id: '15-30d', label: '15 à 30 jours (Actif)', minDays: 14, maxDays: 30 },
      { id: '31-60d', label: '31 à 60 jours (Ralenti)', minDays: 30, maxDays: 60 },
      { id: '61-90d', label: '61 à 90 jours (Alerte)', minDays: 60, maxDays: 90 },
      { id: '>90d', label: '> 90 jours (Critique / Dormant)', minDays: 90, maxDays: Infinity },
    ];

    const bracketStats = new Map<AgeBracketId, { qty: number; cost: number; lots: number }>();
    for (const b of bracketsConfig) {
      bracketStats.set(b.id, { qty: 0, cost: 0, lots: 0 });
    }

    let totalInventoryCapital = 0;
    const nowTime = now.getTime();

    for (const lot of itemUnsoldLots) {
      const acqTime = new Date(lot.acquisition_date).getTime();
      const ageDays = Math.max(0, (nowTime - acqTime) / (24 * 3600 * 1000));
      const lotCost = lot.remaining_cost_isk + lot.remaining_buy_fees_isk;
      totalInventoryCapital += lotCost;

      for (const b of bracketsConfig) {
        if ((b.minDays === 0 ? ageDays >= 0 : ageDays > b.minDays) && ageDays <= b.maxDays) {
          const current = bracketStats.get(b.id)!;
          current.qty += lot.remaining_quantity;
          current.cost += lotCost;
          current.lots += 1;
          break;
        }
      }
    }

    const lotAgeDistribution: LotAgeDistributionBracket[] = bracketsConfig.map((b) => {
      const stats = bracketStats.get(b.id)!;
      const percentage = totalInventoryCapital > 0
        ? Number(((stats.cost / totalInventoryCapital) * 100).toFixed(1))
        : 0;

      return {
        bracket: b.id,
        label: b.label,
        quantity: stats.qty,
        cost_isk: roundIsk(stats.cost),
        lots_count: stats.lots,
        percentage_of_capital: percentage,
      };
    });

    // 3. Hub Flows Matrix
    const hubFlowsMap = new Map<string, {
      source_hub_id: string;
      source_hub_name: string;
      dest_hub_id: string;
      dest_hub_name: string;
      units: number;
      grossRevenue: number;
      profit: number;
      cogs: number;
    }>();

    for (const alloc of allAllocations) {
      if (typeId !== undefined && alloc.type_id !== typeId) continue;
      const key = `${alloc.buy_hub_id}->${alloc.sell_hub_id}`;
      const current = hubFlowsMap.get(key) || {
        source_hub_id: alloc.buy_hub_id,
        source_hub_name: alloc.buy_hub_name,
        dest_hub_id: alloc.sell_hub_id,
        dest_hub_name: alloc.sell_hub_name,
        units: 0,
        grossRevenue: 0,
        profit: 0,
        cogs: 0,
      };

      current.units += alloc.quantity_allocated;
      const cogsAlloc = alloc.allocated_buy_cost + alloc.allocated_buy_fees;
      current.cogs += cogsAlloc;
      // Find sale tx for gross revenue
      const saleTx = itemTxs.find((t) => t.transactionId === alloc.sell_transaction_id);
      if (saleTx) {
        const ratio = saleTx.quantity > 0 ? alloc.quantity_allocated / saleTx.quantity : 1;
        const rev = saleTx.quantity * saleTx.unitPrice * ratio;
        current.grossRevenue += rev;
        current.profit += (rev - cogsAlloc - alloc.allocated_sell_fees);
      }

      hubFlowsMap.set(key, current);
    }

    const hubFlows: HubFlowSummary[] = Array.from(hubFlowsMap.values()).map((f) => {
      const roi = f.cogs > 0 ? Number(((f.profit / f.cogs) * 100).toFixed(2)) : null;
      return {
        source_hub_id: f.source_hub_id,
        source_hub_name: f.source_hub_name,
        dest_hub_id: f.dest_hub_id,
        dest_hub_name: f.dest_hub_name,
        units_allocated: f.units,
        gross_revenue_isk: roundIsk(f.grossRevenue),
        allocated_profit_ttc_isk: roundIsk(f.profit),
        roi_percent_ttc: roi,
      };
    });

    // 4. Freshness and Uncertainty Notes
    const targetCharIds = characterIds && characterIds.length > 0
      ? characterIds
      : characterId !== undefined
      ? [characterId]
      : undefined;

    const allStates = this.syncRepo.dumpData().states;
    const syncStates = targetCharIds
      ? allStates.filter((s) => targetCharIds.includes(s.characterId))
      : allStates;

    const hasError = syncStates.some((s) => s.status === 'ERROR');
    const isTransitory = syncStates.some((s) => s.status === 'PARTIAL' || s.status === 'SYNCING');

    const TEN_MINUTES = 10 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;
    const completedStates = syncStates.filter((s) => (s.lastSyncCompletedAt || 0) > 0);
    const hasStale = completedStates.some((s) => {
      const ttl = s.resource === 'character_assets' || s.resource === 'corporation_assets' ? ONE_HOUR : TEN_MINUTES;
      return Date.now() - (s.lastSyncCompletedAt || 0) > ttl;
    });

    let freshnessStatus: 'FRESH' | 'STALE' | 'PARTIAL' | 'EMPTY';
    if (syncStates.length === 0) {
      freshnessStatus = 'EMPTY';
    } else if (hasError || isTransitory) {
      freshnessStatus = 'PARTIAL';
    } else if (completedStates.length === 0) {
      freshnessStatus = 'EMPTY';
    } else if (hasStale) {
      freshnessStatus = 'STALE';
    } else {
      freshnessStatus = 'FRESH';
    }

    const uncertaintyNotes: string[] = [];
    if (freshnessStatus === 'STALE') {
      uncertaintyNotes.push('Données ESI partiellement périmées : une synchronisation récente est recommandée.');
    } else if (freshnessStatus === 'PARTIAL') {
      uncertaintyNotes.push('Données ESI incomplètes ou synchronisation partielle en cours.');
    }
    if (filteredTxs.length === 0) {
      uncertaintyNotes.push(`Aucune transaction observée sur la période de ${daysCount} jours sélectionnée.`);
    }

    let typeName: string | undefined;
    if (typeId !== undefined) {
      try {
        const resolved = await this.universeService.resolveNames([typeId]);
        typeName = resolved.get(typeId);
      } catch {
        typeName = `Type #${typeId}`;
      }
    }

    return {
      timeframe,
      group_by: groupBy,
      type_id: typeId,
      type_name: typeName,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      observed_days: daysCount,
      as_of: new Date().toISOString(),
      freshness_status: freshnessStatus,
      data_points: dataPoints,
      lot_age_distribution: lotAgeDistribution,
      hub_flows: hubFlows,
      uncertainty_notes: uncertaintyNotes,
    };
  }
}

export const analyticsService = new AnalyticsService();
