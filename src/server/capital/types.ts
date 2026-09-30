/**
 * Domain types and contracts for Capital Positions and Mutually Exclusive Inventory (Phase 09)
 */

export type PhysicalStockClassification =
  | 'COMMITTED_SELL_ORDER' // In active sell order
  | 'FREE_HUB_STOCK'       // Free at a recognized trading hub station
  | 'REMOTE_DORMANT_STOCK' // Outside configured hubs or without movement > 30 days
  | 'IN_TRANSIT_STOCK'     // In ship cargo hold, fleet hangar, deliveries, or courier
  | 'UNRECONCILED_STOCK';  // Physical stock with unknown purchase cost

export type CostBasisStatus = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';

export interface MonetaryCapitalSummary {
  liquidWalletBalanceIsk: number;     // LIQUID_WALLET_BALANCE
  marketBuyEscrowIsk: number;         // MARKET_BUY_ESCROW
  inventoryCostValueIsk: number;      // INVENTORY_COST_VALUE (sum of acquisition costs for unsold inventory)
  netRealCapitalIsk: number;          // liquidWalletBalance + marketBuyEscrow + inventoryCostValue
  
  // Informational / Notional ask value (NEVER included in netRealCapitalIsk)
  notionalMarketAskValueIsk: number;  // NOTIONAL_MARKET_ASK_VALUE (sum of remaining volume * price on sell orders)
  
  // Statuses & counts
  unreconciledStockUnitsCount: number; // Physical units without purchase cost
  unreconciledStockEstimatedValueStatus: CostBasisStatus;
}

export interface PhysicalStockPosition {
  id: string; // `${characterId}:${typeId}:${locationId}`
  characterId: number;
  typeId: number;
  typeName: string;
  locationId: number;
  locationName: string;
  locationType: string;
  locationFlag: string;
  hubId: string;
  hubName: string;
  isConfiguredHub: boolean;
  
  // Physical Quantities (Mutually Exclusive decomposition)
  totalPhysicalQuantity: number;
  committedSellOrderQuantity: number;
  freeHubStockQuantity: number;
  remoteDormantStockQuantity: number;
  inTransitQuantity: number;
  
  // Classification
  primaryClassification: PhysicalStockClassification;
  
  // Days since last activity or movement
  daysInactive: number;
  isDormant: boolean;
  
  // Valuation
  unitCostIsk: number | null; // null if UNKNOWN
  costBasisStatus: CostBasisStatus;
  totalCostBasisIsk: number | null; // unitCost * totalPhysicalQuantity or tied capital
  
  // Sell order notional value
  activeSellOrdersCount: number;
  sellOrderNotionalValueIsk: number;
  
  // Audit proof (strict arithmetic invariance)
  decompositionProof: {
    totalPhysical: number;
    committedSell: number;
    freeHub: number;
    remoteDormant: number;
    inTransit: number;
    isSumExact: boolean;
  };
}

export interface PhysicalSummaryMetrics {
  totalItemsTracked: number;
  distinctTypes: number;
  distinctLocations: number;
  totalUnits: number;
  committedSellOrderUnits: number;
  freeHubStockUnits: number;
  remoteDormantStockUnits: number;
  inTransitStockUnits: number;
  unreconciledCostUnits: number;
}

export interface DormantSummaryMetrics {
  dormantItemsCount: number;
  dormantTotalUnits: number;
  dormantCostValueIsk: number;
  dormantLocationsCount: number;
}

export interface CapitalSummaryResponse {
  asOf: number;
  characterCount: number;
  characterIds: number[];
  monetary: MonetaryCapitalSummary;
  physicalSummary: PhysicalSummaryMetrics;
  dormantSummary: DormantSummaryMetrics;
}

export interface CapitalBreakdownFilters {
  characterId?: number;
  characterIds?: number[];
  hubId?: string;
  typeId?: number;
  classification?: PhysicalStockClassification | 'ALL';
  isDormantOnly?: boolean;
  search?: string;
  sortBy?: 'typeName' | 'totalPhysicalQuantity' | 'totalCostBasisIsk' | 'committedSellOrderQuantity' | 'daysInactive';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CapitalBreakdownResponse {
  summary: CapitalSummaryResponse;
  positions: PhysicalStockPosition[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
