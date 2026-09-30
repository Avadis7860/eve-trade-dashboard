import type { EsiClient } from '../esi/client.ts';
import { defaultEsiClient } from '../esi/client.ts';
import { fetchFromId, fetchXPages } from '../esi/pagination.ts';
import type { ILedgerRepository } from '../ledger/repository.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import type { ISyncRepository } from './repository.ts';
import { defaultSyncRepository } from './repository.ts';
import type { IOrdersRepository } from '../orders/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import type { UniverseService } from '../universe/service.ts';
import { defaultUniverseService } from '../universe/service.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import type { RawEsiOrder, CharacterOrderSnapshot } from '../orders/types.ts';
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
  private syncRepo: ISyncRepository;
  private universeService: UniverseService;

  constructor(
    esiClient: EsiClient = defaultEsiClient,
    ledgerRepo: ILedgerRepository = defaultLedgerRepository,
    ordersRepo: IOrdersRepository = defaultOrdersRepository,
    syncRepo: ISyncRepository = defaultSyncRepository,
    universeService: UniverseService = defaultUniverseService
  ) {
    this.esiClient = esiClient;
    this.ledgerRepo = ledgerRepo;
    this.ordersRepo = ordersRepo;
    this.syncRepo = syncRepo;
    this.universeService = universeService;
  }

  /**
   * Synchronizes character wallet transactions using from_id cursor pagination
   */
  public async syncWalletTransactions(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_transactions';
    const startTime = Date.now();

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      const paginated = await fetchFromId<RawEsiTransaction>(
        this.esiClient,
        `/characters/${characterId}/wallet/transactions/`,
        {
          accessToken,
          refreshTokenFn,
          getIdFn: (tx) => tx.transaction_id,
          maxItems: 5000,
          pageSize: 2500,
        }
      );

      const rawItems = paginated.data;
      let newCount = 0;

      if (rawItems.length > 0) {
        // Collect all IDs for name resolution
        const typeIds = rawItems.map((tx) => tx.type_id);
        const locationIds = rawItems.map((tx) => tx.location_id);
        const clientIds = rawItems.map((tx) => tx.client_id);
        const allIds = [...typeIds, ...locationIds, ...clientIds];

        const nameMap = await this.universeService.resolveNames(allIds);

        // Map and enrich transactions
        const observedAt = Date.now();
        const transactions: CharacterTransaction[] = rawItems.map((raw) => {
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
        newCount = saveResult.inserted;
      }

      const totalPersisted = this.ledgerRepo.countTransactions(characterId);
      const finalStatus = paginated.status;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: finalStatus,
        lastSyncCompletedAt: Date.now(),
        lastSuccessfulId: paginated.lastSuccessfulId,
        totalRecords: totalPersisted,
        newRecordsInLastSync: newCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        itemsFetched: rawItems.length,
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
        lastSyncCompletedAt: Date.now(),
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
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
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<SyncResult> {
    const resource: SyncResourceType = 'wallet_journal';
    const startTime = Date.now();

    this.syncRepo.updateSyncState(characterId, resource, {
      status: 'SYNCING',
      lastSyncStartedAt: startTime,
    });

    try {
      const paginated = await fetchXPages<RawEsiJournalEntry>(
        this.esiClient,
        `/characters/${characterId}/wallet/journal/`,
        {
          accessToken,
          refreshTokenFn,
          maxPages: 5,
        }
      );

      const rawItems = paginated.data;
      let newCount = 0;

      if (rawItems.length > 0) {
        const observedAt = Date.now();
        const entries: CharacterWalletJournalEntry[] = rawItems.map((raw) => ({
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
        newCount = saveResult.inserted;
      }

      const journalResult = this.ledgerRepo.getJournalEntries(characterId, 1, 1);
      const totalPersisted = journalResult.total;
      const finalStatus = paginated.status;

      this.syncRepo.updateSyncState(characterId, resource, {
        status: finalStatus,
        lastSyncCompletedAt: Date.now(),
        lastPage: paginated.pagesFetched,
        totalRecords: totalPersisted,
        newRecordsInLastSync: newCount,
        errorMessage: paginated.error,
      });

      return {
        resource,
        characterId,
        status: finalStatus,
        itemsFetched: rawItems.length,
        newItemsPersisted: newCount,
        totalPersisted,
        durationMs: Date.now() - startTime,
        error: paginated.error,
        asOf: Date.now(),
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Journal sync failed';
      const journalResult = this.ledgerRepo.getJournalEntries(characterId, 1, 1);

      this.syncRepo.updateSyncState(characterId, resource, {
        status: 'ERROR',
        lastSyncCompletedAt: Date.now(),
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
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
        lastSyncCompletedAt: Date.now(),
        totalRecords: totalTracked,
        newRecordsInLastSync: saveResult.inserted,
      });

      return {
        resource,
        characterId,
        status: 'COMPLETE',
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
        lastSyncCompletedAt: Date.now(),
        errorMessage: errorMsg,
      });

      return {
        resource,
        characterId,
        status: 'ERROR',
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
   * Synchronizes all character data (wallet transactions, journal, market orders)
   */
  public async syncAll(
    characterId: number,
    accessToken: string,
    refreshTokenFn?: () => Promise<string | null>
  ): Promise<{ transactions: SyncResult; journal: SyncResult; orders: SyncResult }> {
    const transactions = await this.syncWalletTransactions(characterId, accessToken, refreshTokenFn);
    const journal = await this.syncWalletJournal(characterId, accessToken, refreshTokenFn);
    const orders = await this.syncCharacterOrders(characterId, accessToken, refreshTokenFn);

    return { transactions, journal, orders };
  }
}

export const defaultSyncService = new SyncService();
