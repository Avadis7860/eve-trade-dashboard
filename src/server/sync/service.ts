import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';
import { fetchFromId, fetchXPages } from '../esi/pagination.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { ISyncRepository } from './repository.ts';
import { defaultSyncRepository } from './repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import type { IAssetsRepository } from '../assets/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import type { UniverseService } from '../universe/service.ts';
import { defaultUniverseService } from '../universe/service.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import type { RawEsiOrder, CharacterOrderSnapshot } from '../orders/types.ts';
import type { RawEsiAsset, CharacterAsset } from '../assets/types.ts';
import { evaluateOrderLifecycle, calculateExpirationIso } from '../orders/lifecycle.ts';
import type { SyncResult, SyncResourceType } from './types.ts';

export interface RawEsiTransaction {
  transaction_id: number;
  date: string;
  type_id: number;
  quantity: number;
  unit_price: number;
  is_buy: boolean;
  is_personal: boolean;
  journal_ref_id: number;
  location_id: number;
  client_id: number;
}

export interface RawEsiJournalEntry {
  id: number;
  date: string;
  ref_type: string;
  amount?: number;
  balance?: number;
  context_id?: number;
  context_id_type?: string;
  description: string;
  first_party_id?: number;
  second_party_id?: number;
  reason?: string;
  tax?: number;
  tax_receiver_id?: number;
}

export class SyncService {
  private esiClient: EsiClient;
  private ledgerRepo: ILedgerRepository;
  private ordersRepo: IOrdersRepository;
  private assetsRepo: IAssetsRepository;
  private syncRepo: ISyncRepository;
  private universeService: UniverseService;
  private inaccessibleCorpCharacters: Set<number> = new Set();

  constructor(
    esiClient: EsiClient = defaultEsiClient,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    ordersRepo: IOrdersRepository = defaultOrdersRepository,
    syncRepo: ISyncRepository = defaultSyncRepository,
    universeService: UniverseService = defaultUniverseService,
    assetsRepo: IAssetsRepository = defaultAssetsRepository
  ) {
    this.esiClient = esiClient;
    this.ledgerRepo = ledgerRepo;
    this.ordersRepo = ordersRepo;
    this.syncRepo = syncRepo;
    this.universeService = universeService;
    this.assetsRepo = assetsRepo;
  }

  /**
   * Synchronizes character wallet transactions using from_id cursor pagination
   */
  public async syncWalletTransactions(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxItems?: number }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_transactions';
    const startTime = Date.now();

    const previousState = this.syncRepo.getSyncState(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastSuccessfulId !== undefined &&
      previousState.hasMore === true;
    const initialFromId = shouldResume ? previousState.lastSuccessfulId : undefined;

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    let newCount = 0;

    try {
      const paginated = await fetchFromId<RawEsiTransaction>(
        this.esiClient,
        `/characters/${characterId}/wallet/transactions/`,
        {
          accessToken,
          refreshTokenFn,
          getIdFn: (tx) => tx.transaction_id,
          maxItems: options?.maxItems || 5000,
          pageSize: 2500,
          initialFromId,
          onBatchSuccess: async (lowestId, batchItems) => {
            if (batchItems.length > 0) {
              const typeIds = batchItems.map((tx) => tx.type_id);
              const locationIds = batchItems.map((tx) => tx.location_id);
              const clientIds = batchItems.map((tx) => tx.client_id);
              const allIds = [...typeIds, ...locationIds, ...clientIds];

              const nameMap = await this.universeService.resolveNames(allIds);
              const observedAt = Date.now();
              const transactions: CharacterTransaction[] = batchItems.map((raw) => {
                const typeName = nameMap.get(raw.type_id) || this.universeService.getNameSync(raw.type_id, 'Type');
                const locationName = nameMap.get(raw.location_id) || this.universeService.getNameSync(raw.location_id, 'Location');
                const clientName = nameMap.get(raw.client_id) || this.universeService.getNameSync(raw.client_id, 'Client');

                return {
                  id: `${characterId}:${raw.transaction_id}`,
                  characterId,
                  transactionId: raw.transaction_id,
                  date: raw.date,
                  typeId: raw.type_id,
                  typeName,
                  quantity: raw.quantity,
                  unitPrice: raw.unit_price,
                  totalValue: Number((raw.unit_price * raw.quantity).toFixed(2)),
                  isBuy: Boolean(raw.is_buy),
                  isPersonal: Boolean(raw.is_personal),
                  journalRefId: raw.journal_ref_id,
                  locationId: raw.location_id,
                  locationName,
                  clientId: raw.client_id,
                  clientName,
                  source: `/characters/${characterId}/wallet/transactions/`,
                  observedAt,
                };
              });

              const saveResult = this.ledgerRepo.saveTransactions(transactions);
              newCount += saveResult.inserted;

              const totalPersisted = this.ledgerRepo.countTransactions(characterId);
              this.syncRepo.updateSyncState(characterId, resource, {
                lastSuccessfulId: lowestId,
                totalRecords: totalPersisted,
                itemsCount: totalPersisted,
                newRecordsInLastSync: newCount,
              });
            }
          },
        }
      );

      const totalPersisted = this.ledgerRepo.countTransactions(characterId);
      const finalStatus = paginated.status;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        lastSyncCompletedAt: Date.now(),
        lastSuccessfulId: paginated.lastSuccessfulId,
        totalRecords: totalPersisted,
        itemsCount: totalPersisted,
        newRecordsInLastSync: newCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        itemsFetched: paginated.totalFetched,
        newItemsPersisted: newCount,
        totalPersisted,
        lastSuccessfulId: paginated.lastSuccessfulId,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Sync failed unexpectedly';
      const totalPersisted = this.ledgerRepo.countTransactions(characterId);

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalPersisted,
        itemsCount: totalPersisted,
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes character wallet journal entries
   */
  public async syncWalletJournal(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_journal';
    const startTime = Date.now();

    const previousState = this.syncRepo.getSyncState(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastPage !== undefined &&
      previousState.lastPage > 0 &&
      previousState.hasMore === true;
    const startPage = shouldResume ? previousState.lastPage! + 1 : 1;
    const maxPages = options?.maxPages || 5;

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    let newCount = 0;
    let highestPageFetched = previousState.lastPage || 0;

    try {
      const paginated = await fetchXPages<RawEsiJournalEntry>(
        this.esiClient,
        `/characters/${characterId}/wallet/journal/`,
        {
          accessToken,
          refreshTokenFn,
          startPage,
          maxPages,
          onPageSuccess: async (page, rawItems) => {
            if (page > highestPageFetched) {
              highestPageFetched = page;
            }
            if (rawItems.length > 0) {
              const observedAt = Date.now();
              const entries: CharacterWalletJournalEntry[] = (rawItems as RawEsiJournalEntry[]).map((raw) => ({
                id: `${characterId}:${raw.id}`,
                characterId,
                journalId: raw.id,
                date: raw.date,
                refType: raw.ref_type,
                amount: raw.amount,
                balance: raw.balance,
                contextId: raw.context_id,
                contextIdType: raw.context_id_type,
                description: raw.description,
                firstPartyId: raw.first_party_id,
                secondPartyId: raw.second_party_id,
                reason: raw.reason,
                tax: raw.tax,
                taxReceiverId: raw.tax_receiver_id,
                source: `/characters/${characterId}/wallet/journal/`,
                observedAt,
              }));

              const saveResult = this.ledgerRepo.saveJournalEntries(entries);
              newCount += saveResult.inserted;
            }

            const currentTotal = this.ledgerRepo.getJournalEntries(characterId, 1, 1).total;
            this.syncRepo.updateSyncState(characterId, resource, {
              lastPage: page,
              totalRecords: currentTotal,
              itemsCount: currentTotal,
              newRecordsInLastSync: newCount,
            });
          },
        }
      );

      const journalResult = this.ledgerRepo.getJournalEntries(characterId, 1, 1);
      const totalPersisted = journalResult.total;
      const finalStatus = paginated.status;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        lastSyncCompletedAt: Date.now(),
        lastPage: highestPageFetched || paginated.pagesFetched,
        totalRecords: totalPersisted,
        itemsCount: totalPersisted,
        newRecordsInLastSync: newCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        itemsFetched: paginated.totalFetched,
        newItemsPersisted: newCount,
        totalPersisted,
        lastPage: highestPageFetched || paginated.pagesFetched,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Journal sync failed';
      const journalResult = this.ledgerRepo.getJournalEntries(characterId, 1, 1);

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        totalRecords: journalResult.total,
        itemsCount: journalResult.total,
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: journalResult.total,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes character active orders and historical orders
   */
  public async syncCharacterOrders(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_orders';
    const startTime = Date.now();
    const observedAt = Date.now();

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      // 1. Fetch active orders
      const activeRes = await this.esiClient.get<RawEsiOrder[]>(
        `/characters/${characterId}/orders/`,
        { accessToken, refreshTokenFn }
      );

      const rawActive = Array.isArray(activeRes.data) ? activeRes.data : [];

      // 2. Fetch historical orders (up to 3 pages)
      let rawHistory: RawEsiOrder[] = [];
      try {
        const historyRes = await fetchXPages<RawEsiOrder>(
          this.esiClient,
          `/characters/${characterId}/orders/history/`,
          { accessToken, refreshTokenFn, maxPages: 3 }
        );
        rawHistory = historyRes.data || [];
      } catch (histErr) {
        console.warn('[SyncService] Historical orders fetch skipped:', (histErr as Error).message);
      }

      // 3. Resolve universe names
      const allTypeIds = [...rawActive.map((o) => o.type_id), ...rawHistory.map((o) => o.type_id)];
      const allLocationIds = [...rawActive.map((o) => o.location_id), ...rawHistory.map((o) => o.location_id)];
      const nameMap = await this.universeService.resolveNames([...allTypeIds, ...allLocationIds]);

      // 4. Track active order IDs
      const activeOrderIds = new Set<number>(rawActive.map((o) => o.order_id));

      // 5. Build snapshots for active orders
      const snapshots: CharacterOrderSnapshot[] = [];

      for (const raw of rawActive) {
        const existing = this.ordersRepo.getOrderById(characterId, raw.order_id);
        const classification = evaluateOrderLifecycle(raw, existing || undefined, false);
        const expiresAt = calculateExpirationIso(raw.issued, raw.duration);

        snapshots.push({
          id: `${characterId}:${raw.order_id}`,
          characterId,
          orderId: raw.order_id,
          typeId: raw.type_id,
          typeName: nameMap.get(raw.type_id) || this.universeService.getNameSync(raw.type_id, 'Type'),
          regionId: raw.region_id,
          locationId: raw.location_id,
          locationName: nameMap.get(raw.location_id) || this.universeService.getNameSync(raw.location_id, 'Location'),
          isBuyOrder: Boolean(raw.is_buy_order),
          price: raw.price,
          volumeTotal: raw.volume_total,
          volumeRemain: raw.volume_remain,
          volumeFilled: classification.volumeFilled,
          issued: raw.issued,
          duration: raw.duration,
          expiresAt,
          minVolume: raw.min_volume,
          escrow: raw.escrow,
          state: classification.state,
          stateJustification: classification.justification,
          firstObservedAt: existing ? existing.firstObservedAt : observedAt,
          lastObservedAt: observedAt,
          lastSnapshotVolumeRemain: existing ? existing.volumeRemain : raw.volume_remain,
          isActiveInCurrentSnapshot: true,
          source: `/characters/${characterId}/orders/`,
        });
      }

      // 6. Build snapshots for historical orders (confirmations of completion / cancellation / expiration)
      for (const raw of rawHistory) {
        const existing = this.ordersRepo.getOrderById(characterId, raw.order_id);
        const classification = evaluateOrderLifecycle(raw, existing || undefined, true);
        const expiresAt = calculateExpirationIso(raw.issued, raw.duration);

        snapshots.push({
          id: `${characterId}:${raw.order_id}`,
          characterId,
          orderId: raw.order_id,
          typeId: raw.type_id,
          typeName: nameMap.get(raw.type_id) || this.universeService.getNameSync(raw.type_id, 'Type'),
          regionId: raw.region_id,
          locationId: raw.location_id,
          locationName: nameMap.get(raw.location_id) || this.universeService.getNameSync(raw.location_id, 'Location'),
          isBuyOrder: Boolean(raw.is_buy_order),
          price: raw.price,
          volumeTotal: raw.volume_total,
          volumeRemain: raw.volume_remain,
          volumeFilled: classification.volumeFilled,
          issued: raw.issued,
          duration: raw.duration,
          expiresAt,
          minVolume: raw.min_volume,
          escrow: raw.escrow,
          state: classification.state,
          stateJustification: classification.justification,
          firstObservedAt: existing ? existing.firstObservedAt : observedAt,
          lastObservedAt: observedAt,
          lastSnapshotVolumeRemain: raw.volume_remain,
          isActiveInCurrentSnapshot: false,
          source: `/characters/${characterId}/orders/history/`,
        });
      }

      // 7. Save snapshots
      const saveResult = this.ordersRepo.saveOrderSnapshots(snapshots);

      // 8. Mark missing previously-active orders as DISAPPEARED_UNCONFIRMED
      this.ordersRepo.markMissingOrdersAsDisappeared(characterId, activeOrderIds, observedAt);

      const totalTracked = this.ordersRepo.getOrdersForCharacter(characterId).length;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'COMPLETE',
        coverageStatus: 'COMPLETE',
        hasMore: false,
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalTracked,
        itemsCount: totalTracked,
        newRecordsInLastSync: saveResult.inserted,
      });

      return {
        resource,
        characterId,
        status: 'COMPLETE',
        coverageStatus: 'COMPLETE',
        hasMore: false,
        itemsFetched: rawActive.length + rawHistory.length,
        newItemsPersisted: saveResult.inserted,
        totalPersisted: totalTracked,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Orders sync failed';
      const totalTracked = this.ordersRepo.getOrdersForCharacter(characterId).length;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalTracked,
        itemsCount: totalTracked,
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: totalTracked,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes corporation wallet journal entries (tax and broker fees) if the character has corp roles
   */
  public async syncCorporationWallets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<void> {
    if (this.inaccessibleCorpCharacters.has(characterId)) return;

    try {
      // 1. Fetch character public info to get corporation_id
      const charInfoRes = await this.esiClient.get<{ corporation_id: number }>(`/characters/${characterId}/`, {
        accessToken,
        refreshTokenFn,
      });

      const corpId = charInfoRes.data?.corporation_id;
      // In EVE Online, NPC corporations have IDs < 2,000,000 and do not have player-accessible wallets
      if (!corpId || corpId < 2000000) return;

      // 2. Fetch corporation divisions (wallets)
      let divisions: Array<{ division: number; balance: number }> = [];
      try {
        const divisionsRes = await this.esiClient.get<Array<{ division: number; balance: number }>>(
          `/corporations/${corpId}/wallets/`,
          { accessToken, refreshTokenFn }
        );
        if (Array.isArray(divisionsRes.data) && divisionsRes.data.length > 0) {
          divisions = divisionsRes.data;
        }
      } catch {
        // If 403 Forbidden or scope error, character lacks corp wallet roles - mark and stop immediately
        this.inaccessibleCorpCharacters.add(characterId);
        return;
      }

      if (divisions.length === 0) return;

      for (const div of divisions) {
        const divisionNumber = div.division || 1;
        try {
          // Fetch journal for division (containing transaction_tax and brokers_fee)
          const paginatedJournal = await fetchXPages<RawEsiJournalEntry>(
            this.esiClient,
            `/corporations/${corpId}/wallets/${divisionNumber}/journal/`,
            {
              accessToken,
              refreshTokenFn,
              maxPages: 3,
            }
          );

          if (paginatedJournal.data && paginatedJournal.data.length > 0) {
            const observedAt = Date.now();
            const entries: CharacterWalletJournalEntry[] = paginatedJournal.data.map((raw) => ({
              id: `${characterId}:corp:${corpId}:${raw.id}`,
              characterId,
              journalId: raw.id,
              date: raw.date,
              refType: raw.ref_type,
              amount: raw.amount,
              balance: raw.balance,
              contextId: raw.context_id,
              contextIdType: raw.context_id_type,
              description: raw.description,
              firstPartyId: raw.first_party_id,
              secondPartyId: raw.second_party_id,
              reason: raw.reason,
              tax: raw.tax,
              taxReceiverId: raw.tax_receiver_id,
              source: `/corporations/${corpId}/wallets/${divisionNumber}/journal/`,
              observedAt,
            }));
            this.ledgerRepo.saveJournalEntries(entries);
          }
        } catch {
          // Ignore division errors (e.g. 403 lack of role for specific division)
        }
      }
    } catch (err) {
      this.inaccessibleCorpCharacters.add(characterId);
      console.warn(`[SyncService] Corporation wallet sync not accessible for character ${characterId}: ${(err as Error).message}`);
    }
  }

  /**
   * Synchronizes character assets from ESI using X-Pages pagination
   */
  public async syncCharacterAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_assets';
    const startTime = Date.now();
    const observedAt = Date.now();

    const previousState = this.syncRepo.getSyncState(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastPage !== undefined &&
      previousState.lastPage > 0 &&
      previousState.hasMore === true;
    const startPage = shouldResume ? previousState.lastPage! + 1 : 1;
    const maxPages = options?.maxPages || 10;

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    let newCount = 0;
    let highestPageFetched = previousState.lastPage || 0;

    try {
      const paginated = await fetchXPages<RawEsiAsset>(
        this.esiClient,
        `/characters/${characterId}/assets/`,
        {
          accessToken,
          refreshTokenFn,
          startPage,
          maxPages,
          onPageSuccess: async (page, rawItems) => {
            if (page > highestPageFetched) {
              highestPageFetched = page;
            }
            if (rawItems.length > 0) {
              const typedItems = rawItems as RawEsiAsset[];
              // Collect type IDs and universe location IDs (exclude nested item IDs which cannot be resolved via /universe/names/)
              const typeIds = typedItems.map((a) => a.type_id);
              const nonItemLocationIds = typedItems
                .filter((a) => a.location_type !== 'item')
                .map((a) => a.location_id);
              const nameMap = await this.universeService.resolveNames([...typeIds, ...nonItemLocationIds]);

              const assets: CharacterAsset[] = typedItems.map((raw) => {
                const typeName = nameMap.get(raw.type_id) || this.universeService.getNameSync(raw.type_id, 'Type');
                const locationName = raw.location_type === 'item'
                  ? `Container #${raw.location_id}`
                  : (nameMap.get(raw.location_id) || this.universeService.getNameSync(raw.location_id, 'Location'));

                return {
                  id: `${characterId}:${raw.item_id}`,
                  characterId,
                  itemId: raw.item_id,
                  typeId: raw.type_id,
                  typeName,
                  quantity: raw.quantity,
                  locationId: raw.location_id,
                  locationName,
                  locationType: raw.location_type,
                  locationFlag: raw.location_flag,
                  isSingleton: Boolean(raw.is_singleton),
                  isCorpAsset: false,
                  source: `/characters/${characterId}/assets/`,
                  observedAt,
                };
              });

              const saveResult = this.assetsRepo.saveAssets(assets);
              newCount += saveResult.inserted;
            }

            const currentTotal = this.assetsRepo.getAllAssets(characterId).length;
            this.syncRepo.updateSyncState(characterId, resource, {
              lastPage: page,
              totalRecords: currentTotal,
              itemsCount: currentTotal,
              newRecordsInLastSync: newCount,
            });
          },
        }
      );

      const totalPersisted = this.assetsRepo.getAllAssets(characterId).length;
      const finalStatus = paginated.status;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        lastSyncCompletedAt: Date.now(),
        lastPage: highestPageFetched || paginated.pagesFetched,
        totalRecords: totalPersisted,
        itemsCount: totalPersisted,
        newRecordsInLastSync: newCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        coverageStatus: finalStatus,
        hasMore: paginated.hasMore,
        itemsFetched: paginated.totalFetched,
        newItemsPersisted: newCount,
        totalPersisted,
        lastPage: highestPageFetched || paginated.pagesFetched,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Assets sync failed';
      const totalPersisted = this.assetsRepo.getAllAssets(characterId).length;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalPersisted,
        itemsCount: totalPersisted,
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes corporation assets if the character has corp director roles
   */
  public async syncCorporationAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<void> {
    if (this.inaccessibleCorpCharacters.has(characterId)) return;

    try {
      const charInfoRes = await this.esiClient.get<{ corporation_id: number }>(`/characters/${characterId}/`, {
        accessToken,
        refreshTokenFn,
      });

      const corpId = charInfoRes.data?.corporation_id;
      if (!corpId || corpId < 2000000) return;

      const paginated = await fetchXPages<RawEsiAsset>(
        this.esiClient,
        `/corporations/${corpId}/assets/`,
        {
          accessToken,
          refreshTokenFn,
          maxPages: 10,
        }
      );

      if (paginated.status === 'ERROR' && paginated.error?.includes('Forbidden')) {
        this.inaccessibleCorpCharacters.add(characterId);
        return;
      }

      const rawItems = paginated.data;
      if (rawItems.length > 0) {
        const typeIds = rawItems.map((a) => a.type_id);
        const nonItemLocationIds = rawItems
          .filter((a) => a.location_type !== 'item')
          .map((a) => a.location_id);
        const nameMap = await this.universeService.resolveNames([...typeIds, ...nonItemLocationIds]);
        const observedAt = Date.now();

        const assets: CharacterAsset[] = rawItems.map((raw) => {
          const typeName = nameMap.get(raw.type_id) || this.universeService.getNameSync(raw.type_id, 'Type');
          const locationName = raw.location_type === 'item'
            ? `Container #${raw.location_id}`
            : (nameMap.get(raw.location_id) || this.universeService.getNameSync(raw.location_id, 'Location'));

          return {
            id: `corp:${corpId}:${raw.item_id}`,
            characterId,
            itemId: raw.item_id,
            typeId: raw.type_id,
            typeName,
            quantity: raw.quantity,
            locationId: raw.location_id,
            locationName,
            locationType: raw.location_type,
            locationFlag: raw.location_flag,
            isSingleton: Boolean(raw.is_singleton),
            isCorpAsset: true,
            corporationId: corpId,
            source: `/corporations/${corpId}/assets/`,
            observedAt,
          };
        });

        this.assetsRepo.saveAssets(assets);
      }
    } catch (err) {
      console.warn(`[SyncService] Corporation assets sync skipped for character ${characterId}: ${(err as Error).message}`);
    }
  }

  /**
   * Synchronizes all character data (wallet transactions, journal, market orders, corporation wallet, character & corporation assets)
   */
  public async syncAll(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<{ transactions: SyncResult; journal: SyncResult; orders: SyncResult; assets: SyncResult }> {
    const transactions = await this.syncWalletTransactions(characterId, accessToken, refreshTokenFn);
    const journal = await this.syncWalletJournal(characterId, accessToken, refreshTokenFn);
    const orders = await this.syncCharacterOrders(characterId, accessToken, refreshTokenFn);
    const assets = await this.syncCharacterAssets(characterId, accessToken, refreshTokenFn);
    await this.syncCorporationWallets(characterId, accessToken, refreshTokenFn);
    await this.syncCorporationAssets(characterId, accessToken, refreshTokenFn);

    return { transactions, journal, orders, assets };
  }
}

export const defaultSyncService = new SyncService();
