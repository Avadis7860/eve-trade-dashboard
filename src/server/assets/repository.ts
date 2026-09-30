import type {
  CharacterAsset,
  AssetQueryFilters,
  AssetSummaryMetrics,
  AssetStockCheck,
} from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

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

export class PersistentAssetsRepository implements IAssetsRepository {
  private assets: Map<string, CharacterAsset> = new Map();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.assets) {
        this.restoreData(state.data.assets, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.assets = {
        assets: Array.from(this.assets.values()),
      };
      this.adapter.persist();
    }
  }

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

    this.syncToStorage();
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
    this.syncToStorage();
  }

  public dumpData(): { assets: CharacterAsset[] } {
    return {
      assets: Array.from(this.assets.values()),
    };
  }

  public restoreData(data: { assets: CharacterAsset[] }, sync = true): void {
    this.assets.clear();
    for (const asset of data.assets) {
      this.assets.set(asset.id, asset);
    }
    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemoryAssetsRepository extends PersistentAssetsRepository {}

/**
 * PostgreSQL implementation of Assets Repository with parameterized SQL queries,
 * transactions and B-Tree indexed access.
 */
export class PostgresAssetsRepository implements IAssetsRepository {
  private fallbackMemory: PersistentAssetsRepository;

  constructor(private adapter: IDatabaseAdapter) {
    this.fallbackMemory = new PersistentAssetsRepository(null);
  }

  private mapRowToAsset(row: Record<string, unknown>): CharacterAsset {
    return {
      id: String(row.id),
      characterId: Number(row.character_id),
      itemId: Number(row.item_id),
      typeId: Number(row.type_id),
      typeName: row.type_name ? String(row.type_name) : undefined,
      quantity: Number(row.quantity),
      locationId: Number(row.location_id),
      locationName: row.location_name ? String(row.location_name) : undefined,
      locationType: row.location_type as CharacterAsset['locationType'],
      locationFlag: String(row.location_flag),
      isSingleton: Boolean(row.is_singleton),
      isCorpAsset: Boolean(row.is_corp_asset),
      corporationId: row.corporation_id ? Number(row.corporation_id) : undefined,
      source: row.source ? String(row.source) : 'esi',
      observedAt: Number(row.observed_at),
    };
  }

  public saveAssets(assets: CharacterAsset[]): { inserted: number; updated: number } {
    this.fallbackMemory.saveAssets(assets);
    this.saveAssetsAsync(assets).catch(() => {});
    return { inserted: assets.length, updated: 0 };
  }

  public async saveAssetsAsync(assets: CharacterAsset[]): Promise<{ inserted: number; updated: number }> {
    if (assets.length === 0) return { inserted: 0, updated: 0 };

    return await this.adapter.transaction(async (tx) => {
      let inserted = 0;
      for (const item of assets) {
        const sql = `
          INSERT INTO character_assets (
            id, character_id, item_id, type_id, type_name,
            quantity, location_id, location_name, location_type,
            location_flag, is_singleton, is_corp_asset, corporation_id, source, observed_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          )
          ON CONFLICT (id) DO UPDATE SET
            type_id = EXCLUDED.type_id,
            type_name = EXCLUDED.type_name,
            quantity = EXCLUDED.quantity,
            location_id = EXCLUDED.location_id,
            location_name = EXCLUDED.location_name,
            location_type = EXCLUDED.location_type,
            location_flag = EXCLUDED.location_flag,
            is_singleton = EXCLUDED.is_singleton,
            is_corp_asset = EXCLUDED.is_corp_asset,
            corporation_id = EXCLUDED.corporation_id,
            source = EXCLUDED.source,
            observed_at = EXCLUDED.observed_at
        `;
        const params = [
          item.id,
          item.characterId,
          item.itemId,
          item.typeId,
          item.typeName || null,
          item.quantity,
          item.locationId,
          item.locationName || null,
          item.locationType,
          item.locationFlag,
          item.isSingleton,
          item.isCorpAsset ?? false,
          item.corporationId || null,
          item.source || 'esi',
          item.observedAt || Date.now(),
        ];
        await tx.execute(sql, params);
        inserted++;
      }
      return { inserted, updated: 0 };
    });
  }

  public getAssets(filters: AssetQueryFilters): { items: CharacterAsset[]; total: number; page: number; pageSize: number } {
    return this.fallbackMemory.getAssets(filters);
  }

  public async getAssetsAsync(filters: AssetQueryFilters): Promise<{ items: CharacterAsset[]; total: number; page: number; pageSize: number }> {
    const {
      characterId,
      characterIds,
      typeId,
      locationId,
      search,
      page = 1,
      pageSize = 50,
    } = filters;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (characterIds && characterIds.length > 0) {
      conditions.push(`character_id = ANY($${paramIndex++})`);
      params.push(characterIds);
    } else if (characterId !== undefined) {
      conditions.push(`character_id = $${paramIndex++}`);
      params.push(characterId);
    }

    if (typeId !== undefined) {
      conditions.push(`type_id = $${paramIndex++}`);
      params.push(typeId);
    }
    if (locationId !== undefined) {
      conditions.push(`location_id = $${paramIndex++}`);
      params.push(locationId);
    }
    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(COALESCE(type_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(location_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(location_flag, '')) LIKE $${paramIndex} OR
        CAST(type_id AS TEXT) LIKE $${paramIndex}
      )`);
      params.push(s);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await this.adapter.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM character_assets WHERE ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.count || 0);

    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;

    const dataSql = `
      SELECT * FROM character_assets
      WHERE ${whereClause}
      ORDER BY type_name ASC, quantity DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataRes = await this.adapter.query(dataSql, [...params, validPageSize, offset]);
    const items = dataRes.rows.map((r) => this.mapRowToAsset(r));

    return { items, total, page: validPage, pageSize: validPageSize };
  }

  public getAllAssets(characterId?: number, characterIds?: number[]): CharacterAsset[] {
    return this.fallbackMemory.getAllAssets(characterId, characterIds);
  }

  public async getAllAssetsAsync(characterId?: number, characterIds?: number[]): Promise<CharacterAsset[]> {
    let sql = 'SELECT * FROM character_assets';
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId !== undefined) {
      sql += ' WHERE character_id = $1';
      params.push(characterId);
    }
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToAsset(r));
  }

  public getStockForType(typeId: number, locationId?: number, characterIds?: number[]): number {
    return this.fallbackMemory.getStockForType(typeId, locationId, characterIds);
  }

  public async getStockForTypeAsync(typeId: number, locationId?: number, characterIds?: number[]): Promise<number> {
    let sql = 'SELECT COALESCE(SUM(quantity), 0) as stock FROM character_assets WHERE type_id = $1';
    const params: unknown[] = [typeId];
    let paramIndex = 2;

    if (locationId !== undefined) {
      sql += ` AND location_id = $${paramIndex++}`;
      params.push(locationId);
    }
    if (characterIds && characterIds.length > 0) {
      sql += ` AND character_id = ANY($${paramIndex++})`;
      params.push(characterIds);
    }

    const res = await this.adapter.query<{ stock: string }>(sql, params);
    return Number(res.rows[0]?.stock || 0);
  }

  public getStockBreakdown(typeId: number, characterIds?: number[]): AssetStockCheck {
    return this.fallbackMemory.getStockBreakdown(typeId, characterIds);
  }

  public async getStockBreakdownAsync(typeId: number, characterIds?: number[]): Promise<AssetStockCheck> {
    let sql = `
      SELECT location_id, COALESCE(location_name, 'Location #' || location_id) as location_name, SUM(quantity) as quantity
      FROM character_assets
      WHERE type_id = $1
    `;
    const params: unknown[] = [typeId];
    if (characterIds && characterIds.length > 0) {
      sql += ' AND character_id = ANY($2)';
      params.push(characterIds);
    }
    sql += ' GROUP BY location_id, location_name';

    const res = await this.adapter.query<{ location_id: string; location_name: string; quantity: string }>(sql, params);
    let totalQuantity = 0;
    const locations = res.rows.map((r) => {
      const qty = Number(r.quantity || 0);
      totalQuantity += qty;
      return {
        locationId: Number(r.location_id),
        locationName: r.location_name,
        quantity: qty,
      };
    });

    return { typeId, totalQuantity, locations };
  }

  public getSummary(characterId?: number, characterIds?: number[]): AssetSummaryMetrics {
    return this.fallbackMemory.getSummary(characterId, characterIds);
  }

  public async getSummaryAsync(characterId?: number, characterIds?: number[]): Promise<AssetSummaryMetrics> {
    let sql = `
      SELECT
        COUNT(*) as total_items,
        COUNT(DISTINCT type_id) as distinct_types,
        COUNT(DISTINCT location_id) as distinct_locations,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COUNT(DISTINCT character_id) as character_count
      FROM character_assets
    `;
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId !== undefined) {
      sql += ' WHERE character_id = $1';
      params.push(characterId);
    }

    const res = await this.adapter.query(sql, params);
    const row = res.rows[0] || {};

    return {
      totalItems: Number(row.total_items || 0),
      distinctTypes: Number(row.distinct_types || 0),
      distinctLocations: Number(row.distinct_locations || 0),
      totalQuantity: Number(row.total_quantity || 0),
      characterCount: Number(row.character_count || 0),
    };
  }

  public clearAssets(characterId: number): void {
    this.fallbackMemory.clearAssets(characterId);
    this.clearAssetsAsync(characterId).catch(() => {});
  }

  public async clearAssetsAsync(characterId: number): Promise<void> {
    await this.adapter.execute('DELETE FROM character_assets WHERE character_id = $1', [characterId]);
  }

  public dumpData(): { assets: CharacterAsset[] } {
    return this.fallbackMemory.dumpData();
  }

  public restoreData(data: { assets: CharacterAsset[] }): void {
    this.fallbackMemory.restoreData(data);
    this.saveAssetsAsync(data.assets).catch(() => {});
  }
}

export const defaultAssetsRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresAssetsRepository(StorageManager.getInstance().getAdapter())
  : new PersistentAssetsRepository(StorageManager.getInstance().getAdapter());

