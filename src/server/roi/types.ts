export type MetricCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';

export interface ExplicitCostAllocation {
  id: string;
  character_id: number; // Primary/Selling character
  buy_character_id?: number; // Buying character (supports cross-character reconciliation)
  sell_character_id?: number; // Selling character
  sell_transaction_id: number;
  buy_transaction_id: number;
  type_id: number;
  type_name: string;
  quantity_allocated: number;
  unit_buy_price: number; // Unit price from buy transaction
  allocated_buy_cost: number; // quantity_allocated * unit_buy_price
  allocated_buy_fees: number; // allocated broker fees on buy
  allocated_sell_fees: number; // allocated sales taxes / broker fees on sell
  buy_location_id: number;
  buy_hub_id: string;
  buy_hub_name: string;
  sell_location_id: number;
  sell_hub_id: string;
  sell_hub_name: string;
  reconciliation_mode?: 'FIFO_AUTOMATIC' | 'MANUAL';
  created_at: string;
  updated_at: string;
  notes?: string;
  version: number;
}

export interface HubPairPerformance {
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
  realized_profit_ttc: number | null; // null if UNKNOWN
  roi_percent_ttc: number | null; // null if UNKNOWN
  coverage_status: MetricCoverageStatus;
  coverage_percent: number; // 0 to 100
  transaction_count: number;
}

export interface UnsoldInventoryItem {
  character_id: number;
  buy_transaction_id: number;
  type_id: number;
  type_name: string;
  buy_date: string;
  original_quantity: number;
  allocated_quantity: number;
  remaining_quantity: number;
  unit_buy_price: number;
  tied_capital_isk: number; // remaining_quantity * unit_buy_price
  allocated_buy_fees_remaining: number;
  location_id: number;
  hub_id: string;
  hub_name: string;
}

export interface RoiFinancialSummary {
  as_of: string;
  character_id?: number;
  character_ids?: number[];
  period_label: string;
  
  // Sales volume
  total_sales_volume: number;
  allocated_sales_volume: number;
  unallocated_sales_volume: number;
  
  // Financial metrics
  gross_revenue_isk: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  attributable_sell_fees_isk: number;
  total_allocated_investment_ttc: number;
  realized_profit_ttc_isk: number | null; // null if UNKNOWN
  roi_percent_ttc: number | null; // null if UNKNOWN
  
  // Tied-up capital (Invendus)
  tied_up_capital_isk: number; // Capital immobilisé dans les achats non encore alloués/vendus
  unsold_items_count: number;
  
  // Coverage & State
  coverage_status: MetricCoverageStatus;
  coverage_percent: number; // Percentage of sold volume backed by explicit cost allocations
  
  // Hub pairs breakdown
  hub_pairs: HubPairPerformance[];
}

export interface RoiFilterParams {
  character_id?: number;
  character_ids?: number[];
  start_date?: string;
  end_date?: string;
  type_id?: number;
  buy_hub_id?: string;
  sell_hub_id?: string;
}

export interface AutoReconciliationResult {
  allocations_created: number;
  total_quantity_reconciled: number;
  sales_fully_matched: number;
  sales_partially_matched: number;
  sales_unmatched: number;
  sales_with_asset_stock_identified?: number;
  asset_stock_available_units?: number;
  message?: string;
}
