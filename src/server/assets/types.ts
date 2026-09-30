/**
 * Domain types and contracts for ESI Character and Corporation Assets
 */

export interface RawEsiAsset {
  item_id: number;
  type_id: number;
  quantity: number;
  location_id: number;
  location_type: 'station' | 'solar_system' | 'item' | 'other' | string;
  location_flag: string;
  is_singleton: boolean;
  is_blueprint_copy?: boolean;
}

export interface CharacterAsset {
  id: string; // `${ownerId}:${itemId}`
  characterId: number;
  itemId: number;
  typeId: number;
  typeName?: string;
  quantity: number;
  locationId: number;
  locationName?: string;
  locationType: string;
  locationFlag: string;
  isSingleton: boolean;
  isCorpAsset: boolean;
  corporationId?: number;
  source: string;
  observedAt: number;
}

export interface AssetQueryFilters {
  characterId?: number;
  characterIds?: number[];
  typeId?: number;
  locationId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AssetSummaryMetrics {
  totalItems: number;
  distinctTypes: number;
  distinctLocations: number;
  totalQuantity: number;
  characterCount: number;
}

export interface AssetStockCheck {
  typeId: number;
  totalQuantity: number;
  locations: Array<{
    locationId: number;
    locationName: string;
    quantity: number;
  }>;
}
