import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';
import type { EsiRateLimiter } from '../esi/rateLimiter.ts';
import { defaultEsiRateLimiter } from '../esi/rateLimiter.ts';
import type {
  RawEsiPlanet,
  RawEsiPlanetDetail,
  EsiCompleteness,
} from '../esi/types.ts';
import { logger } from '../utils/logger.ts';

export interface PiCollectorOptions {
  forceRevalidate?: boolean;
  signal?: AbortSignal;
  concurrencyLimit?: number; // Bounded to 3-4 max
  minErrorBudget?: number;   // Suspends ingestion if remaining budget < minErrorBudget (default 50)
}

export class PiBatchScheduler {
  private activeWorkers = 0;
  private maxConcurrent: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = Math.min(Math.max(maxConcurrent, 1), 4);
  }

  public setMaxConcurrent(limit: number): void {
    this.maxConcurrent = Math.min(Math.max(limit, 1), 4);
  }

  public async schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeWorkers >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeWorkers++;
    try {
      return await task();
    } finally {
      this.activeWorkers--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  public getActiveCount(): number {
    return this.activeWorkers;
  }
}

export const defaultPiBatchScheduler = new PiBatchScheduler(4);

export interface CharacterPlanetCollectionResult {
  characterId: number;
  status: EsiCompleteness;
  planets: RawEsiPlanet[];
  planetDetails: Record<number, RawEsiPlanetDetail>;
  planetsCount: number;
  pinsCount: number;
  durationMs: number;
  error?: string;
  suspendedDueToErrorBudget?: boolean;
  asOf: number;
}

export class PiCollector {
  private esiClient: EsiClient;
  private rateLimiter: EsiRateLimiter;
  private scheduler: PiBatchScheduler;
  private planetsStore: Map<number, RawEsiPlanet[]> = new Map();
  private planetDetailsStore: Map<string, RawEsiPlanetDetail> = new Map();

  constructor(
    esiClient: EsiClient = defaultEsiClient,
    rateLimiter: EsiRateLimiter = defaultEsiRateLimiter,
    scheduler: PiBatchScheduler = defaultPiBatchScheduler
  ) {
    this.esiClient = esiClient;
    this.rateLimiter = rateLimiter;
    this.scheduler = scheduler;
  }

  public getScheduler(): PiBatchScheduler {
    return this.scheduler;
  }

  private makePlanetKey(characterId: number, planetId: number): string {
    return `${characterId}:${planetId}`;
  }

  /**
   * Collects all planetary colonies and pin details for a character.
   * Respects HTTP cache (Expires / 304), bounds concurrency to 3-4 simultaneous pin queries,
   * and suspends execution if the CCP ESI error budget drops below the safety threshold.
   */
  public async collectPlanets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: PiCollectorOptions
  ): Promise<CharacterPlanetCollectionResult> {
    const startTime = Date.now();
    const minErrorBudget = options?.minErrorBudget ?? 50;
    const maxConcurrency = Math.min(Math.max(options?.concurrencyLimit ?? 3, 1), 4); // Bounded strictly to [1..4]

    // 1. Check ESI Error Budget Guard before even starting
    const initialRateStatus = this.rateLimiter.getStatus();
    if (initialRateStatus.errorLimitRemain < minErrorBudget) {
      logger.warn(
        `[PiCollector] ESI error budget guard triggered (${initialRateStatus.errorLimitRemain} < ${minErrorBudget}). Skipping character ${characterId} PI ingestion.`
      );
      const existingPlanets = this.planetsStore.get(characterId) || [];
      return {
        characterId,
        status: existingPlanets.length > 0 ? 'PARTIAL' : 'ABSENT',
        planets: existingPlanets,
        planetDetails: this.getAllStoredDetailsForCharacter(characterId),
        planetsCount: existingPlanets.length,
        pinsCount: 0,
        durationMs: Date.now() - startTime,
        error: `ESI error budget low (${initialRateStatus.errorLimitRemain}/${100})`,
        suspendedDueToErrorBudget: true,
        asOf: Date.now(),
      };
    }

    try {
      // 2. Fetch list of colonies: /characters/{character_id}/planets/
      const planetsRes = await this.esiClient.get<RawEsiPlanet[]>(
        `/characters/${characterId}/planets/`,
        {
          accessToken,
          refreshTokenFn,
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
        }
      );

      const planets = Array.isArray(planetsRes.data) ? planetsRes.data : [];
      this.planetsStore.set(characterId, planets);

      if (planets.length === 0) {
        return {
          characterId,
          status: 'COMPLETE',
          planets: [],
          planetDetails: {},
          planetsCount: 0,
          pinsCount: 0,
          durationMs: Date.now() - startTime,
          asOf: Date.now(),
        };
      }

      // 3. Sub-Batching Bounded Queue for Colony Pin Details (/characters/{character_id}/planets/{planet_id}/)
      const detailsMap: Record<number, RawEsiPlanetDetail> = {};
      let totalPins = 0;
      let hasError = false;
      let suspended = false;
      let lastErrorMessage: string | undefined;

      // Process planets in chunks of size maxConcurrency (3 to 4 max)
      for (let i = 0; i < planets.length; i += maxConcurrency) {
        if (options?.signal?.aborted) {
          throw options.signal.reason || new Error('PI collection aborted');
        }

        // Error Budget check before each sub-batch
        const currentRate = this.rateLimiter.getStatus();
        if (currentRate.errorLimitRemain < minErrorBudget) {
          logger.warn(
            `[PiCollector] Error budget dropped to ${currentRate.errorLimitRemain} during pin details ingestion. Suspending remaining ${planets.length - i} planets.`
          );
          suspended = true;
          break;
        }

        const batch = planets.slice(i, i + maxConcurrency);
        const batchPromises = batch.map((planet) =>
          this.scheduler.schedule(async () => {
            const detailKey = this.makePlanetKey(characterId, planet.planet_id);
            try {
              const detailRes = await this.esiClient.get<RawEsiPlanetDetail>(
                `/characters/${characterId}/planets/${planet.planet_id}/`,
                {
                  accessToken,
                  refreshTokenFn,
                  forceRevalidate: options?.forceRevalidate,
                  signal: options?.signal,
                }
              );

              if (detailRes.data && typeof detailRes.data === 'object') {
                this.planetDetailsStore.set(detailKey, detailRes.data);
                return { planetId: planet.planet_id, detail: detailRes.data };
              }
            } catch (err) {
              hasError = true;
              lastErrorMessage = (err as Error).message;
              logger.warn(
                `[PiCollector] Failed to fetch pin details for planet ${planet.planet_id}: ${(err as Error).message}`
              );
            }

            // Fallback to previous cached state if exists
            const existing = this.planetDetailsStore.get(detailKey);
            if (existing) {
              return { planetId: planet.planet_id, detail: existing };
            }
            return { planetId: planet.planet_id, detail: null };
          })
        );

        const batchResults = await Promise.all(batchPromises);
        for (const res of batchResults) {
          if (res.detail) {
            detailsMap[res.planetId] = res.detail;
            if (Array.isArray(res.detail.pins)) {
              totalPins += res.detail.pins.length;
            }
          }
        }
      }

      let completeness: EsiCompleteness = 'COMPLETE';
      if (suspended || hasError) {
        completeness = Object.keys(detailsMap).length > 0 ? 'PARTIAL' : 'ERROR';
      }

      return {
        characterId,
        status: completeness,
        planets,
        planetDetails: detailsMap,
        planetsCount: planets.length,
        pinsCount: totalPins,
        durationMs: Date.now() - startTime,
        error: lastErrorMessage,
        suspendedDueToErrorBudget: suspended,
        asOf: Date.now(),
      };
    } catch (err) {
      const errMsg = (err as Error).message || 'PI collection failed';
      logger.error(`[PiCollector] Planetary ingestion error for character ${characterId}: ${errMsg}`);

      const existingPlanets = this.planetsStore.get(characterId) || [];
      return {
        characterId,
        status: existingPlanets.length > 0 ? 'PARTIAL' : 'ERROR',
        planets: existingPlanets,
        planetDetails: this.getAllStoredDetailsForCharacter(characterId),
        planetsCount: existingPlanets.length,
        pinsCount: 0,
        durationMs: Date.now() - startTime,
        error: errMsg,
        asOf: Date.now(),
      };
    }
  }

  public getStoredPlanets(characterId: number): RawEsiPlanet[] {
    return this.planetsStore.get(characterId) || [];
  }

  public getStoredPlanetDetail(characterId: number, planetId: number): RawEsiPlanetDetail | null {
    return this.planetDetailsStore.get(this.makePlanetKey(characterId, planetId)) || null;
  }

  private getAllStoredDetailsForCharacter(characterId: number): Record<number, RawEsiPlanetDetail> {
    const result: Record<number, RawEsiPlanetDetail> = {};
    const planets = this.planetsStore.get(characterId) || [];
    for (const p of planets) {
      const detail = this.getStoredPlanetDetail(characterId, p.planet_id);
      if (detail) {
        result[p.planet_id] = detail;
      }
    }
    return result;
  }

  public clearCharacter(characterId: number): void {
    const planets = this.planetsStore.get(characterId) || [];
    for (const p of planets) {
      this.planetDetailsStore.delete(this.makePlanetKey(characterId, p.planet_id));
    }
    this.planetsStore.delete(characterId);
  }
}

export const defaultPiCollector = new PiCollector();
