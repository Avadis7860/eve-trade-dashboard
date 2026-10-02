import {
  ExplicitCostAllocation,
  FormulaProof,
  HubPairPerformance,
  MetricCoverageStatus,
  RoiFinancialSummary,
  SaleReconciliationDetail,
  UnsoldInventoryItem,
} from './types';
import type { CharacterTransaction } from '../ledger/types';
import { hubsService } from '../hubs/service';

/**
 * Utility for exact financial arithmetic rounding to 2 decimal places (cents of ISK).
 * In accordance with Phase F03 and docs/METRICS.md:
 * Non-finite numbers, NaN, null, and undefined are NOT silently coerced to 0,
 * but return null to allow caller propagation of UNKNOWN status.
 */
export function roundIsk(value: number): number;
export function roundIsk(value: number | null | undefined): number | null;
export function roundIsk(value: number | null | undefined): number | null {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return null;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Utility for rounding percentages to 2 decimal places.
 * Non-finite numbers, NaN, null, and undefined return null.
 */
export function roundPercent(value: number): number;
export function roundPercent(value: number | null | undefined): number | null;
export function roundPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return null;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class RoiCalculator {
  /**
   * Builds an auditable formula proof for a set of financial inputs
   */
  static buildProof(params: {
    asOf: string;
    grossRevenue: number;
    allocatedBuyCost: number;
    allocatedBuyFees: number;
    allocatedSellFees: number;
    allocatedVolume: number;
    totalVolume: number;
  }): FormulaProof {
    const { asOf, grossRevenue, allocatedBuyCost, allocatedBuyFees, allocatedSellFees, allocatedVolume } = params;
    const totalInvestment = roundIsk(allocatedBuyCost + allocatedBuyFees) ?? 0;

    let realizedProfit: number | null = null;
    let roiPercent: number | null = null;
    let formula = 'Profit = CA_brut_alloué − Coût_achat − Frais_achat − Frais_vente; ROI = (Profit / Inv_TTC) × 100';

    if (allocatedVolume > 0 && totalInvestment > 0) {
      realizedProfit = roundIsk(grossRevenue - allocatedBuyCost - allocatedBuyFees - allocatedSellFees);
      if (realizedProfit !== null) {
        roiPercent = roundPercent((realizedProfit / totalInvestment) * 100);
      }
      if (realizedProfit !== null && roiPercent !== null) {
        formula = `${grossRevenue.toLocaleString('fr-FR')} − ${allocatedBuyCost.toLocaleString('fr-FR')} − ${allocatedBuyFees.toLocaleString('fr-FR')} − ${allocatedSellFees.toLocaleString('fr-FR')} = ${realizedProfit.toLocaleString('fr-FR')} ISK (ROI: (${realizedProfit.toLocaleString('fr-FR')} / ${totalInvestment.toLocaleString('fr-FR')}) × 100 = ${roiPercent.toFixed(2)}%)`;
      }
    } else {
      realizedProfit = null;
      roiPercent = null;
      formula = totalInvestment <= 0
        ? 'Investissement nul ou indéterminé : ROI = null (UNKNOWN)'
        : 'Volume alloué nul : profit indéterminé';
    }

    return {
      as_of: asOf,
      gross_revenue_isk: grossRevenue,
      allocated_buy_cost_isk: allocatedBuyCost,
      allocated_buy_fees_isk: allocatedBuyFees,
      allocated_sell_fees_isk: allocatedSellFees,
      total_investment_ttc_isk: totalInvestment,
      realized_profit_ttc_isk: realizedProfit,
      roi_percent_ttc: roiPercent,
      formula_expression: formula,
      numerator_isk: realizedProfit,
      denominator_isk: totalInvestment > 0 ? totalInvestment : null,
    };
  }

  /**
   * Computes unit reconciliation proof for a single sale transaction
   */
  static computeSaleDetail(
    saleTx: CharacterTransaction,
    allocations: ExplicitCostAllocation[],
    asOf: string = new Date().toISOString()
  ): SaleReconciliationDetail {
    const saleAllocations = allocations.filter((a) => a.sell_transaction_id === saleTx.transactionId);
    let allocatedQty = 0;
    let allocatedBuyCost = 0;
    let allocatedBuyFees = 0;
    let allocatedSellFees = 0;

    for (const alloc of saleAllocations) {
      allocatedQty += alloc.quantity_allocated;
      allocatedBuyCost += alloc.allocated_buy_cost;
      allocatedBuyFees += alloc.allocated_buy_fees;
      allocatedSellFees += alloc.allocated_sell_fees;
    }

    allocatedBuyCost = roundIsk(allocatedBuyCost);
    allocatedBuyFees = roundIsk(allocatedBuyFees);
    allocatedSellFees = roundIsk(allocatedSellFees);

    const totalSoldQty = saleTx.quantity;
    const unallocatedQty = Math.max(0, totalSoldQty - allocatedQty);
    const grossRevenueTotal = roundIsk(saleTx.unitPrice * totalSoldQty);
    const grossRevenueAllocated = roundIsk(saleTx.unitPrice * allocatedQty);

    const coveragePercent = totalSoldQty > 0
      ? (roundPercent((allocatedQty / totalSoldQty) * 100) ?? 0)
      : (allocatedQty > 0 ? 100 : 0);

    let coverageStatus: MetricCoverageStatus = 'UNKNOWN';
    if (allocatedQty > 0) {
      coverageStatus = coveragePercent >= 99.99 ? 'COMPLETE' : 'PARTIAL';
    } else if (totalSoldQty === 0) {
      coverageStatus = 'EMPTY';
    }

    const proof = this.buildProof({
      asOf,
      grossRevenue: grossRevenueAllocated,
      allocatedBuyCost,
      allocatedBuyFees,
      allocatedSellFees,
      allocatedVolume: allocatedQty,
      totalVolume: totalSoldQty,
    });

    const resolvedHub = hubsService.resolveLocationToHub(saleTx.locationId, saleTx.locationName);

    return {
      sale_transaction_id: saleTx.transactionId,
      sale_character_id: saleTx.characterId,
      date: saleTx.date,
      type_id: saleTx.typeId,
      type_name: saleTx.typeName || `Type #${saleTx.typeId}`,
      quantity_sold: totalSoldQty,
      unit_sale_price_isk: saleTx.unitPrice,
      gross_revenue_isk: grossRevenueTotal,
      allocated_quantity: allocatedQty,
      unallocated_quantity: unallocatedQty,
      allocated_buy_cost_isk: allocatedBuyCost,
      allocated_buy_fees_isk: allocatedBuyFees,
      allocated_sell_fees_isk: allocatedSellFees,
      total_investment_ttc_isk: proof.total_investment_ttc_isk,
      realized_profit_ttc_isk: proof.realized_profit_ttc_isk,
      roi_percent_ttc: proof.roi_percent_ttc,
      coverage_status: coverageStatus,
      coverage_percent: coveragePercent,
      location_id: saleTx.locationId,
      location_name: saleTx.locationName,
      hub_id: resolvedHub.hub_id,
      hub_name: resolvedHub.hub_name,
      allocations: saleAllocations,
      proof,
    };
  }

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
      const emptyProof: FormulaProof = {
        as_of: asOf,
        gross_revenue_isk: 0,
        allocated_buy_cost_isk: 0,
        allocated_buy_fees_isk: 0,
        allocated_sell_fees_isk: 0,
        total_investment_ttc_isk: 0,
        realized_profit_ttc_isk: null,
        roi_percent_ttc: null,
        formula_expression: 'Aucune transaction observée',
        numerator_isk: null,
        denominator_isk: null,
      };

      return {
        version: 2,
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
        proof: emptyProof,
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
      const sellTx = salesTxMap.get(alloc.sell_transaction_id);
      // Invariant: Do not impute costs/fees/revenue for allocations whose sale transaction is not in the evaluated sales scope (or orphan)
      if (!sellTx) {
        continue;
      }

      allocatedSalesVolume += alloc.quantity_allocated;
      allocatedBuyCostIsk += alloc.allocated_buy_cost;
      allocatedBuyFeesIsk += alloc.allocated_buy_fees;
      attributableSellFeesIsk += alloc.allocated_sell_fees;

      const allocGross = sellTx.unitPrice * alloc.quantity_allocated;
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
    const totalAllocatedInvestmentTtc = roundIsk(allocatedBuyCostIsk + allocatedBuyFeesIsk) ?? 0;

    let realizedProfitTtcIsk: number | null = null;
    let roiPercentTtc: number | null = null;
    let coverageStatus: MetricCoverageStatus = 'UNKNOWN';
    let coveragePercent = 0;

    if (totalSalesVolume > 0) {
      coveragePercent = roundPercent((allocatedSalesVolume / totalSalesVolume) * 100) ?? 0;
    } else if (allocatedSalesVolume > 0) {
      coveragePercent = 100;
    }

    if (allocatedSalesVolume > 0 && totalAllocatedInvestmentTtc > 0) {
      // Realized profit on allocated items = Gross Revenue from allocated items − Allocated Buy Cost − Allocated Buy Fees − Attributable Sell Fees
      realizedProfitTtcIsk = roundIsk(
        allocatedSalesGrossRevenue - allocatedBuyCostIsk - allocatedBuyFeesIsk - attributableSellFeesIsk
      );

      // ROI % = (Realized Profit / Total Allocated Investment TTC) * 100
      roiPercentTtc = realizedProfitTtcIsk !== null
        ? roundPercent((realizedProfitTtcIsk / totalAllocatedInvestmentTtc) * 100)
        : null;

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

    const proof = this.buildProof({
      asOf,
      grossRevenue: allocatedSalesGrossRevenue,
      allocatedBuyCost: allocatedBuyCostIsk,
      allocatedBuyFees: allocatedBuyFeesIsk,
      allocatedSellFees: attributableSellFeesIsk,
      allocatedVolume: allocatedSalesVolume,
      totalVolume: totalSalesVolume,
    });

    // 4. Tied-up capital (Capital immobilisé) in unsold inventory
    let tiedUpCapitalIsk = 0;
    for (const inv of unsoldInventory) {
      tiedUpCapitalIsk += inv.tied_capital_isk + inv.allocated_buy_fees_remaining;
    }
    tiedUpCapitalIsk = roundIsk(tiedUpCapitalIsk);

    // 5. Build Hub pairs performance list
    const hubPairs: HubPairPerformance[] = Array.from(hubPairsMap.values()).map((p) => {
      const pairInvestment = roundIsk(p.allocated_buy_cost + p.allocated_buy_fees) ?? 0;
      let pairProfit: number | null = null;
      let pairRoi: number | null = null;
      let pairCoverageStatus: MetricCoverageStatus = 'UNKNOWN';

      if (p.sold_volume_allocated > 0 && pairInvestment > 0) {
        pairProfit = roundIsk(
          p.gross_revenue - p.allocated_buy_cost - p.allocated_buy_fees - p.attributable_sell_fees
        );
        pairRoi = pairProfit !== null ? roundPercent((pairProfit / pairInvestment) * 100) : null;
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
      version: 2,
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
      proof,
      hub_pairs: hubPairs,
    };
  }
}
