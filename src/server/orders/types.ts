/**
 * Domain types and contracts for Order Lifecycle and Local Restock Lists (Phase 04)
 */

export type OrderLifecycleState =
  | 'ACTIVE'
  | 'PARTIALLY_FILLED'
  | 'COMPLETED_CONFIRMED'
  | 'CANCELLED_CONFIRMED'
  | 'EXPIRED_CONFIRMED'
  | 'DISAPPEARED_UNCONFIRMED'
  | 'UNKNOWN';

export interface RawEsiOrder {
  order_id: number;
  type_id: number;
  region_id: number;
  location_id: number;
  range: string;
  is_buy_order?: boolean;
  price: number;
  volume_total: number;
  volume_remain: number;
  issued: string;
  duration: number;
  min_volume?: number;
  escrow?: number;
  state?: string; // in historical orders: "cancelled", "expired"
}

export interface CharacterOrderSnapshot {
  id: string; // `${characterId}:${orderId}`
  characterId: number;
  orderId: number;
  typeId: number;
  typeName?: string;
  regionId: number;
  locationId: number;
  locationName?: string;
  isBuyOrder: boolean;
  price: number;
  volumeTotal: number;
  volumeRemain: number;
  volumeFilled: number; // volumeTotal - volumeRemain
  issued: string; // ISO UTC
  duration: number;
  expiresAt: string; // calculated ISO UTC: issued + duration days
  minVolume?: number;
  escrow?: number;
  state: OrderLifecycleState;
  stateJustification: string;
  firstObservedAt: number;
  lastObservedAt: number;
  lastSnapshotVolumeRemain: number;
  isActiveInCurrentSnapshot: boolean;
  source: string;
}

export interface OrderQueryFilters {
  characterId: number;
  state?: OrderLifecycleState | 'ALL' | 'ACTIVE_ALL';
  isBuyOrder?: boolean;
  locationId?: number;
  typeId?: number;
  search?: string;
  sortBy?: 'issued' | 'lastObservedAt' | 'volumeFilled' | 'price' | 'typeName' | 'state';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface OrderSummaryMetrics {
  characterId: number;
  asOf: number;
  totalOrdersTracked: number;
  activeOrdersCount: number;
  partiallyFilledCount: number;
  completedCount: number;
  cancelledCount: number;
  expiredCount: number;
  disappearedCount: number;
  totalActiveIskValue: number;
  totalActiveEscrowIsk: number;
}

export type RestockItemStatus = 'SUGGESTED' | 'PLANNED' | 'PURCHASED' | 'DISMISSED';

export interface RestockItem {
  id: string; // UUID or `${characterId}:${typeId}:${sellHubId}`
  characterId: number;
  typeId: number;
  typeName: string;
  targetBuyHubId: number;
  targetBuyHubName: string;
  sellHubId: number;
  sellHubName: string;
  suggestedQuantity: number;
  targetQuantity: number;
  estimatedBuyUnitPrice?: number;
  status: RestockItemStatus;
  justification: string; // e.g. "Ordre de vente épuisé / complété", "Rupture de stock imminente"
  linkedOrderId?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRestockItemDto {
  characterId: number;
  typeId: number;
  typeName?: string;
  targetBuyHubId: number;
  targetBuyHubName?: string;
  sellHubId: number;
  sellHubName?: string;
  suggestedQuantity: number;
  targetQuantity: number;
  estimatedBuyUnitPrice?: number;
  justification: string;
  linkedOrderId?: number;
  notes?: string;
}

export interface UpdateRestockItemDto {
  targetQuantity?: number;
  targetBuyHubId?: number;
  targetBuyHubName?: string;
  sellHubId?: number;
  sellHubName?: string;
  status?: RestockItemStatus;
  notes?: string;
}
