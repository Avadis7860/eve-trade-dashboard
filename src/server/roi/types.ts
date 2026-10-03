export type MetricCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';

export type LotSourceType = 'TRANSACTION' | 'OPENING_BALANCE';

export interface OpeningBalanceLot {
  id: string;
  character_id: number;
  type_id: number;
  type_name: string;
  quantity: number;
  allocated_quantity: number;
  remaining_quantity: number;
  unit_cost_isk: number;
  total_cost_isk: number; // quantity * unit_cost_isk
  location_id: number;
  location_name?: string;
  hub_id: string;
  hub_name: string;
  acquisition_date: string; // ISO 8601
  justification: string; // Mandatory justification note
  created_at: string;
  updated_at: string;
  version: number;
}

export interface InventoryLot {
  lot_id: string;
  character_id: number;
  source_type: LotSourceType;
  source_id: number | string; // transaction_id or opening_balance_id
  type_id: number;
  type_name: string;
  acquisition_date: string;
  initial_quantity: number;
  allocated_quantity: number;
  remaining_quantity: number;
  unit_cost_isk: number;
  total_cost_isk: number;
  remaining_cost_isk: number; // remaining_quantity * unit_cost_isk
  initial_buy_fees_isk: number;
  remaining_buy_fees_isk: number;
  location_id: number;
  location_name?: string;
  hub_id: string;
  hub_name: string;
  justification?: string;
}

export interface ExplicitCostAllocation {
  id: string;
  character_id: number; // Primary/Selling character
  buy_character_id?: number; // Buying character (supports cross-character reconciliation)
  sell_character_id?: number; // Selling character
  sell_transaction_id: number;
  source_type: LotSourceType;
  buy_transaction_id?: number;
  opening_balance_id?: string;
  lot_id?: string;
  type_id: number;
  type_name: string;
  quantity_allocated: number;
  unit_buy_price: number; // Unit price from buy transaction or opening balance
  allocated_buy_cost: number; // quantity_allocated * unit_buy_price
  allocated_buy_fees: number; // allocated broker fees on buy
  allocated_sell_fees: number; // allocated sales taxes / broker fees on sell
  allocated_sell_taxes?: number; // allocated sales taxes on sell
  allocated_sell_broker_fees?: number; // allocated broker fees on sell
  buy_location_id: number;
  buy_hub_id: string;
  buy_hub_name: string;
  sell_location_id: number;
  sell_hub_id: string;
  sell_hub_name: string;
  reconciliation_mode: 'FIFO_AUTOMATIC' | 'MANUAL';
  created_at: string;
  updated_at: string;
  notes?: string;
  version: number;
}

export interface FormulaProof {
  as_of: string;
  gross_revenue_isk: number;
  gross_revenue_total_isk?: number;
  gross_revenue_allocated_isk?: number;
  gross_revenue_unallocated_isk?: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  allocated_sell_fees_isk: number;
  allocated_sell_taxes_isk?: number;
  allocated_sell_broker_fees_isk?: number;
  total_investment_ttc_isk: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  formula_expression: string;
  numerator_isk: number | null;
  denominator_isk: number | null;
}

export interface SaleReconciliationDetail {
  sale_transaction_id: number;
  sale_character_id: number;
  date: string;
  type_id: number;
  type_name: string;
  quantity_sold: number;
  unit_sale_price_isk: number;
  gross_revenue_isk: number;
  gross_revenue_total_isk?: number;
  gross_revenue_allocated_isk?: number;
  gross_revenue_unallocated_isk?: number;
  allocated_quantity: number;
  unallocated_quantity: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  allocated_sell_fees_isk: number;
  allocated_sell_taxes_isk?: number;
  allocated_sell_broker_fees_isk?: number;
  total_investment_ttc_isk: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  coverage_status: MetricCoverageStatus;
  coverage_percent: number;
  volume_coverage_percent: number;
  financial_coverage_percent: number;
  location_id: number;
  location_name?: string;
  hub_id: string;
  hub_name: string;
  allocations: ExplicitCostAllocation[];
  proof: FormulaProof;
}

export interface HubPairPerformance {
  buy_hub_id: string;
  buy_hub_name: string;
  sell_hub_id: string;
  sell_hub_name: string;
  sold_volume_total: number;
  sold_volume_allocated: number;
  gross_revenue: number;
  gross_revenue_allocated?: number;
  gross_revenue_unallocated?: number;
  allocated_buy_cost: number;
  allocated_buy_fees: number;
  attributable_sell_fees: number;
  allocated_sell_taxes?: number;
  allocated_sell_broker_fees?: number;
  realized_profit_ttc: number | null; // null if UNKNOWN
  roi_percent_ttc: number | null; // null if UNKNOWN
  coverage_status: MetricCoverageStatus;
  coverage_percent: number; // 0 to 100
  volume_coverage_percent?: number;
  financial_coverage_percent?: number;
  transaction_count: number;
}

export interface UnsoldInventoryItem {
  character_id: number;
  source_type: LotSourceType;
  buy_transaction_id?: number;
  opening_balance_id?: string;
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
  justification?: string;
}

export interface RoiFinancialSummary {
  version: number;
  as_of: string;
  character_id?: number;
  character_ids?: number[];
  period_label: string;
  
  // Sales volume
  total_sales_volume: number;
  allocated_sales_volume: number;
  unallocated_sales_volume: number;
  
  // Financial metrics
  gross_revenue_isk: number; // legacy alias to gross_revenue_total_isk
  gross_revenue_total_isk: number;
  gross_revenue_allocated_isk: number;
  gross_revenue_unallocated_isk: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  attributable_sell_fees_isk: number;
  allocated_sell_taxes_isk: number;
  allocated_sell_broker_fees_isk: number;
  unallocated_broker_fees_isk?: number;
  total_broker_fees_collected_isk?: number;
  total_allocated_investment_ttc: number;
  realized_profit_ttc_isk: number | null; // null if UNKNOWN
  roi_percent_ttc: number | null; // null if UNKNOWN
  
  // Tied-up capital (Invendus)
  tied_up_capital_isk: number; // Capital immobilisé dans les achats/stocks initiaux non encore alloués/vendus
  unsold_items_count: number;
  
  // Coverage & State
  coverage_status: MetricCoverageStatus;
  coverage_percent: number; // Percentage of sold volume backed by explicit cost allocations (legacy alias)
  volume_coverage_percent: number; // Ratio en unités (allocated_sales_volume / total_sales_volume * 100)
  financial_coverage_percent: number; // Ratio en ISK (gross_revenue_allocated_isk / gross_revenue_total_isk * 100)
  financial_coverage_status?: MetricCoverageStatus;
  
  // Arithmetic Formula Proof
  proof: FormulaProof;

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

export interface AutoReconciliationParams {
  characterId?: number;
  characterIds?: number[];
  typeId?: number;
  prioritizeSellingCharacter?: boolean;
  strictCharacterIsolation?: boolean;
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
