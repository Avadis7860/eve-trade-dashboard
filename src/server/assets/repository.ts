import type {
  CharacterAsset,
  AssetQueryFilters,
  AssetSummaryMetrics,
  AssetStockCheck,
} from './types.ts';

export interface IAssetsRepository {
  saveAssets(assets: CharacterAsset[]): { inserted: number; updated: number };
  getAssets(filters: AssetQueryFilters): { items: CharacterAsset[]; total: number; page: number; pageSize: number };
  getAllAssets(characterId?: number, characterIds?: number[]): CharacterAsset[];
  getStockForType(typeId: number, locationId?: number, characterIds?: number[]): number;
  getStockBreakdown(typeId: number, characterIds?: number[]): AssetStockCheck;
  getSummary(characterId?: number, characterIds?: number[]): AssetSummaryMetrics;
  clearAssets(characterId: number): void;
  dumpData(): { assets: CharacterAsset[] };
  restoreData(data: { assets: CharacterAsset[] }): void;
}

export class InMemoryAssetsRepository implements IAssetsRepository {
  private assets: Map<string, CharacterAsset> = new Map();

  public saveAssets(assets: CharacterAsset[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;

    for (const asset of assets) {
      if (this.assets.has(asset.id)) {
        this.assets.set(asset.id, asset);
        updated++;
      } else {
        this.assets.set(asset.id, asset);
        inserted++;
      }
    }

    return { inserted, updated };
  }

  public getAssets(filters: AssetQueryFilters): { items: CharacterAsset[]; total: number; page: number; pageSize: number } {
    const {
      characterId,
      characterIds,
      typeId,
      locationId,
      search,
      page = 1,
      pageSize = 50,
    } = filters;

    const charFilterSet = characterIds && characterIds.length > 0
      ? new Set(characterIds)
      : characterId !== undefined
      ? new Set([characterId])
      : null;

    const searchLower = search ? search.trim().toLowerCase() : '';

    const matched: CharacterAsset[] = [];

    for (const asset of this.assets.values()) {
      if (charFilterSet && !charFilterSet.has(asset.characterId)) {
        continue;
      }
      if (typeId !== undefined && asset.typeId !== typeId) {
        continue;
      }
      if (locationId !== undefined && asset.locationId !== locationId) {
        continue;
      }
      if (searchLower) {
        const matchesName = asset.typeName?.toLowerCase().includes(searchLower);
        const matchesLoc = asset.locationName?.toLowerCase().includes(searchLower);
        const matchesFlag = asset.locationFlag?.toLowerCase().includes(searchLower);
        const matchesType = String(asset.typeId).includes(searchLower);
        if (!matchesName && !matchesLoc && !matchesFlag && !matchesType) {
          continue;
        }
      }
      matched.push(asset);
    }

    // Sort by typeName then quantity desc
    matched.sort((a, b) => {
      const nameComp = (a.typeName || '').localeCompare(b.typeName || '');
      if (nameComp !== 0) return nameComp;
      return b.quantity - a.quantity;
    });

    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;
    const items = matched.slice(offset, offset + validPageSize);

    return {
      items,
      total,
      page: validPage,
      pageSize: validPageSize,
    };
  }

  public getAllAssets(characterId?: number, characterIds?: number[]): CharacterAsset[] {
    const charFilterSet = characterIds && characterIds.length > 0
      ? new Set(characterIds)
      : characterId !== undefined
      ? new Set([characterId])
      : null;

    const result: CharacterAsset[] = [];
    for (const asset of this.assets.values()) {
      if (charFilterSet && !charFilterSet.has(asset.characterId)) {
        continue;
      }
      result.push(asset);
    }
    return result;
  }

  public getStockForType(typeId: number, locationId?: number, characterIds?: number[]): number {
    const charFilterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    let total = 0;

    for (const asset of this.assets.values()) {
      if (asset.typeId !== typeId) continue;
      if (locationId !== undefined && asset.locationId !== locationId) continue;
      if (charFilterSet && !charFilterSet.has(asset.characterId)) continue;
      total += asset.quantity;
    }

    return total;
  }

  public getStockBreakdown(typeId: number, characterIds?: number[]): AssetStockCheck {
    const charFilterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    const locationMap = new Map<number, { name: string; qty: number }>();
    let totalQuantity = 0;

    for (const asset of this.assets.values()) {
      if (asset.typeId !== typeId) continue;
      if (charFilterSet && !charFilterSet.has(asset.characterId)) continue;

      totalQuantity += asset.quantity;
      const existing = locationMap.get(asset.locationId);
      if (existing) {
        existing.qty += asset.quantity;
      } else {
        locationMap.set(asset.locationId, {
          name: asset.locationName || `Location #${asset.locationId}`,
          qty: asset.quantity,
        });
      }
    }

    const locations = Array.from(locationMap.entries()).map(([locId, data]) => ({
      locationId: locId,
      locationName: data.name,
      quantity: data.qty,
    }));

    return {
      typeId,
      totalQuantity,
      locations,
    };
  }

  public getSummary(characterId?: number, characterIds?: number[]): AssetSummaryMetrics {
    const charFilterSet = characterIds && characterIds.length > 0
      ? new Set(characterIds)
      : characterId !== undefined
      ? new Set([characterId])
      : null;

    const typeSet = new Set<number>();
    const locationSet = new Set<number>();
    const charSet = new Set<number>();
    let totalItems = 0;
    let totalQuantity = 0;

    for (const asset of this.assets.values()) {
      if (charFilterSet && !charFilterSet.has(asset.characterId)) {
        continue;
      }

      totalItems++;
      totalQuantity += asset.quantity;
      typeSet.add(asset.typeId);
      locationSet.add(asset.locationId);
      charSet.add(asset.characterId);
    }

    return {
      totalItems,
      distinctTypes: typeSet.size,
      distinctLocations: locationSet.size,
      totalQuantity,
      characterCount: charSet.size,
    };
  }

  public clearAssets(characterId: number): void {
    for (const [key, asset] of this.assets.entries()) {
      if (asset.characterId === characterId) {
        this.assets.delete(key);
      }
    }
  }

  public dumpData(): { assets: CharacterAsset[] } {
    return {
      assets: Array.from(this.assets.values()),
    };
  }

  public restoreData(data: { assets: CharacterAsset[] }): void {
    this.assets.clear();
    for (const asset of data.assets) {
      this.assets.set(asset.id, asset);
    }
  }
}

export const defaultAssetsRepository = new InMemoryAssetsRepository();
