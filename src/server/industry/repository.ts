/**
 * Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)
 * Dépôt de persistance dédié pour les jobs d'industrie (industry_jobs)
 * Gère le stockage, l'indexation et la réconciliation des jobs de personnages et de corporations.
 */

import type {
  IndustryJob,
  IndustryJobFilters,
  IndustryJobFeeReconciliation,
} from './types.ts';
import { StorageManager } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import { logger } from '../utils/logger.ts';

export interface IIndustryRepository {
  saveJobs(jobs: IndustryJob[]): Promise<{ inserted: number; updated: number }>;
  getJobs(filters?: IndustryJobFilters): IndustryJob[];
  getJobById(jobId: number): IndustryJob | undefined;
  getActiveJobs(characterId?: number, characterIds?: number[]): IndustryJob[];
  getJobsForCharacters(characterIds: number[], filters?: IndustryJobFilters): IndustryJob[];
  updateJobFeeReconciliation(jobId: number, reconciliation: IndustryJobFeeReconciliation): void;
  deleteJobsForCharacter(characterId: number): Promise<void> | void;
  clearAll(): void;
}

export class IndustryRepository implements IIndustryRepository {
  private inMemoryJobs: Map<number, IndustryJob> = new Map();
  private adapter: IDatabaseAdapter;

  constructor(adapter?: IDatabaseAdapter) {
    this.adapter = adapter || StorageManager.getInstance().getAdapter();
    this.initFromStorage();
  }

  private initFromStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => { data?: { industry?: { jobs?: IndustryJob[] } } };
      };
      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        const stored = state?.data?.industry?.jobs;
        if (Array.isArray(stored)) {
          for (const job of stored) {
            this.inMemoryJobs.set(job.jobId, job);
          }
        }
      }
    } catch (err) {
      logger.warn(`[IndustryRepository] Could not initialize from storage state: ${(err as Error).message}`);
    }
  }

  private syncToStorage(): void {
    try {
      const adapterAny = this.adapter as {
        getState?: () => { data: { industry?: { jobs: IndustryJob[] } } };
        persist?: () => void;
      };
      if (typeof adapterAny.getState === 'function') {
        const state = adapterAny.getState();
        if (state && state.data) {
          if (!state.data.industry) {
            state.data.industry = { jobs: [] };
          }
          state.data.industry.jobs = Array.from(this.inMemoryJobs.values());
          if (typeof adapterAny.persist === 'function') {
            adapterAny.persist();
          }
        }
      }
    } catch (err) {
      logger.error(`[IndustryRepository] Failed to sync industry jobs to storage: ${(err as Error).message}`);
    }
  }

  /**
   * Persiste de manière idempotente des jobs d'industrie (INSERT OR UPDATE).
   * Conserve la réconciliation existante si déjà établie.
   */
  public async saveJobs(jobs: IndustryJob[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const job of jobs) {
      const existing = this.inMemoryJobs.get(job.jobId);
      if (existing) {
        // Préserver la réconciliation de frais existante si la mise à jour n'en fournit pas
        const preservedReconciliation = job.installationFeeReconciliation || existing.installationFeeReconciliation;
        this.inMemoryJobs.set(job.jobId, {
          ...existing,
          ...job,
          installationFeeReconciliation: preservedReconciliation,
        });
        updated++;
      } else {
        this.inMemoryJobs.set(job.jobId, job);
        inserted++;
      }
    }

    this.syncToStorage();
    return { inserted, updated };
  }

  /**
   * Récupère un job par son identifiant unique.
   */
  public getJobById(jobId: number): IndustryJob | undefined {
    return this.inMemoryJobs.get(jobId);
  }

  /**
   * Récupère les jobs filtrés selon les critères spécifiés.
   */
  public getJobs(filters?: IndustryJobFilters): IndustryJob[] {
    let jobs = Array.from(this.inMemoryJobs.values());

    if (!filters) {
      return jobs.sort((a, b) => b.jobId - a.jobId);
    }

    if (filters.characterId !== undefined) {
      jobs = jobs.filter((j) => j.characterId === filters.characterId);
    }

    if (filters.characterIds && filters.characterIds.length > 0) {
      const idSet = new Set(filters.characterIds);
      jobs = jobs.filter((j) => idSet.has(j.characterId));
    }

    if (filters.corporationId !== undefined) {
      jobs = jobs.filter((j) => j.corporationId === filters.corporationId);
    }

    if (filters.installerId !== undefined) {
      jobs = jobs.filter((j) => j.installerId === filters.installerId);
    }

    if (filters.status) {
      jobs = jobs.filter((j) => j.status.toLowerCase() === filters.status!.toLowerCase());
    }

    if (filters.activityId !== undefined) {
      jobs = jobs.filter((j) => j.activityId === filters.activityId);
    }

    if (filters.productTypeId !== undefined) {
      jobs = jobs.filter((j) => j.productTypeId === filters.productTypeId);
    }

    if (filters.blueprintTypeId !== undefined) {
      jobs = jobs.filter((j) => j.blueprintTypeId === filters.blueprintTypeId);
    }

    if (filters.source) {
      jobs = jobs.filter((j) => j.source === filters.source);
    }

    return jobs.sort((a, b) => b.jobId - a.jobId);
  }

  /**
   * Récupère les jobs actifs pour un ou plusieurs personnages.
   */
  public getActiveJobs(characterId?: number, characterIds?: number[]): IndustryJob[] {
    return this.getJobs({
      characterId,
      characterIds,
      status: 'active',
    });
  }

  /**
   * Récupère les jobs d'un groupe de personnages avec filtres additionnels.
   */
  public getJobsForCharacters(characterIds: number[], filters?: IndustryJobFilters): IndustryJob[] {
    return this.getJobs({
      ...filters,
      characterIds,
    });
  }

  /**
   * Met à jour la réconciliation des frais de pose d'un job.
   */
  public updateJobFeeReconciliation(jobId: number, reconciliation: IndustryJobFeeReconciliation): void {
    const job = this.inMemoryJobs.get(jobId);
    if (job) {
      job.installationFeeReconciliation = reconciliation;
      this.syncToStorage();
    }
  }

  /**
   * Supprime les jobs associés à un personnage.
   */
  public async deleteJobsForCharacter(characterId: number): Promise<void> {
    for (const [id, job] of this.inMemoryJobs.entries()) {
      if (job.characterId === characterId) {
        this.inMemoryJobs.delete(id);
      }
    }
    this.syncToStorage();
  }

  /**
   * Réinitialise le dépôt en mémoire (pour tests).
   */
  public clearAll(): void {
    this.inMemoryJobs.clear();
    this.syncToStorage();
  }
}

export const defaultIndustryRepository = new IndustryRepository();
