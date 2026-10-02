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
import { SyncCoordinator, defaultSyncCoordinator } from './coordinator.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import { makeJournalEntryKey } from '../ledger/types.ts';
import type { RawEsiOrder, CharacterOrderSnapshot } from '../orders/types.ts';
import type { RawEsiAsset, CharacterAsset } from '../assets/types.ts';
import { evaluateOrderLifecycle, calculateExpirationIso } from '../orders/lifecycle.ts';
import type { SyncResult, SyncResourceType, SyncAllResult, DivisionSyncStatus, SyncStatusState } from './types.ts';
import type { IWalletRepository } from '../ledger/walletRepository.ts';
import { defaultWalletRepository } from '../ledger/walletRepository.ts';
import type { WalletBalanceSnapshot, WalletSyncMode } from '../capital/types.ts';

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
  private walletRepo: IWalletRepository;
  private syncRepo: ISyncRepository;
  private universeService: UniverseService;
  private coordinator: SyncCoordinator;
  private inaccessibleCorpCharacters: Set<number> = new Set();

  constructor(
    esiClient: EsiClient = defaultEsiClient,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    ordersRepo: IOrdersRepository = defaultOrdersRepository,
    syncRepo: ISyncRepository = defaultSyncRepository,
    universeService: UniverseService = defaultUniverseService,
    assetsRepo: IAssetsRepository = defaultAssetsRepository,
    coordinator: SyncCoordinator = defaultSyncCoordinator,
    walletRepo: IWalletRepository = defaultWalletRepository
  ) {
    this.esiClient = esiClient;
    this.ledgerRepo = ledgerRepo;
    this.ordersRepo = ordersRepo;
    this.syncRepo = syncRepo;
    this.universeService = universeService;
    this.assetsRepo = assetsRepo;
    this.coordinator = coordinator;
    this.walletRepo = walletRepo;
  }

  public getCoordinator(): SyncCoordinator {
    return this.coordinator;
  }

  /**
   * Synchronizes character wallet transactions using from_id cursor pagination with in-flight coalescing
   */
  public async syncWalletTransactions(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxItems?: number; forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:wallet_transactions`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncWalletTransactions(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncWalletTransactions(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxItems?: number; forceRevalidate?: boolean; signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_transactions';
    const startTime = Date.now();

    const previousState = await this.syncRepo.getSyncStateAsync(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastSuccessfulId !== undefined &&
      previousState.hasMore === true;
    const initialFromId = shouldResume ? previousState.lastSuccessfulId : undefined;

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
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
              await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
   * Synchronizes character wallet journal entries with in-flight coalescing
   */
  public async syncWalletJournal(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:wallet_journal`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncWalletJournal(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncWalletJournal(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean; signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_journal';
    const startTime = Date.now();

    const previousState = await this.syncRepo.getSyncStateAsync(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastPage !== undefined &&
      previousState.lastPage > 0 &&
      previousState.hasMore === true;
    const startPage = shouldResume ? previousState.lastPage! + 1 : 1;
    const maxPages = options?.maxPages || 5;

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
          onPageSuccess: async (page, rawItems) => {
            if (page > highestPageFetched) {
              highestPageFetched = page;
            }
            if (rawItems.length > 0) {
              const observedAt = Date.now();
              const entries: CharacterWalletJournalEntry[] = (rawItems as RawEsiJournalEntry[]).map((raw) => ({
                id: makeJournalEntryKey({ characterId, journalId: raw.id }),
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
                observedByCharacterIds: [characterId],
              }));

              const saveResult = this.ledgerRepo.saveJournalEntries(entries);
              newCount += saveResult.inserted;
            }

            const currentTotal = this.ledgerRepo.getJournalEntries(characterId, 1, 1).total;
            await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
   * Synchronizes character active orders and historical orders with in-flight coalescing
   */
  public async syncCharacterOrders(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_orders`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncCharacterOrders(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncCharacterOrders(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean; signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_orders';
    const startTime = Date.now();
    const observedAt = Date.now();

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      // 1. Fetch active orders
      const activeRes = await this.esiClient.get<RawEsiOrder[]>(
        `/characters/${characterId}/orders/`,
        { accessToken, refreshTokenFn, forceRevalidate: options?.forceRevalidate, signal: options?.signal }
      );

      const rawActive = Array.isArray(activeRes.data) ? activeRes.data : [];

      // 2. Fetch historical orders (up to 3 pages)
      let rawHistory: RawEsiOrder[] = [];
      let historyFailed = false;
      let historyErrorMsg: string | undefined;

      try {
        const historyRes = await fetchXPages<RawEsiOrder>(
          this.esiClient,
          `/characters/${characterId}/orders/history/`,
          { accessToken, refreshTokenFn, maxPages: 3, forceRevalidate: options?.forceRevalidate, signal: options?.signal }
        );
        rawHistory = historyRes.data || [];
        if (historyRes.status === 'ERROR' || historyRes.status === 'PARTIAL') {
          historyFailed = true;
          historyErrorMsg = historyRes.error || `Historical orders fetch incomplete (${historyRes.status})`;
        }
      } catch (histErr) {
        historyFailed = true;
        historyErrorMsg = (histErr as Error).message || 'Historical orders fetch failed';
        console.warn('[SyncService] Historical orders fetch failed:', historyErrorMsg);
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
      const finalStatus = historyFailed ? 'PARTIAL' : 'COMPLETE';
      const coverageStatus = historyFailed ? 'PARTIAL' : 'COMPLETE';

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: finalStatus,
        coverageStatus,
        hasMore: historyFailed,
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalTracked,
        itemsCount: totalTracked,
        newRecordsInLastSync: saveResult.inserted,
        errorMessage: historyFailed ? historyErrorMsg : undefined,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        coverageStatus,
        hasMore: historyFailed,
        error: historyFailed ? historyErrorMsg : undefined,
        itemsFetched: rawActive.length + rawHistory.length,
        newItemsPersisted: saveResult.inserted,
        totalPersisted: totalTracked,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Orders sync failed';
      const totalTracked = this.ordersRepo.getOrdersForCharacter(characterId).length;

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
   * Synchronizes real character wallet balance directly from GET /characters/{character_id}/wallet
   */
  public async syncCharacterWallet(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_wallet`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncCharacterWallet(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncCharacterWallet(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean; signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_wallet';
    const startTime = Date.now();
    const observedAt = Date.now();

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      const res = await this.esiClient.get<number>(
        `/characters/${characterId}/wallet/`,
        { accessToken, refreshTokenFn, forceRevalidate: options?.forceRevalidate, signal: options?.signal }
      );

      const rawData = res.data as unknown;
      if (
        rawData === null ||
        rawData === undefined ||
        typeof rawData === 'boolean' ||
        typeof rawData === 'object' ||
        (typeof rawData === 'string' && rawData.trim() === '')
      ) {
        throw new Error(`Invalid wallet balance received from ESI: expected number, got ${JSON.stringify(rawData)}`);
      }

      const balance = typeof rawData === 'number' ? rawData : Number(rawData);
      if (!Number.isFinite(balance) || isNaN(balance)) {
        throw new Error(`Invalid wallet balance received from ESI: non-finite or NaN value ${rawData}`);
      }
      const characterName = this.universeService.getNameSync(characterId, 'Character');

      const snapshot: WalletBalanceSnapshot = {
        id: `char:${characterId}`,
        type: 'CHARACTER',
        characterId,
        characterName,
        balance,
        observedAt,
        observedByCharacterId: characterId,
        source: `/characters/${characterId}/wallet/`,
        isIncludedInLiquid: true,
      };

      this.walletRepo.saveWalletSnapshot(snapshot);

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: 'COMPLETE',
        coverageStatus: 'COMPLETE',
        hasMore: false,
        lastSyncCompletedAt: Date.now(),
        totalRecords: 1,
        itemsCount: 1,
        newRecordsInLastSync: 1,
      });

      return {
        resource,
        characterId,
        status: 'COMPLETE',
        coverageStatus: 'COMPLETE',
        hasMore: false,
        itemsFetched: 1,
        newItemsPersisted: 1,
        totalPersisted: 1,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Character wallet balance sync failed';

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        totalRecords: 0,
        itemsCount: 0,
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes corporation wallets (real balances, division names, and division journals) if the character has corp roles
   */
  public async syncCorporationWallets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: {
      walletSyncMode?: WalletSyncMode;
      resume?: boolean;
      maxPages?: number;
      forceRevalidate?: boolean;
    }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:corporation_wallets`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncCorporationWallets(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncCorporationWallets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: {
      walletSyncMode?: WalletSyncMode;
      resume?: boolean;
      maxPages?: number;
      forceRevalidate?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'corporation_wallets';
    const startTime = Date.now();

    if (options?.walletSyncMode === 'CHARACTERS_ONLY') {
      return {
        resource,
        characterId,
        status: 'COMPLETE',
        coverageStatus: 'COMPLETE',
        hasMore: false,
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        asOf: Date.now(),
      };
    }

    if (this.inaccessibleCorpCharacters.has(characterId)) {
      return {
        resource,
        characterId,
        status: 'PARTIAL',
        coverageStatus: 'PARTIAL',
        hasMore: false,
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        error: 'Corporation wallets inaccessible or forbidden for this character',
        asOf: Date.now(),
      };
    }

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    const previousState = await this.syncRepo.getSyncStateAsync(characterId, resource);

    try {
      // 1. Fetch character public info to get corporation_id
      const charInfoRes = await this.esiClient.get<{ corporation_id: number }>(`/characters/${characterId}/`, {
        accessToken,
        refreshTokenFn,
        forceRevalidate: options?.forceRevalidate,
        signal: options?.signal,
      });

      const corpId = charInfoRes.data?.corporation_id;
      // In EVE Online, NPC corporations have IDs < 2,000,000 and do not have player-accessible wallets
      if (!corpId || corpId < 2000000) {
        await this.syncRepo.updateSyncStateAsync(characterId, resource, {
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          lastSyncCompletedAt: Date.now(),
          totalRecords: 0,
          itemsCount: 0,
          newRecordsInLastSync: 0,
        });
        return {
          resource,
          characterId,
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          itemsFetched: 0,
          newItemsPersisted: 0,
          totalPersisted: 0,
          durationMs: Date.now() - startTime,
          asOf: Date.now(),
        };
      }

      // 2. Fetch corporation division balances (wallets)
      let divisions: Array<{ division: number; balance: number }> = [];
      try {
        const divisionsRes = await this.esiClient.get<Array<{ division: number; balance: number }>>(
          `/corporations/${corpId}/wallets/`,
          { accessToken, refreshTokenFn, forceRevalidate: options?.forceRevalidate, signal: options?.signal }
        );
        if (Array.isArray(divisionsRes.data) && divisionsRes.data.length > 0) {
          divisions = divisionsRes.data;
        }
      } catch (walletErr) {
        const errMsg = (walletErr as Error).message || '';
        const isForbidden = errMsg.includes('403') || errMsg.toLowerCase().includes('forbidden') || errMsg.toLowerCase().includes('lacks');
        if (isForbidden) {
          this.inaccessibleCorpCharacters.add(characterId);
          await this.syncRepo.updateSyncStateAsync(characterId, resource, {
            status: 'PARTIAL',
            coverageStatus: 'PARTIAL',
            hasMore: false,
            lastSyncCompletedAt: Date.now(),
            errorMessage: 'Lacks corporation wallet roles',
          });
          return {
            resource,
            characterId,
            status: 'PARTIAL',
            coverageStatus: 'PARTIAL',
            hasMore: false,
            itemsFetched: 0,
            newItemsPersisted: 0,
            totalPersisted: 0,
            durationMs: Date.now() - startTime,
            error: 'Lacks corporation wallet roles',
            asOf: Date.now(),
          };
        } else {
          // Unexpected error fetching wallets list (e.g. 500 Internal Server Error, network failure)
          await this.syncRepo.updateSyncStateAsync(characterId, resource, {
            status: 'ERROR',
            coverageStatus: 'ERROR',
            lastSyncCompletedAt: Date.now(),
            errorMessage: errMsg || 'Corporation wallet sync failed',
          });
          return {
            resource,
            characterId,
            status: 'ERROR',
            coverageStatus: 'ERROR',
            hasMore: false,
            itemsFetched: 0,
            newItemsPersisted: 0,
            totalPersisted: 0,
            durationMs: Date.now() - startTime,
            error: errMsg || 'Corporation wallet sync failed',
            asOf: Date.now(),
          };
        }
      }

      if (divisions.length === 0) {
        await this.syncRepo.updateSyncStateAsync(characterId, resource, {
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          lastSyncCompletedAt: Date.now(),
          totalRecords: 0,
          itemsCount: 0,
        });
        return {
          resource,
          characterId,
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          itemsFetched: 0,
          newItemsPersisted: 0,
          totalPersisted: 0,
          durationMs: Date.now() - startTime,
          asOf: Date.now(),
        };
      }

      // 3. Fetch division names via GET /corporations/{corpId}/divisions/ (scope: esi-corporations.read_divisions.v1)
      const divisionNames = new Map<number, string>();
      try {
        const divNamesRes = await this.esiClient.get<{
          wallet?: Array<{ division: number; name?: string }>;
        }>(`/corporations/${corpId}/divisions/`, {
          accessToken,
          refreshTokenFn,
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
        });
        if (divNamesRes.data?.wallet && Array.isArray(divNamesRes.data.wallet)) {
          for (const d of divNamesRes.data.wallet) {
            if (d.division && d.name) {
              divisionNames.set(d.division, d.name);
            }
          }
        }
      } catch {
        // Fallback to default division labels if divisions endpoint lacks permission
      }

      // 4. Resolve corporation name
      let corpName = this.universeService.getNameSync(corpId, 'Corporation');
      try {
        const nameMap = await this.universeService.resolveNames([corpId]);
        if (nameMap.has(corpId)) {
          corpName = nameMap.get(corpId)!;
        }
      } catch {
        // Ignore resolution error
      }

      // 5. Persist real balances and journals for each corporation division
      const observedAt = Date.now();
      let totalJournalFetched = 0;
      let newJournalPersisted = 0;
      const divisionStatuses: Record<number, DivisionSyncStatus> = {};
      let succeededDivisions = 0;
      let partialDivisions = 0;
      let failedDivisions = 0;
      const divisionErrors: string[] = [];

      for (const div of divisions) {
        const divisionNumber = div.division || 1;
        const divisionName = divisionNames.get(divisionNumber) || (divisionNumber === 1 ? 'Master Wallet' : `Division ${divisionNumber}`);

        const rawBalance = div.balance as unknown;
        if (
          rawBalance === null ||
          rawBalance === undefined ||
          typeof rawBalance === 'boolean' ||
          typeof rawBalance === 'object' ||
          (typeof rawBalance === 'string' && rawBalance.trim() === '')
        ) {
          throw new Error(`Invalid corporation division balance received from ESI: expected number, got ${JSON.stringify(rawBalance)}`);
        }

        const balance = typeof rawBalance === 'number' ? rawBalance : Number(rawBalance);
        if (!Number.isFinite(balance) || isNaN(balance)) {
          throw new Error(`Invalid corporation division balance received from ESI: non-finite or NaN value ${rawBalance}`);
        }

        const corpSnapshot: WalletBalanceSnapshot = {
          id: `corp:${corpId}:div:${divisionNumber}`,
          type: 'CORPORATION',
          corporationId: corpId,
          corporationName: corpName,
          division: divisionNumber,
          divisionName,
          balance,
          observedAt,
          observedByCharacterId: characterId,
          source: `/corporations/${corpId}/wallets/`,
          isIncludedInLiquid: true,
        };
        this.walletRepo.saveWalletSnapshot(corpSnapshot);

        // Calculate pagination startPage and maxPages per division
        const prevDiv = options?.resume ? previousState?.divisionStatuses?.[divisionNumber] : undefined;
        const startPage = prevDiv && prevDiv.hasMore ? Math.max(1, (prevDiv.lastPage || 1) + 1) : 1;
        const maxPages = options?.maxPages ?? 50;

        let divHighestPage = 0;

        try {
          // Fetch journal for division (containing transaction_tax and brokers_fee)
          const paginatedJournal = await fetchXPages<RawEsiJournalEntry>(
            this.esiClient,
            `/corporations/${corpId}/wallets/${divisionNumber}/journal/`,
            {
              accessToken,
              refreshTokenFn,
              startPage,
              maxPages,
              forceRevalidate: options?.forceRevalidate,
              signal: options?.signal,
              onPageSuccess: async (page, rawItems) => {
                if (page > divHighestPage) {
                  divHighestPage = page;
                }
                if (rawItems && rawItems.length > 0) {
                  const entries: CharacterWalletJournalEntry[] = (rawItems as RawEsiJournalEntry[]).map((raw) => ({
                    id: makeJournalEntryKey({
                      isCorporationWallet: true,
                      corporationId: corpId,
                      division: divisionNumber,
                      characterId,
                      journalId: raw.id,
                    }),
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
                    isCorporationWallet: true,
                    corporationId: corpId,
                    division: divisionNumber,
                    observedByCharacterIds: [characterId],
                  }));
                  const saveRes = this.ledgerRepo.saveJournalEntries(entries);
                  newJournalPersisted += saveRes.inserted;
                }
              },
            }
          );

          const divFetched = paginatedJournal.totalFetched;
          totalJournalFetched += divFetched;
          const divLastPage = divHighestPage || (paginatedJournal.pagesFetched > 0 ? (startPage + paginatedJournal.pagesFetched - 1) : (prevDiv?.lastPage || 1));
          const divHasMore = Boolean(paginatedJournal.hasMore);
          const divStatus: SyncStatusState = paginatedJournal.status;

          if (divStatus === 'COMPLETE') {
            succeededDivisions++;
          } else if (divStatus === 'PARTIAL') {
            partialDivisions++;
          } else if (divStatus === 'ERROR') {
            failedDivisions++;
            if (paginatedJournal.error) {
              divisionErrors.push(`Division ${divisionNumber}: ${paginatedJournal.error}`);
            }
          }

          divisionStatuses[divisionNumber] = {
            status: divStatus,
            lastPage: divLastPage,
            hasMore: divHasMore,
            error: paginatedJournal.error,
            totalFetched: divFetched,
          };
        } catch (divErr) {
          if (options?.signal?.aborted) {
            throw options.signal.reason || divErr;
          }
          const divErrMsg = (divErr as Error).message || 'Division journal sync failed';
          failedDivisions++;
          divisionErrors.push(`Division ${divisionNumber}: ${divErrMsg}`);
          divisionStatuses[divisionNumber] = {
            status: 'ERROR',
            lastPage: prevDiv?.lastPage || 0,
            hasMore: true,
            error: divErrMsg,
            totalFetched: 0,
          };
        }
      }

      // Consolidate global status across divisions
      let consolidatedStatus: SyncStatusState = 'COMPLETE';
      let consolidatedError: string | undefined;

      if (failedDivisions > 0 && succeededDivisions === 0 && partialDivisions === 0) {
        consolidatedStatus = 'ERROR';
        consolidatedError = divisionErrors.join('; ');
      } else if (failedDivisions > 0 || partialDivisions > 0) {
        consolidatedStatus = 'PARTIAL';
        consolidatedError = divisionErrors.length > 0 ? divisionErrors.join('; ') : undefined;
      } else {
        consolidatedStatus = 'COMPLETE';
      }

      const hasMoreOverall = Object.values(divisionStatuses).some((d) => d.hasMore);
      const journalTotal = this.ledgerRepo.getJournalEntries(characterId, 1, 1).total;
      const totalPersistedCount = journalTotal > 0 ? journalTotal : (totalJournalFetched + divisions.length);

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: consolidatedStatus,
        coverageStatus: consolidatedStatus,
        hasMore: hasMoreOverall,
        divisionStatuses,
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalPersistedCount,
        itemsCount: totalPersistedCount,
        newRecordsInLastSync: newJournalPersisted + divisions.length,
        errorMessage: consolidatedError,
      });

      return {
        resource,
        characterId,
        status: consolidatedStatus,
        coverageStatus: consolidatedStatus,
        hasMore: hasMoreOverall,
        divisionStatuses,
        itemsFetched: totalJournalFetched + divisions.length,
        newItemsPersisted: newJournalPersisted + divisions.length,
        totalPersisted: totalPersistedCount,
        durationMs: Date.now() - startTime,
        error: consolidatedError,
        asOf: Date.now(),
      };
    } catch (err) {
      this.inaccessibleCorpCharacters.add(characterId);
      const errorMsg = (err as Error).message || 'Corporation wallet sync failed';
      console.warn(`[SyncService] Corporation wallet sync not accessible for character ${characterId}: ${errorMsg}`);

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes character assets from ESI using X-Pages pagination with in-flight coalescing
   */
  public async syncCharacterAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_assets`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncCharacterAssets(characterId, accessToken, refreshTokenFn, { ...options, signal })
    );
  }

  private async executeSyncCharacterAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean; signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_assets';
    const startTime = Date.now();
    const observedAt = Date.now();

    const previousState = await this.syncRepo.getSyncStateAsync(characterId, resource);
    const shouldResume =
      options?.resume !== false &&
      previousState.status === 'PARTIAL' &&
      previousState.lastPage !== undefined &&
      previousState.lastPage > 0 &&
      previousState.hasMore === true;
    const startPage = shouldResume ? previousState.lastPage! + 1 : 1;
    const maxPages = options?.maxPages || 10;

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
          forceRevalidate: options?.forceRevalidate,
          signal: options?.signal,
          onPageSuccess: async (page, rawItems) => {
            if (page > highestPageFetched) {
              highestPageFetched = page;
            }
            if (rawItems.length > 0) {
              const typedItems = rawItems as RawEsiAsset[];
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
            await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
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
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:corporation_assets`;
    return this.coordinator.enqueue(key, (signal) =>
      this.executeSyncCorporationAssets(characterId, accessToken, refreshTokenFn, { signal })
    );
  }

  private async executeSyncCorporationAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { signal?: AbortSignal }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'corporation_assets';
    const startTime = Date.now();

    if (this.inaccessibleCorpCharacters.has(characterId)) {
      return {
        resource,
        characterId,
        status: 'PARTIAL',
        coverageStatus: 'PARTIAL',
        hasMore: false,
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        error: 'Corporation assets inaccessible or forbidden for this character',
        asOf: Date.now(),
      };
    }

    await this.syncRepo.updateSyncStateAsync(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      const charInfoRes = await this.esiClient.get<{ corporation_id: number }>(`/characters/${characterId}/`, {
        accessToken,
        refreshTokenFn,
        signal: options?.signal,
      });

      const corpId = charInfoRes.data?.corporation_id;
      if (!corpId || corpId < 2000000) {
        await this.syncRepo.updateSyncStateAsync(characterId, resource, {
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          lastSyncCompletedAt: Date.now(),
          totalRecords: 0,
          itemsCount: 0,
        });
        return {
          resource,
          characterId,
          status: 'COMPLETE',
          coverageStatus: 'COMPLETE',
          hasMore: false,
          itemsFetched: 0,
          newItemsPersisted: 0,
          totalPersisted: 0,
          durationMs: Date.now() - startTime,
          asOf: Date.now(),
        };
      }

      const paginated = await fetchXPages<RawEsiAsset>(
        this.esiClient,
        `/corporations/${corpId}/assets/`,
        {
          accessToken,
          refreshTokenFn,
          maxPages: 10,
          signal: options?.signal,
        }
      );

      if (paginated.status === 'ERROR' && paginated.error?.includes('Forbidden')) {
        this.inaccessibleCorpCharacters.add(characterId);
        await this.syncRepo.updateSyncStateAsync(characterId, resource, {
          status: 'PARTIAL',
          coverageStatus: 'PARTIAL',
          hasMore: false,
          lastSyncCompletedAt: Date.now(),
          errorMessage: 'Lacks corporation asset director roles',
        });
        return {
          resource,
          characterId,
          status: 'PARTIAL',
          coverageStatus: 'PARTIAL',
          hasMore: false,
          itemsFetched: 0,
          newItemsPersisted: 0,
          totalPersisted: 0,
          durationMs: Date.now() - startTime,
          error: 'Lacks corporation asset director roles',
          asOf: Date.now(),
        };
      }

      const rawItems = paginated.data;
      let insertedCount = 0;
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

        const saveRes = this.assetsRepo.saveAssets(assets);
        insertedCount = saveRes.inserted;
      }

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: paginated.status,
        coverageStatus: paginated.status,
        hasMore: paginated.hasMore,
        lastSyncCompletedAt: Date.now(),
        totalRecords: rawItems.length,
        itemsCount: rawItems.length,
        newRecordsInLastSync: insertedCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: paginated.status,
        coverageStatus: paginated.status,
        hasMore: paginated.hasMore,
        itemsFetched: paginated.totalFetched,
        newItemsPersisted: insertedCount,
        totalPersisted: rawItems.length,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Corporation assets sync failed';
      console.warn(`[SyncService] Corporation assets sync skipped for character ${characterId}: ${errorMsg}`);

      await this.syncRepo.updateSyncStateAsync(characterId, resource, {
        status: 'ERROR',
        coverageStatus: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg,
        asOf: Date.now(),
      };
    }
  }

  /**
   * Synchronizes all character data (wallet transactions, journal, market orders, corporation wallet, character & corporation assets)
   * Executes independent resource synchronizations in parallel via the Bounded Task Coordinator with in-flight merging.
   * Uses coalesce() to avoid parent-child worker pool starvation and deadlocks.
   */
  public async syncAll(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean; walletSyncMode?: WalletSyncMode }
  ): Promise<SyncAllResult> {
    const key = `syncAll:${characterId}`;
    return this.coordinator.coalesce(key, async () => {
      const forceRevalidate = options?.forceRevalidate ?? true;

      const fallbackErrorResult = (resource: SyncResourceType, errorMsg: string): SyncResult => ({
        resource,
        characterId,
        status: 'ERROR',
        coverageStatus: 'ERROR',
        itemsFetched: 0,
        newItemsPersisted: 0,
        totalPersisted: 0,
        durationMs: 0,
        error: errorMsg,
        asOf: Date.now(),
      });

      // 1. Launch independent resources in parallel through the bounded worker pool using Promise.allSettled
      const [txSettled, jnSettled, ordSettled, astSettled, walSettled, corpWalSettled, corpAstSettled] = await Promise.allSettled([
        this.syncWalletTransactions(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncWalletJournal(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterOrders(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterAssets(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterWallet(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCorporationWallets(characterId, accessToken, refreshTokenFn, { walletSyncMode: options?.walletSyncMode }),
        this.syncCorporationAssets(characterId, accessToken, refreshTokenFn),
      ]);

      const transactions = txSettled.status === 'fulfilled'
        ? txSettled.value
        : fallbackErrorResult('wallet_transactions', (txSettled.reason as Error)?.message || 'Transactions sync failed');

      const journal = jnSettled.status === 'fulfilled'
        ? jnSettled.value
        : fallbackErrorResult('wallet_journal', (jnSettled.reason as Error)?.message || 'Journal sync failed');

      const orders = ordSettled.status === 'fulfilled'
        ? ordSettled.value
        : fallbackErrorResult('character_orders', (ordSettled.reason as Error)?.message || 'Orders sync failed');

      const assets = astSettled.status === 'fulfilled'
        ? astSettled.value
        : fallbackErrorResult('character_assets', (astSettled.reason as Error)?.message || 'Assets sync failed');

      const wallet = walSettled.status === 'fulfilled'
        ? walSettled.value
        : fallbackErrorResult('character_wallet', (walSettled.reason as Error)?.message || 'Wallet sync failed');

      const corpWallets = corpWalSettled.status === 'fulfilled' ? corpWalSettled.value : undefined;
      const corpAssets = corpAstSettled.status === 'fulfilled' ? corpAstSettled.value : undefined;

      return { transactions, journal, orders, assets, wallet, corpWallets, corpAssets };
    });
  }

  /**
   * Synchronizes multiple characters concurrently under the controlled coordinator pool
   */
  public async syncCharacters(
    characters: Array<{
      characterId: number;
      accessToken: string;
      refreshTokenFn?: () => Promise<string | null>;
      forceRevalidate?: boolean;
      walletSyncMode?: WalletSyncMode;
    }>
  ): Promise<
    Array<{
      characterId: number;
      result: SyncAllResult | null;
      error: string | null;
    }>
  > {
    const promises = characters.map(async (char) => {
      try {
        const result = await this.syncAll(char.characterId, char.accessToken, char.refreshTokenFn, {
          forceRevalidate: char.forceRevalidate ?? true,
          walletSyncMode: char.walletSyncMode,
        });
        return {
          characterId: char.characterId,
          result,
          error: null,
        };
      } catch (err) {
        const msg = (err as Error).message || 'Sync failed';
        return {
          characterId: char.characterId,
          result: null,
          error: `Personnage #${char.characterId}: ${msg}`,
        };
      }
    });

    return Promise.all(promises);
  }
}

export const defaultSyncService = new SyncService();
