import { describe, it, expect, beforeEach } from 'vitest';
import { OperationsService } from './service.ts';
import { VolumeRegistry } from './volumeRegistry.ts';
import { PersistentOrdersRepository } from '../orders/repository.ts';
import { PersistentAssetsRepository } from '../assets/repository.ts';
import { PersistentLedgerRepository } from '../ledger/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { HubsService } from '../hubs/service.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { CapitalService } from '../capital/service.ts';

describe('Operations Service (Phase 11 — Prioritized Transfers & Restock)', () => {
  let operationsService: OperationsService;
  let ordersRepo: PersistentOrdersRepository;
  let assetsRepo: PersistentAssetsRepository;
  let ledgerRepo: PersistentLedgerRepository;
  let roiRepo: RoiRepository;
  let hubsService: HubsService;
  let universeService: UniverseService;
  let capitalService: CapitalService;
  let volumeRegistry: VolumeRegistry;

  const CHAR_ID = 1001;
  const AMARR_STATION_ID = 60008494; // Hub Amarr
  const REMOTE_STORAGE_ID = 60011866; // Dodixie station used as remote storage

  const TYPE_TRITANIUM = 34; // Minerals (0.01 m3)
  const TYPE_RIFTER = 587; // Frigate (2500 m3)
  const TYPE_INJECTOR = 40520; // Skill Injector (0.01 m3)

  beforeEach(() => {
    ordersRepo = new PersistentOrdersRepository();
    assetsRepo = new PersistentAssetsRepository();
    ledgerRepo = new PersistentLedgerRepository();
    roiRepo = new RoiRepository(ledgerRepo);
    const hubsRepo = new HubsRepository();
    hubsService = new HubsService(hubsRepo);
    universeService = new UniverseService();
    capitalService = new CapitalService(assetsRepo, ordersRepo, ledgerRepo, roiRepo, hubsService, universeService);
    volumeRegistry = new VolumeRegistry();

    operationsService = new OperationsService(
      ordersRepo,
      assetsRepo,
      ledgerRepo,
      roiRepo,
      hubsService,
      universeService,
      capitalService,
      volumeRegistry
    );
  });

  it('proposes 100% transfer and 0% purchase when remote free stock is sufficient', async () => {
    // 1. Order completed at Amarr station for 100 Tritanium
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:101`,
      characterId: CHAR_ID,
      orderId: 101,
      typeId: TYPE_TRITANIUM,
      typeName: 'Tritanium',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 6.5,
      volumeTotal: 100,
      volumeRemain: 0,
      volumeFilled: 100,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'COMPLETED_CONFIRMED',
      stateJustification: 'Exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 0,
      isActiveInCurrentSnapshot: false,
      source: 'test',
    }]);

    // 2. Sales velocity in ledger: 180 units over 90 days = 2 units/day.
    // For 14 days horizon, target = 28 units.
    ledgerRepo.saveTransactions([
      {
        id: `${CHAR_ID}:tx1`,
        characterId: CHAR_ID,
        transactionId: 1,
        date: '2026-09-15T12:00:00Z',
        typeId: TYPE_TRITANIUM,
        typeName: 'Tritanium',
        quantity: 180,
        unitPrice: 6.5,
        totalValue: 1170,
        isBuy: false,
        isPersonal: true,
        journalRefId: 0,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        clientId: 999,
        clientName: 'Buyer',
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    // 3. Remote dormant stock available at Dodixie: 50 units (free stock, not in sell order)
    assetsRepo.saveAssets([
      {
        id: `${CHAR_ID}:item1`,
        characterId: CHAR_ID,
        itemId: 5001,
        typeId: TYPE_TRITANIUM,
        typeName: 'Tritanium',
        quantity: 50,
        locationId: REMOTE_STORAGE_ID,
        locationName: 'Dodixie Station',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    const plan = await operationsService.getOperationsPlan({
      characterId: CHAR_ID,
      horizonDays: 14,
      velocityWindowDays: 90,
    });

    // Target = 28 units. Local existing = 0. Net need = 28 units.
    // Remote available = 50 units.
    // Expected: Transfer 28 units from Dodixie to Amarr. Purchase = 0.
    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].quantity).toBe(28);
    expect(plan.transfers[0].sourceLocationId).toBe(REMOTE_STORAGE_ID);
    expect(plan.transfers[0].targetLocationId).toBe(AMARR_STATION_ID);
    expect(plan.transfers[0].totalVolumeM3).toBeCloseTo(0.28, 2);

    expect(plan.purchases.length).toBe(0);
    expect(plan.summary.totalTransfersCount).toBe(1);
    expect(plan.summary.totalPurchasesCount).toBe(0);
  });

  it('proposes partial transfer and residual market purchase when remote stock is insufficient', async () => {
    // Need 30 Rifters at Amarr (1 Rifter/day * 30 days)
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:102`,
      characterId: CHAR_ID,
      orderId: 102,
      typeId: TYPE_RIFTER,
      typeName: 'Rifter',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 1_200_000,
      volumeTotal: 30,
      volumeRemain: 0,
      volumeFilled: 30,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'COMPLETED_CONFIRMED',
      stateJustification: 'Exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 0,
      isActiveInCurrentSnapshot: false,
      source: 'test',
    }]);

    // Sales velocity: 30 units over 30 days = 1 unit/day
    ledgerRepo.saveTransactions([
      {
        id: `${CHAR_ID}:tx2`,
        characterId: CHAR_ID,
        transactionId: 2,
        date: '2026-09-10T12:00:00Z',
        typeId: TYPE_RIFTER,
        typeName: 'Rifter',
        quantity: 30,
        unitPrice: 1_200_000,
        totalValue: 36_000_000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 0,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        clientId: 999,
        clientName: 'Buyer',
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    // Remote stock available: only 10 Rifters at Dodixie
    assetsRepo.saveAssets([
      {
        id: `${CHAR_ID}:item2`,
        characterId: CHAR_ID,
        itemId: 5002,
        typeId: TYPE_RIFTER,
        typeName: 'Rifter',
        quantity: 10,
        locationId: REMOTE_STORAGE_ID,
        locationName: 'Dodixie Station',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    const plan = await operationsService.getOperationsPlan({
      characterId: CHAR_ID,
      horizonDays: 30,
      velocityWindowDays: 30,
    });

    // Target = 30 units. Net need = 30 units.
    // Transfer 10 units from Dodixie.
    // Purchase remaining 20 units at Jita.
    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].quantity).toBe(10);
    expect(plan.transfers[0].totalVolumeM3).toBe(10 * 2500); // 25,000 m3

    expect(plan.purchases.length).toBe(1);
    expect(plan.purchases[0].purchaseQuantity).toBe(20);
    expect(plan.purchases[0].transferredQuantity).toBe(10);
    expect(plan.purchases[0].netNeedQuantity).toBe(30);
    expect(plan.purchases[0].totalVolumeM3).toBe(20 * 2500); // 50,000 m3
  });

  it('proposes 100% purchase when zero remote stock exists', async () => {
    // Need 5 Skill Injectors at Amarr
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:103`,
      characterId: CHAR_ID,
      orderId: 103,
      typeId: TYPE_INJECTOR,
      typeName: 'Skill Injector',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 900_000_000,
      volumeTotal: 5,
      volumeRemain: 0,
      volumeFilled: 5,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'COMPLETED_CONFIRMED',
      stateJustification: 'Exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 0,
      isActiveInCurrentSnapshot: false,
      source: 'test',
    }]);

    const plan = await operationsService.getOperationsPlan({
      characterId: CHAR_ID,
      horizonDays: 14,
    });

    expect(plan.transfers.length).toBe(0);
    expect(plan.purchases.length).toBe(1);
    expect(plan.purchases[0].purchaseQuantity).toBe(5);
    expect(plan.purchases[0].justification).toContain('Vitesse historique non disponible');
  });

  it('correctly deducts local free stock and active sell/buy orders', async () => {
    // Order target: 10 Injectors
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:104`,
      characterId: CHAR_ID,
      orderId: 104,
      typeId: TYPE_INJECTOR,
      typeName: 'Skill Injector',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 900_000_000,
      volumeTotal: 10,
      volumeRemain: 2, // 2 still on market
      volumeFilled: 8,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'PARTIALLY_FILLED',
      stateJustification: 'Partiellement exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 2,
      isActiveInCurrentSnapshot: true,
      source: 'test',
    }]);

    // Also 3 units free in local hangar (total 5 in station, 2 committed to sell order)
    assetsRepo.saveAssets([
      {
        id: `${CHAR_ID}:item3`,
        characterId: CHAR_ID,
        itemId: 5003,
        typeId: TYPE_INJECTOR,
        typeName: 'Skill Injector',
        quantity: 5,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    // Also active buy order for 1 unit in escrow
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:105`,
      characterId: CHAR_ID,
      orderId: 105,
      typeId: TYPE_INJECTOR,
      typeName: 'Skill Injector',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: true,
      price: 850_000_000,
      volumeTotal: 1,
      volumeRemain: 1,
      volumeFilled: 0,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 1,
      isActiveInCurrentSnapshot: true,
      source: 'test',
    }]);

    // Total target = 10.
    // Existing = localFree (5 - 2 = 3) + activeSell (2) + activeBuy (1) = 6 units.
    // Net need = 10 - 6 = 4 units.
    const plan = await operationsService.getOperationsPlan({
      characterId: CHAR_ID,
    });

    expect(plan.purchases.length).toBe(1);
    expect(plan.purchases[0].targetQuantity).toBe(10);
    expect(plan.purchases[0].existingQuantity).toBe(6);
    expect(plan.purchases[0].purchaseQuantity).toBe(4);
  });

  it('updates operational statuses and persists notes', async () => {
    const transferId = `${CHAR_ID}:${TYPE_TRITANIUM}:${REMOTE_STORAGE_ID}:${AMARR_STATION_ID}`;
    operationsService.setItemStatus(transferId, 'IN_TRANSIT', 'DST en route');

    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:101`,
      characterId: CHAR_ID,
      orderId: 101,
      typeId: TYPE_TRITANIUM,
      typeName: 'Tritanium',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 6.5,
      volumeTotal: 100,
      volumeRemain: 0,
      volumeFilled: 100,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'COMPLETED_CONFIRMED',
      stateJustification: 'Exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 0,
      isActiveInCurrentSnapshot: false,
      source: 'test',
    }]);

    assetsRepo.saveAssets([
      {
        id: `${CHAR_ID}:item1`,
        characterId: CHAR_ID,
        itemId: 5001,
        typeId: TYPE_TRITANIUM,
        typeName: 'Tritanium',
        quantity: 100,
        locationId: REMOTE_STORAGE_ID,
        locationName: 'Dodixie Station',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    const plan = await operationsService.getOperationsPlan({ characterId: CHAR_ID });
    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].status).toBe('IN_TRANSIT');
    expect(plan.transfers[0].notes).toBe('DST en route');
  });

  it('reliably extracts the latest buy price chronologically regardless of anti-chronological or shuffled transaction order (S1-1 fix)', async () => {
    // Completed order requiring restock
    ordersRepo.saveOrderSnapshots([{
      id: `${CHAR_ID}:ord_shuffled`,
      characterId: CHAR_ID,
      orderId: 777,
      typeId: TYPE_RIFTER,
      typeName: 'Rifter',
      regionId: 10000043,
      locationId: AMARR_STATION_ID,
      locationName: 'Amarr VIII',
      isBuyOrder: false,
      price: 1_200_000,
      volumeTotal: 10,
      volumeRemain: 0,
      volumeFilled: 10,
      issued: '2026-09-01T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-01T10:00:00Z',
      state: 'COMPLETED_CONFIRMED',
      stateJustification: 'Exécuté',
      firstObservedAt: Date.now() - 5000,
      lastObservedAt: Date.now(),
      lastSnapshotVolumeRemain: 0,
      isActiveInCurrentSnapshot: false,
      source: 'test',
    }]);

    // Provide 3 buy transactions in ANTI-CHRONOLOGICAL order:
    // Most recent is TxB (2026-05-15 at 850,000 ISK)
    // Older are TxC (2026-03-10 at 700,000 ISK) and TxA (2026-01-01 at 500,000 ISK)
    // In buggy code, TxA (at end of loop) or intermediate would overwrite and be chosen.
    ledgerRepo.saveTransactions([
      {
        id: `${CHAR_ID}:tx_latest`,
        characterId: CHAR_ID,
        transactionId: 2,
        date: '2026-05-15T12:00:00Z', // LATEST DATE
        typeId: TYPE_RIFTER,
        typeName: 'Rifter',
        quantity: 5,
        unitPrice: 850_000,
        totalValue: 4_250_000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 0,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        clientId: 99,
        source: 'test',
        observedAt: Date.now(),
      },
      {
        id: `${CHAR_ID}:tx_mid`,
        characterId: CHAR_ID,
        transactionId: 3,
        date: '2026-03-10T12:00:00Z',
        typeId: TYPE_RIFTER,
        typeName: 'Rifter',
        quantity: 5,
        unitPrice: 700_000,
        totalValue: 3_500_000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 0,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        clientId: 99,
        source: 'test',
        observedAt: Date.now(),
      },
      {
        id: `${CHAR_ID}:tx_oldest`,
        characterId: CHAR_ID,
        transactionId: 1,
        date: '2026-01-01T12:00:00Z', // OLDEST DATE
        typeId: TYPE_RIFTER,
        typeName: 'Rifter',
        quantity: 5,
        unitPrice: 500_000,
        totalValue: 2_500_000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 0,
        locationId: AMARR_STATION_ID,
        locationName: 'Amarr VIII',
        clientId: 99,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    const plan = await operationsService.getOperationsPlan({ characterId: CHAR_ID });
    const rifterPurchase = plan.purchases.find((p) => p.typeId === TYPE_RIFTER);
    expect(rifterPurchase).toBeDefined();
    // Must strictly be the latest chronological unit price: 850,000 ISK
    expect(rifterPurchase?.estimatedBuyUnitPrice).toBe(850_000);
  });
});
