import {
  ExplicitCostAllocation,
  HubPairPerformance,
  MetricCoverageStatus,
  RoiFinancialSummary,
  UnsoldInventoryItem,
} from './types';
import type { CharacterTransaction } from '../ledger/types';

/**
 * Utility for exact financial arithmetic rounding to 2 decimal places (cents of ISK)
 */
export function roundIsk(value: number): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Utility for rounding percentages to 2 decimal places
 */
export function roundPercent(value: number): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class RoiCalculator {
  /**
   * Calculates financial summary and ROI TTC based strictly on explicit proofs and allocations.
   */
  static computeSummary(
    salesTransactions: CharacterTransaction[],
    allocations: ExplicitCostAllocation[],
    unsoldInventory: UnsoldInventoryItem[],
    characterId?: number,
    periodLabel: string = 'Toutes périodes'
  ): RoiFinancialSummary {
    const asOf = new Date().toISOString();

    if (salesTransactions.length === 0 && allocations.length === 0 && unsoldInventory.length === 0) {
      return {
        as_of: asOf,
        character_id: characterId,
        period_label: periodLabel,
        total_sales_volume: 0,
        allocated_sales_volume: 0,
        unallocated_sales_volume: 0,
        gross_revenue_isk: 0,
        allocated_buy_cost_isk: 0,
        allocated_buy_fees_isk: 0,
        attributable_sell_fees_isk: 0,
        total_allocated_investment_ttc: 0,
        realized_profit_ttc_isk: null,
        roi_percent_ttc: null,
        tied_up_capital_isk: 0,
        unsold_items_count: 0,
        coverage_status: 'EMPTY',
        coverage_percent: 100,
        hub_pairs: [],
      };
    }

    // 1. Total sales volume and gross revenue from sales transactions
    let totalSalesVolume = 0;
    let grossRevenueIsk = 0;
    for (const tx of salesTransactions) {
      if (!tx.isBuy) {
        totalSalesVolume += tx.quantity;
        grossRevenueIsk += tx.unitPrice * tx.quantity;
      }
    }
    grossRevenueIsk = roundIsk(grossRevenueIsk);

    // 2. Aggregate from explicit allocations
    let allocatedSalesVolume = 0;
    let allocatedBuyCostIsk = 0;
    let allocatedBuyFeesIsk = 0;
    let attributableSellFeesIsk = 0;
    let allocatedSalesGrossRevenue = 0;

    // Index allocations by sell_transaction_id to link with sell transaction unit price
    const salesTxMap = new Map<number, CharacterTransaction>();
    for (const tx of salesTransactions) {
      if (!tx.isBuy) {
        salesTxMap.set(tx.transactionId, tx);
      }
    }

    // Grouping by hub pair (Buy Hub -> Sell Hub)
    const hubPairsMap = new Map<string, {
      buy_hub_id: string;
      buy_hub_name: string;
      sell_hub_id: string;
      sell_hub_name: string;
      sold_volume_total: number;
      sold_volume_allocated: number;
      gross_revenue: number;
      allocated_buy_cost: number;
      allocated_buy_fees: number;
      attributable_sell_fees: number;
      transaction_ids: Set<number>;
    }>();

    for (const alloc of allocations) {
      allocatedSalesVolume += alloc.quantity_allocated;
      allocatedBuyCostIsk += alloc.allocated_buy_cost;
      allocatedBuyFeesIsk += alloc.allocated_buy_fees;
      attributableSellFeesIsk += alloc.allocated_sell_fees;

      const sellTx = salesTxMap.get(alloc.sell_transaction_id);
      const sellUnitPrice = sellTx ? sellTx.unitPrice : 0;
      const allocGross = sellUnitPrice * alloc.quantity_allocated;
      allocatedSalesGrossRevenue += allocGross;

      // Hub pair key
      const pairKey = `${alloc.buy_hub_id}-->${alloc.sell_hub_id}`;
      let pair = hubPairsMap.get(pairKey);
      if (!pair) {
        pair = {
          buy_hub_id: alloc.buy_hub_id,
          buy_hub_name: alloc.buy_hub_name,
          sell_hub_id: alloc.sell_hub_id,
          sell_hub_name: alloc.sell_hub_name,
          sold_volume_total: 0,
          sold_volume_allocated: 0,
          gross_revenue: 0,
          allocated_buy_cost: 0,
          allocated_buy_fees: 0,
          attributable_sell_fees: 0,
          transaction_ids: new Set(),
        };
        hubPairsMap.set(pairKey, pair);
      }

      pair.sold_volume_allocated += alloc.quantity_allocated;
      pair.gross_revenue += allocGross;
      pair.allocated_buy_cost += alloc.allocated_buy_cost;
      pair.allocated_buy_fees += alloc.allocated_buy_fees;
      pair.attributable_sell_fees += alloc.allocated_sell_fees;
      pair.transaction_ids.add(alloc.sell_transaction_id);
    }

    allocatedBuyCostIsk = roundIsk(allocatedBuyCostIsk);
    allocatedBuyFeesIsk = roundIsk(allocatedBuyFeesIsk);
    attributableSellFeesIsk = roundIsk(attributableSellFeesIsk);
    allocatedSalesGrossRevenue = roundIsk(allocatedSalesGrossRevenue);

    const unallocatedSalesVolume = Math.max(0, totalSalesVolume - allocatedSalesVolume);

    // 3. Investment TTC & Realized Profit TTC
    const totalAllocatedInvestmentTtc = roundIsk(allocatedBuyCostIsk + allocatedBuyFeesIsk);

    let realizedProfitTtcIsk: number | null = null;
    let roiPercentTtc: number | null = null;
    let coverageStatus: MetricCoverageStatus = 'UNKNOWN';
    let coveragePercent = 0;

    if (totalSalesVolume > 0) {
      coveragePercent = roundPercent((allocatedSalesVolume / totalSalesVolume) * 100);
    } else if (allocatedSalesVolume > 0) {
      coveragePercent = 100;
    }

    if (allocatedSalesVolume > 0 && totalAllocatedInvestmentTtc > 0) {
      // Realized profit on allocated items = Gross Revenue from allocated items − Allocated Buy Cost − Allocated Buy Fees − Attributable Sell Fees
      realizedProfitTtcIsk = roundIsk(
        allocatedSalesGrossRevenue - allocatedBuyCostIsk - allocatedBuyFeesIsk - attributableSellFeesIsk
      );

      // ROI % = (Realized Profit / Total Allocated Investment TTC) * 100
      roiPercentTtc = roundPercent((realizedProfitTtcIsk / totalAllocatedInvestmentTtc) * 100);

      if (coveragePercent >= 99.99) {
        coverageStatus = 'COMPLETE';
      } else {
        coverageStatus = 'PARTIAL';
      }
    } else if (totalSalesVolume > 0) {
      // Sales exist, but no explicit purchase cost was allocated/proven
      coverageStatus = 'UNKNOWN';
      realizedProfitTtcIsk = null;
      roiPercentTtc = null;
    } else {
      coverageStatus = 'EMPTY';
    }

    // 4. Tied-up capital (Capital immobilisé) in unsold inventory
    let tiedUpCapitalIsk = 0;
    for (const inv of unsoldInventory) {
      tiedUpCapitalIsk += inv.tied_capital_isk + inv.allocated_buy_fees_remaining;
    }
    tiedUpCapitalIsk = roundIsk(tiedUpCapitalIsk);

    // 5. Build Hub pairs performance list
    const hubPairs: HubPairPerformance[] = Array.from(hubPairsMap.values()).map((p) => {
      const pairInvestment = roundIsk(p.allocated_buy_cost + p.allocated_buy_fees);
      let pairProfit: number | null = null;
      let pairRoi: number | null = null;
      let pairCoverageStatus: MetricCoverageStatus = 'UNKNOWN';

      if (p.sold_volume_allocated > 0 && pairInvestment > 0) {
        pairProfit = roundIsk(
          p.gross_revenue - p.allocated_buy_cost - p.allocated_buy_fees - p.attributable_sell_fees
        );
        pairRoi = roundPercent((pairProfit / pairInvestment) * 100);
        pairCoverageStatus = 'COMPLETE'; // On this specific paired flow, allocation is proven
      }

      return {
        buy_hub_id: p.buy_hub_id,
        buy_hub_name: p.buy_hub_name,
        sell_hub_id: p.sell_hub_id,
        sell_hub_name: p.sell_hub_name,
        sold_volume_total: p.sold_volume_allocated,
        sold_volume_allocated: p.sold_volume_allocated,
        gross_revenue: roundIsk(p.gross_revenue),
        allocated_buy_cost: roundIsk(p.allocated_buy_cost),
        allocated_buy_fees: roundIsk(p.allocated_buy_fees),
        attributable_sell_fees: roundIsk(p.attributable_sell_fees),
        realized_profit_ttc: pairProfit,
        roi_percent_ttc: pairRoi,
        coverage_status: pairCoverageStatus,
        coverage_percent: 100,
        transaction_count: p.transaction_ids.size,
      };
    });

    return {
      as_of: asOf,
      character_id: characterId,
      period_label: periodLabel,
      total_sales_volume: totalSalesVolume,
      allocated_sales_volume: allocatedSalesVolume,
      unallocated_sales_volume: unallocatedSalesVolume,
      gross_revenue_isk: grossRevenueIsk,
      allocated_buy_cost_isk: allocatedBuyCostIsk,
      allocated_buy_fees_isk: allocatedBuyFeesIsk,
      attributable_sell_fees_isk: attributableSellFeesIsk,
      total_allocated_investment_ttc: totalAllocatedInvestmentTtc,
      realized_profit_ttc_isk: realizedProfitTtcIsk,
      roi_percent_ttc: roiPercentTtc,
      tied_up_capital_isk: tiedUpCapitalIsk,
      unsold_items_count: unsoldInventory.length,
      coverage_status: coverageStatus,
      coverage_percent: coveragePercent,
      hub_pairs: hubPairs,
    };
  }
}
