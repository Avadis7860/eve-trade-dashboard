import type { IAssetsRepository } from './repository.ts';
import { defaultAssetsRepository } from './repository.ts';
import type {
  CharacterAsset,
  AssetQueryFilters,
  AssetSummaryMetrics,
  AssetStockCheck,
} from './types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';

export class AssetsService {
  private repo: IAssetsRepository;

  constructor(repo: IAssetsRepository = defaultAssetsRepository) {
    this.repo = repo;
  }

  public getAssets(filters: AssetQueryFilters): {
    items: CharacterAsset[];
    total: number;
    page: number;
    pageSize: number;
  } {
    return this.repo.getAssets(filters);
  }

  public getAllAssets(characterId?: number, characterIds?: number[]): CharacterAsset[] {
    return this.repo.getAllAssets(characterId, characterIds);
  }

  public getStockForType(typeId: number, locationId?: number, characterIds?: number[]): number {
    return this.repo.getStockForType(typeId, locationId, characterIds);
  }

  public getStockBreakdown(typeId: number, characterIds?: number[]): AssetStockCheck {
    return this.repo.getStockBreakdown(typeId, characterIds);
  }

  public getSummary(characterId?: number, characterIds?: number[]): AssetSummaryMetrics {
    return this.repo.getSummary(characterId, characterIds);
  }

  /**
   * Enriches an order snapshot with real in-game asset quantity currently in stock at the order location
   */
  public enrichOrderWithStock(order: CharacterOrderSnapshot, characterIds?: number[]): CharacterOrderSnapshot {
    const inStockQuantity = this.repo.getStockForType(order.typeId, order.locationId, characterIds);
    return {
      ...order,
      inStockQuantity,
    };
  }
}

export const defaultAssetsService = new AssetsService();
