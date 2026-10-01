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
import type { RawEsiOrder, CharacterOrderSnapshot } from '../orders/types.ts';
import type { RawEsiAsset, CharacterAsset } from '../assets/types.ts';
import { evaluateOrderLifecycle, calculateExpirationIso } from '../orders/lifecycle.ts';
import type { SyncResult, SyncResourceType } from './types.ts';
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
    return this.coordinator.enqueue(key, () =>
      this.executeSyncWalletTransactions(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncWalletTransactions(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxItems?: number; forceRevalidate?: boolean }
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
          forceRevalidate: options?.forceRevalidate,
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
   * Synchronizes character wallet journal entries with in-flight coalescing
   */
  public async syncWalletJournal(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:wallet_journal`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncWalletJournal(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncWalletJournal(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
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
          forceRevalidate: options?.forceRevalidate,
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
   * Synchronizes character active orders and historical orders with in-flight coalescing
   */
  public async syncCharacterOrders(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_orders`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncCharacterOrders(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncCharacterOrders(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
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
        { accessToken, refreshTokenFn, forceRevalidate: options?.forceRevalidate }
      );

      const rawActive = Array.isArray(activeRes.data) ? activeRes.data : [];

      // 2. Fetch historical orders (up to 3 pages)
      let rawHistory: RawEsiOrder[] = [];
      try {
        const historyRes = await fetchXPages<RawEsiOrder>(
          this.esiClient,
          `/characters/${characterId}/orders/history/`,
          { accessToken, refreshTokenFn, maxPages: 3, forceRevalidate: options?.forceRevalidate }
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
   * Synchronizes real character wallet balance directly from GET /characters/{character_id}/wallet
   */
  public async syncCharacterWallet(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_wallet`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncCharacterWallet(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncCharacterWallet(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'character_wallet';
    const startTime = Date.now();
    const observedAt = Date.now();

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      const res = await this.esiClient.get<number>(
        `/characters/${characterId}/wallet/`,
        { accessToken, refreshTokenFn, forceRevalidate: options?.forceRevalidate }
      );

      const balance = typeof res.data === 'number' ? res.data : Number(res.data) || 0;
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

      this.syncRepo.updateSyncState(characterId, resource, {
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

      this.syncRepo.updateSyncState(characterId, resource, {
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
    options?: { walletSyncMode?: WalletSyncMode }
  ): Promise<void> {
    if (options?.walletSyncMode === 'CHARACTERS_ONLY') return;

    const key = `sync:${characterId}:corporation_wallets`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncCorporationWallets(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncCorporationWallets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { walletSyncMode?: WalletSyncMode }
  ): Promise<void> {
    if (options?.walletSyncMode === 'CHARACTERS_ONLY') return;
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

      // 2. Fetch corporation division balances (wallets)
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

      // 3. Fetch division names via GET /corporations/{corpId}/divisions/ (scope: esi-corporations.read_divisions.v1)
      const divisionNames = new Map<number, string>();
      try {
        const divNamesRes = await this.esiClient.get<{
          wallet?: Array<{ division: number; name?: string }>;
        }>(`/corporations/${corpId}/divisions/`, {
          accessToken,
          refreshTokenFn,
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

      // 5. Persist real balances for each corporation division
      const observedAt = Date.now();
      for (const div of divisions) {
        const divisionNumber = div.division || 1;
        const divisionName = divisionNames.get(divisionNumber) || (divisionNumber === 1 ? 'Master Wallet' : `Division ${divisionNumber}`);

        const corpSnapshot: WalletBalanceSnapshot = {
          id: `corp:${corpId}:div:${divisionNumber}`,
          type: 'CORPORATION',
          corporationId: corpId,
          corporationName: corpName,
          division: divisionNumber,
          divisionName,
          balance: Number(div.balance) || 0,
          observedAt,
          observedByCharacterId: characterId,
          source: `/corporations/${corpId}/wallets/`,
          isIncludedInLiquid: true,
        };
        this.walletRepo.saveWalletSnapshot(corpSnapshot);

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
            const entries: CharacterWalletJournalEntry[] = paginatedJournal.data.map((raw) => ({
              id: `${characterId}:corp:${corpId}:${divisionNumber}:${raw.id}`,
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
   * Synchronizes character assets from ESI using X-Pages pagination with in-flight coalescing
   */
  public async syncCharacterAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
  ): Promise<SyncResult> {
    const key = `sync:${characterId}:character_assets`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncCharacterAssets(characterId, accessToken, refreshTokenFn, options)
    );
  }

  private async executeSyncCharacterAssets(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { resume?: boolean; maxPages?: number; forceRevalidate?: boolean }
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
          forceRevalidate: options?.forceRevalidate,
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
    const key = `sync:${characterId}:corporation_assets`;
    return this.coordinator.enqueue(key, () =>
      this.executeSyncCorporationAssets(characterId, accessToken, refreshTokenFn)
    );
  }

  private async executeSyncCorporationAssets(
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
   * Executes independent resource synchronizations in parallel via the Bounded Task Coordinator with in-flight merging.
   * Uses coalesce() to avoid parent-child worker pool starvation and deadlocks.
   */
  public async syncAll(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>,
    options?: { forceRevalidate?: boolean; walletSyncMode?: WalletSyncMode }
  ): Promise<{ transactions: SyncResult; journal: SyncResult; orders: SyncResult; assets: SyncResult; wallet?: SyncResult }> {
    const key = `syncAll:${characterId}`;
    return this.coordinator.coalesce(key, async () => {
      const forceRevalidate = options?.forceRevalidate ?? true;
      // 1. Launch independent resources in parallel through the bounded worker pool
      const [transactions, journal, orders, assets, wallet] = await Promise.all([
        this.syncWalletTransactions(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncWalletJournal(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterOrders(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterAssets(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
        this.syncCharacterWallet(characterId, accessToken, refreshTokenFn, { forceRevalidate }),
      ]);

      // 2. Launch secondary / corp resources in parallel (non-blocking for core result)
      await Promise.allSettled([
        this.syncCorporationWallets(characterId, accessToken, refreshTokenFn, { walletSyncMode: options?.walletSyncMode }),
        this.syncCorporationAssets(characterId, accessToken, refreshTokenFn),
      ]);

      return { transactions, journal, orders, assets, wallet };
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
      result: { transactions: SyncResult; journal: SyncResult; orders: SyncResult; assets: SyncResult; wallet?: SyncResult } | null;
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

