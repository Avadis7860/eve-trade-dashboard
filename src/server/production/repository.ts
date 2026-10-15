/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Dépôt de persistance dédié pour les allocations de coûts industriels et généalogies (production_cost_allocations).
 */

import type { ProductionCostAllocation } from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export interface IProductionRepository {
  init?(): Promise<void>;
  reset(): void;
  saveAllocation(allocation: ProductionCostAllocation): void;
  saveAllocations(allocations: ProductionCostAllocation[]): void;
  getAllocation(id: string): ProductionCostAllocation | undefined;
  getAllocationByJobId(jobId: number): ProductionCostAllocation | undefined;
  getAllocationsForOutputLot(outputLotId: string): ProductionCostAllocation | undefined;
  listAllocations(characterId?: number, characterIds?: number[], typeId?: number): ProductionCostAllocation[];
  deleteAllocation(id: string): boolean;
  clearCharacter(characterId: number): void;
  dumpData(): { allocations: ProductionCostAllocation[] };
  restoreData(data: { allocations: ProductionCostAllocation[] }, sync?: boolean): void;
}

export class PersistentProductionRepository implements IProductionRepository {
  private allocations = new Map<string, ProductionCostAllocation>();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.production?.allocations) {
        this.restoreData({ allocations: state.data.production.allocations }, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      const prev = state?.data?.production?.allocations ? [...state.data.production.allocations] : [];
      if (state?.data) {
        if (!state.data.production) {
          state.data.production = { allocations: [] };
        }
        state.data.production.allocations = Array.from(this.allocations.values());
      }
      try {
        this.adapter.persist();
      } catch (err) {
        if (state?.data?.production) {
          state.data.production.allocations = prev;
        }
        throw err;
      }
    }
  }

  reset(): void {
    const backup = new Map(this.allocations);
    this.allocations.clear();
    try {
      this.syncToStorage();
    } catch (err) {
      this.allocations = backup;
      throw err;
    }
  }

  saveAllocation(allocation: ProductionCostAllocation): void {
    const prev = this.allocations.get(allocation.id);
    this.allocations.set(allocation.id, { ...allocation });
    try {
      this.syncToStorage();
    } catch (err) {
      if (prev !== undefined) {
        this.allocations.set(allocation.id, prev);
      } else {
        this.allocations.delete(allocation.id);
      }
      throw err;
    }
  }

  saveAllocations(allocations: ProductionCostAllocation[]): void {
    if (allocations.length === 0) return;
    const backup = new Map(this.allocations);
    for (const alloc of allocations) {
      this.allocations.set(alloc.id, { ...alloc });
    }
    try {
      this.syncToStorage();
    } catch (err) {
      this.allocations = backup;
      throw err;
    }
  }

  getAllocation(id: string): ProductionCostAllocation | undefined {
    return this.allocations.get(id);
  }

  getAllocationByJobId(jobId: number): ProductionCostAllocation | undefined {
    for (const alloc of this.allocations.values()) {
      if (alloc.jobId === jobId) {
        return alloc;
      }
    }
    return undefined;
  }

  getAllocationsForOutputLot(outputLotId: string): ProductionCostAllocation | undefined {
    for (const alloc of this.allocations.values()) {
      if (alloc.outputLotId === outputLotId) {
        return alloc;
      }
    }
    return undefined;
  }

  listAllocations(characterId?: number, characterIds?: number[], typeId?: number): ProductionCostAllocation[] {
    const list = Array.from(this.allocations.values());
    if (characterIds && characterIds.length > 0) {
      const set = new Set(characterIds);
      return list.filter((a) => set.has(a.characterId) && (typeId === undefined || a.outputTypeId === typeId));
    }
    if (characterId !== undefined) {
      return list.filter((a) => a.characterId === characterId && (typeId === undefined || a.outputTypeId === typeId));
    }
    if (typeId !== undefined) {
      return list.filter((a) => a.outputTypeId === typeId);
    }
    return list;
  }

  deleteAllocation(id: string): boolean {
    const prev = this.allocations.get(id);
    if (!prev) return false;
    this.allocations.delete(id);
    try {
      this.syncToStorage();
      return true;
    } catch (err) {
      this.allocations.set(id, prev);
      throw err;
    }
  }

  clearCharacter(characterId: number): void {
    const backup = new Map(this.allocations);
    let modified = false;
    for (const [id, alloc] of Array.from(this.allocations.entries())) {
      if (alloc.characterId === characterId) {
        this.allocations.delete(id);
        modified = true;
      }
    }
    if (modified) {
      try {
        this.syncToStorage();
      } catch (err) {
        this.allocations = backup;
        throw err;
      }
    }
  }

  dumpData(): { allocations: ProductionCostAllocation[] } {
    return {
      allocations: Array.from(this.allocations.values()),
    };
  }

  restoreData(data: { allocations: ProductionCostAllocation[] }, sync = true): void {
    const backup = new Map(this.allocations);
    this.allocations.clear();
    for (const alloc of data.allocations) {
      this.allocations.set(alloc.id, alloc);
    }
    if (sync) {
      try {
        this.syncToStorage();
      } catch (err) {
        this.allocations = backup;
        throw err;
      }
    }
  }
}

export class PostgresProductionRepository implements IProductionRepository {
  constructor(private adapter: IDatabaseAdapter) {}

  private mapRowToAlloc(row: Record<string, unknown>): ProductionCostAllocation {
    let lineage = {} as ProductionCostAllocation['lineage'];
    try {
      lineage = JSON.parse(String(row.lineage_json || '{}'));
    } catch {
      // fallback
    }

    return {
      id: String(row.id),
      characterId: Number(row.character_id),
      jobId: row.job_id ? Number(row.job_id) : undefined,
      outputLotId: String(row.output_lot_id),
      outputTypeId: Number(row.output_type_id),
      outputTypeName: String(row.output_type_name || ''),
      outputQuantity: Number(row.output_quantity),
      unitCostIsk: row.unit_cost_isk !== null && row.unit_cost_isk !== undefined ? Number(row.unit_cost_isk) : null,
      totalCostIsk: row.total_cost_isk !== null && row.total_cost_isk !== undefined ? Number(row.total_cost_isk) : null,
      installationCostIsk: Number(row.installation_cost_isk || 0),
      customsTaxIsk: Number(row.customs_tax_isk || 0),
      inputsCostIsk: row.inputs_cost_isk !== null && row.inputs_cost_isk !== undefined ? Number(row.inputs_cost_isk) : null,
      costBasisStatus: row.cost_basis_status as ProductionCostAllocation['costBasisStatus'],
      provenance: row.provenance as ProductionCostAllocation['provenance'],
      lineage,
      allocatedAt: String(row.allocated_at),
      version: Number(row.version || 1),
    };
  }

  public reset(): void {
    this.resetAsync().catch(() => {});
  }

  public async resetAsync(): Promise<void> {
    await this.adapter.execute('DELETE FROM production_cost_allocations');
  }

  public saveAllocation(allocation: ProductionCostAllocation): void {
    this.saveAllocationAsync(allocation).catch(() => {});
  }

  public async saveAllocationAsync(allocation: ProductionCostAllocation): Promise<void> {
    const sql = `
      INSERT INTO production_cost_allocations (
        id, character_id, job_id, output_lot_id, output_type_id, output_type_name,
        output_quantity, unit_cost_isk, total_cost_isk, installation_cost_isk,
        customs_tax_isk, inputs_cost_isk, cost_basis_status, provenance, lineage_json,
        allocated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        output_quantity = EXCLUDED.output_quantity,
        unit_cost_isk = EXCLUDED.unit_cost_isk,
        total_cost_isk = EXCLUDED.total_cost_isk,
        installation_cost_isk = EXCLUDED.installation_cost_isk,
        customs_tax_isk = EXCLUDED.customs_tax_isk,
        inputs_cost_isk = EXCLUDED.inputs_cost_isk,
        cost_basis_status = EXCLUDED.cost_basis_status,
        lineage_json = EXCLUDED.lineage_json,
        allocated_at = EXCLUDED.allocated_at,
        version = EXCLUDED.version
    `;
    await this.adapter.execute(sql, [
      allocation.id,
      allocation.characterId,
      allocation.jobId ?? null,
      allocation.outputLotId,
      allocation.outputTypeId,
      allocation.outputTypeName,
      allocation.outputQuantity,
      allocation.unitCostIsk,
      allocation.totalCostIsk,
      allocation.installationCostIsk,
      allocation.customsTaxIsk,
      allocation.inputsCostIsk,
      allocation.costBasisStatus,
      allocation.provenance,
      JSON.stringify(allocation.lineage),
      allocation.allocatedAt,
      allocation.version,
    ]);
  }

  public saveAllocations(allocations: ProductionCostAllocation[]): void {
    for (const alloc of allocations) {
      this.saveAllocation(alloc);
    }
  }

  public getAllocation(id: string): ProductionCostAllocation | undefined {
    return this.getAllocationAsync(id) as unknown as (ProductionCostAllocation | undefined);
  }

  public async getAllocationAsync(id: string): Promise<ProductionCostAllocation | undefined> {
    const res = await this.adapter.query('SELECT * FROM production_cost_allocations WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToAlloc(res.rows[0]);
  }

  public getAllocationByJobId(jobId: number): ProductionCostAllocation | undefined {
    return this.getAllocationByJobIdAsync(jobId) as unknown as (ProductionCostAllocation | undefined);
  }

  public async getAllocationByJobIdAsync(jobId: number): Promise<ProductionCostAllocation | undefined> {
    const res = await this.adapter.query('SELECT * FROM production_cost_allocations WHERE job_id = $1 LIMIT 1', [jobId]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToAlloc(res.rows[0]);
  }

  public getAllocationsForOutputLot(outputLotId: string): ProductionCostAllocation | undefined {
    return this.getAllocationsForOutputLotAsync(outputLotId) as unknown as (ProductionCostAllocation | undefined);
  }

  public async getAllocationsForOutputLotAsync(outputLotId: string): Promise<ProductionCostAllocation | undefined> {
    const res = await this.adapter.query('SELECT * FROM production_cost_allocations WHERE output_lot_id = $1 LIMIT 1', [outputLotId]);
    if (res.rows.length === 0) return undefined;
    return this.mapRowToAlloc(res.rows[0]);
  }

  public listAllocations(characterId?: number, characterIds?: number[], typeId?: number): ProductionCostAllocation[] {
    return this.listAllocationsAsync(characterId, characterIds, typeId) as unknown as ProductionCostAllocation[];
  }

  public async listAllocationsAsync(characterId?: number, characterIds?: number[], typeId?: number): Promise<ProductionCostAllocation[]> {
    let sql = 'SELECT * FROM production_cost_allocations';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (characterIds && characterIds.length > 0) {
      params.push(characterIds);
      conditions.push(`character_id = ANY($${params.length})`);
    } else if (characterId !== undefined) {
      params.push(characterId);
      conditions.push(`character_id = $${params.length}`);
    }

    if (typeId !== undefined) {
      params.push(typeId);
      conditions.push(`output_type_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToAlloc(r));
  }

  public deleteAllocation(id: string): boolean {
    this.deleteAllocationAsync(id).catch(() => {});
    return true;
  }

  public async deleteAllocationAsync(id: string): Promise<boolean> {
    const res = await this.adapter.execute('DELETE FROM production_cost_allocations WHERE id = $1', [id]);
    return res > 0;
  }

  public clearCharacter(characterId: number): void {
    this.clearCharacterAsync(characterId).catch(() => {});
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    await this.adapter.execute('DELETE FROM production_cost_allocations WHERE character_id = $1', [characterId]);
  }

  public dumpData(): { allocations: ProductionCostAllocation[] } {
    return this.dumpDataAsync() as unknown as { allocations: ProductionCostAllocation[] };
  }

  public async dumpDataAsync(): Promise<{ allocations: ProductionCostAllocation[] }> {
    const res = await this.adapter.query('SELECT * FROM production_cost_allocations');
    return {
      allocations: res.rows.map((r) => this.mapRowToAlloc(r)),
    };
  }

  public restoreData(data: { allocations: ProductionCostAllocation[] }): void {
    this.restoreDataAsync(data).catch(() => {});
  }

  public async restoreDataAsync(data: { allocations: ProductionCostAllocation[] }): Promise<void> {
    for (const alloc of data.allocations) {
      await this.saveAllocationAsync(alloc);
    }
  }
}

export type ProductionRepository = IProductionRepository;
export const ProductionRepository = PersistentProductionRepository;

export const defaultProductionRepository: IProductionRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresProductionRepository(StorageManager.getInstance().getAdapter())
  : new PersistentProductionRepository(StorageManager.getInstance().getAdapter());

export const productionRepository = defaultProductionRepository;
