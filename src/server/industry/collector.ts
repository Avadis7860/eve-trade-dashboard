import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';
import type { RawEsiIndustryJob, EsiCompleteness } from '../esi/types.ts';
import { logger } from '../utils/logger.ts';

export interface IndustryCollectorOptions {
  includeCompleted?: boolean;
  forceRevalidate?: boolean;
  signal?: AbortSignal;
}

export interface IndustryJobsCollectionResult {
  characterId: number;
  corporationId?: number;
  status: EsiCompleteness;
  characterJobs: RawEsiIndustryJob[];
  corporationJobs?: RawEsiIndustryJob[];
  totalJobs: number;
  durationMs: number;
  error?: string;
  asOf: number;
}

export class IndustryCollector {
  private esiClient: EsiClient;
  private charJobsStore: Map<number, RawEsiIndustryJob[]> = new Map();
  private corpJobsStore: Map<number, RawEsiIndustryJob[]> = new Map();

  constructor(esiClient: EsiClient = defaultEsiClient) {
    this.esiClient = esiClient;
  }

  /**
   * Collects industry jobs for a character (/characters/{character_id}/industry/jobs/)
   */
  public async collectCharacterJobs(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: IndustryCollectorOptions
  ): Promise<IndustryJobsCollectionResult> {
    const startTime = Date.now();
    const includeCompleted = options?.includeCompleted ?? true;

    try {
      const res = await this.esiClient.get<RawEsiIndustryJob[]>(
        `/characters/${characterId}/industry/jobs/`,
        {
          accessToken,
          refreshTokenFn,
          params: { include_completed: includeCompleted },
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
        }
      );

      const jobs = Array.isArray(res.data) ? res.data : [];
      this.charJobsStore.set(characterId, jobs);

      return {
        characterId,
        status: 'COMPLETE',
        characterJobs: jobs,
        totalJobs: jobs.length,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    } catch (err) {
      const errMsg = (err as Error).message || 'Character industry jobs sync failed';
      logger.error(`[IndustryCollector] Failed to fetch jobs for character ${characterId}: ${errMsg}`);

      const cached = this.charJobsStore.get(characterId) || [];
      return {
        characterId,
        status: cached.length > 0 ? 'PARTIAL' : 'ERROR',
        characterJobs: cached,
        totalJobs: cached.length,
        durationMs: Date.now() - startTime,
        error: errMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Collects industry jobs for a corporation (/corporations/{corporation_id}/industry/jobs/)
   * Handles 403 Forbidden gracefully when character lacks corporation industry manager roles.
   */
  public async collectCorporationJobs(
    characterId: number,
    corporationId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: IndustryCollectorOptions
  ): Promise<IndustryJobsCollectionResult> {
    const startTime = Date.now();
    const includeCompleted = options?.includeCompleted ?? true;

    try {
      const res = await this.esiClient.get<RawEsiIndustryJob[]>(
        `/corporations/${corporationId}/industry/jobs/`,
        {
          accessToken,
          refreshTokenFn,
          params: { include_completed: includeCompleted },
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
        }
      );

      const jobs = Array.isArray(res.data) ? res.data : [];
      this.corpJobsStore.set(corporationId, jobs);

      return {
        characterId,
        corporationId,
        status: 'COMPLETE',
        characterJobs: this.charJobsStore.get(characterId) || [],
        corporationJobs: jobs,
        totalJobs: jobs.length,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    } catch (err) {
      const errMsg = (err as Error).message || '';
      const isForbidden =
        errMsg.includes('403') ||
        errMsg.toLowerCase().includes('forbidden') ||
        errMsg.toLowerCase().includes('lacks');

      if (isForbidden) {
        logger.warn(
          `[IndustryCollector] Character ${characterId} lacks corporation industry roles for corp ${corporationId}. Marked PARTIAL.`
        );
        const cachedCorp = this.corpJobsStore.get(corporationId);
        return {
          characterId,
          corporationId,
          status: 'PARTIAL',
          characterJobs: this.charJobsStore.get(characterId) || [],
          corporationJobs: cachedCorp,
          totalJobs: cachedCorp ? cachedCorp.length : 0,
          durationMs: Date.now() - startTime,
          error: 'Lacks corporation industry roles',
          asOf: Date.now(),
        };
      }

      logger.error(
        `[IndustryCollector] Failed to fetch corp industry jobs for corp ${corporationId}: ${errMsg}`
      );
      return {
        characterId,
        corporationId,
        status: 'ERROR',
        characterJobs: this.charJobsStore.get(characterId) || [],
        totalJobs: 0,
        durationMs: Date.now() - startTime,
        error: errMsg || 'Corporation industry jobs sync failed',
        asOf: Date.now(),
      };
    }
  }

  public getStoredCharacterJobs(characterId: number): RawEsiIndustryJob[] {
    return this.charJobsStore.get(characterId) || [];
  }

  public getStoredCorporationJobs(corporationId: number): RawEsiIndustryJob[] {
    return this.corpJobsStore.get(corporationId) || [];
  }

  public clearCharacter(characterId: number): void {
    this.charJobsStore.delete(characterId);
  }
}

export const defaultIndustryCollector = new IndustryCollector();
