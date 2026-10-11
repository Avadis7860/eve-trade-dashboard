import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';
import { fetchXPages } from '../esi/pagination.ts';
import type { RawEsiMiningEntry, EsiCompleteness } from '../esi/types.ts';
import { logger } from '../utils/logger.ts';

export interface MiningCollectorOptions {
  maxPages?: number;
  forceRevalidate?: boolean;
  signal?: AbortSignal;
}

export interface MiningLedgerCollectionResult {
  characterId: number;
  status: EsiCompleteness;
  entries: RawEsiMiningEntry[];
  totalQuantity: number;
  pagesFetched: number;
  durationMs: number;
  error?: string;
  asOf: number;
}

export class MiningCollector {
  private esiClient: EsiClient;
  private miningStore: Map<number, RawEsiMiningEntry[]> = new Map();

  constructor(esiClient: EsiClient = defaultEsiClient) {
    this.esiClient = esiClient;
  }

  /**
   * Collects mining ledger entries for a character (/characters/{character_id}/mining/)
   * using X-Pages pagination with HTTP cache validation.
   */
  public async collectMiningLedger(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: MiningCollectorOptions
  ): Promise<MiningLedgerCollectionResult> {
    const startTime = Date.now();
    const maxPages = options?.maxPages ?? 10;

    try {
      const paginated = await fetchXPages<RawEsiMiningEntry>(
        this.esiClient,
        `/characters/${characterId}/mining/`,
        {
          accessToken,
          refreshTokenFn,
          maxPages,
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
        }
      );

      const entries = paginated.data || [];
      this.miningStore.set(characterId, entries);

      const totalQuantity = entries.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

      return {
        characterId,
        status: paginated.status,
        entries,
        totalQuantity,
        pagesFetched: paginated.pagesFetched,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errMsg = (err as Error).message || 'Mining ledger sync failed';
      logger.error(`[MiningCollector] Failed to fetch mining ledger for character ${characterId}: ${errMsg}`);

      const cached = this.miningStore.get(characterId) || [];
      const totalQuantity = cached.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);

      return {
        characterId,
        status: cached.length > 0 ? 'PARTIAL' : 'ERROR',
        entries: cached,
        totalQuantity,
        pagesFetched: 0,
        durationMs: Date.now() - startTime,
        error: errMsg,
        asOf: Date.now(),
      };
    }
  }

  public getStoredMiningEntries(characterId: number): RawEsiMiningEntry[] {
    return this.miningStore.get(characterId) || [];
  }

  public clearCharacter(characterId: number): void {
    this.miningStore.delete(characterId);
  }
}

export const defaultMiningCollector = new MiningCollector();
