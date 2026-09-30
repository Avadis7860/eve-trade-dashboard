import type { MetricCoverageStatus, FormulaProof } from '../roi/types.ts';
import type { PhysicalStockClassification } from '../capital/types.ts';

export type TimeframeOption = '7d' | '14d' | '30d' | '90d' | '180d' | 'all';
export type GroupByOption = 'day' | 'week' | 'month';

export interface Product360StockSummary {
  total_quantity: number;
  committed_sell_order_qty: number;
  free_hub_stock_qty: number;
  remote_dormant_stock_qty: number;
  in_transit_stock_qty: number;
  unreconciled_stock_qty: number;
  total_cost_isk: number;
  total_notional_sell_isk: number;
}

export interface Product360KPIs {
  gross_revenue_isk: number;
  cogs_allocated_isk: number;
  allocated_sell_fees_isk: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  units_sold: number;
  units_bought: number;
  sales_transactions_count: number;
  buy_transactions_count: number;
  velocity_daily: number; // V_jour = units_sold / observation_days
  velocity_observation_days: number;
  average_holding_days: number | null; // D_detention weighted average
  coverage_ratio_holding_days: number; // 0..1 fraction of sold units with known buy date
  yield_per_capital_day_percent: number | null; // R_cap_jour = ROI_TTC / D_detention
  committed_capital_isk: number; // total acquisition cost of remaining unsold stock
  stock_summary: Product360StockSummary;
}

export interface Product360LocationBreakdown {
  location_id: number;
  location_name: string;
  hub_id: string;
  hub_name: string;
  classification: PhysicalStockClassification;
  quantity: number;
  cost_basis_unit_isk: number | null;
  cost_basis_total_isk: number | null;
  notional_unit_price_isk: number | null;
  notional_total_isk: number | null;
  days_inactive: number | null;
  is_dormant: boolean;
}

export interface Product360OpenOrder {
  order_id: number;
  character_id: number;
  character_name: string;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  location_id: number;
  location_name: string;
  hub_id: string;
  hub_name: string;
  issued_at: string;
  duration_days: number;
  progress_percent: number;
  total_value_isk: number;
  state: string;
}

export interface Product360Transaction {
  transaction_id: number;
  character_id: number;
  date: string;
  is_buy: boolean;
  quantity: number;
  unit_price: number;
  total_amount_isk: number;
  location_id: number;
  location_name: string;
  hub_id: string;
  hub_name: string;
  reconciliation_status: MetricCoverageStatus;
  allocated_buy_cost_isk: number | null;
  allocated_profit_ttc_isk: number | null;
  proof: FormulaProof | null;
}

export interface TimeSeriesDataPoint {
  period_label: string; // e.g. "2026-09-01", "2026-W36", "2026-09"
  period_start: string;
  period_end: string;
  units_sold: number;
  units_bought: number;
  gross_revenue_isk: number;
  buy_spend_isk: number;
  realized_profit_ttc_isk: number;
  fees_and_taxes_isk: number;
  cumulative_profit_ttc_isk: number;
  cumulative_gross_revenue_isk: number;
  sales_count: number;
  buys_count: number;
}

export type AgeBracketId = '0-14d' | '15-30d' | '31-60d' | '61-90d' | '>90d';

export interface LotAgeDistributionBracket {
  bracket: AgeBracketId;
  label: string;
  quantity: number;
  cost_isk: number;
  lots_count: number;
  percentage_of_capital: number;
}

export interface HubFlowSummary {
  source_hub_id: string;
  source_hub_name: string;
  dest_hub_id: string;
  dest_hub_name: string;
  units_allocated: number;
  gross_revenue_isk: number;
  allocated_profit_ttc_isk: number;
  roi_percent_ttc: number | null;
}

export interface ActivityTimeSeriesResponse {
  timeframe: TimeframeOption;
  group_by: GroupByOption;
  type_id?: number;
  type_name?: string;
  start_date: string;
  end_date: string;
  observed_days: number;
  as_of: string;
  freshness_status: 'FRESH' | 'STALE' | 'PARTIAL' | 'EMPTY';
  data_points: TimeSeriesDataPoint[];
  lot_age_distribution: LotAgeDistributionBracket[];
  hub_flows: HubFlowSummary[];
  uncertainty_notes: string[];
}

export interface Product360Response {
  type_id: number;
  type_name: string;
  group_name?: string;
  category_name?: string;
  image_url: string;
  as_of: string;
  timeframe: TimeframeOption;
  kpis: Product360KPIs;
  locations_breakdown: Product360LocationBreakdown[];
  open_orders: Product360OpenOrder[];
  transactions_history: Product360Transaction[];
  timeseries: ActivityTimeSeriesResponse;
}
