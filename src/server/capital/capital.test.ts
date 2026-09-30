import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { HubsService } from '../hubs/service.ts';
import { CapitalService } from './service.ts';
import { SessionStore } from '../auth/sessionStore.ts';
import { createCapitalRouter } from './router.ts';
import type { CharacterAsset } from '../assets/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types.ts';
import express from 'express';
import cookieParser from 'cookie-parser';

describe('Capital & Mutually Exclusive Inventory Engine (Phase 09)', () => {
  let assetsRepo: InMemoryAssetsRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let roiRepo: RoiRepository;
  let hubsRepo: HubsRepository;
  let hubsService: HubsService;
  let capitalService: CapitalService;

  const CHAR_1 = 90001;
  const CHAR_2 = 90002;
  const JITA_STATION_ID = 60003760; // Configured Hub (hub-jita)
  const REMOTE_STATION_ID = 60010000; // Unmapped Remote Station (UNKNOWN_HUB)

  beforeEach(() => {
    assetsRepo = new InMemoryAssetsRepository(null);
    ordersRepo = new InMemoryOrdersRepository(null);
    ledgerRepo = new InMemoryLedgerRepository(null);
    roiRepo = new RoiRepository(ledgerRepo, null);
    hubsRepo = new HubsRepository(null);
    hubsService = new HubsService(hubsRepo);
    capitalService = new CapitalService(
      assetsRepo,
      ordersRepo,
      ledgerRepo,
      roiRepo,
      hubsService
    );
  });

  describe('1. Mutually Exclusive Physical Inventory Decomposition', () => {
    it('decomposes stock at a hub into committed sell orders and free hub stock with strict arithmetic invariance', () => {
      // 1,000 Tritanium in Jita
      const asset: CharacterAsset = {
        id: `${CHAR_1}:101`,
        characterId: CHAR_1,
        itemId: 101,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 1000,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      };
      assetsRepo.saveAssets([asset]);

      // Active sell order of 400 Tritanium in Jita
      const order: CharacterOrderSnapshot = {
        id: `${CHAR_1}:501`,
        characterId: CHAR_1,
        orderId: 501,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        isBuyOrder: false,
        price: 5.5,
        volumeTotal: 500,
        volumeRemain: 400,
        volumeFilled: 100,
        issued: new Date().toISOString(),
        duration: 90,
        expiresAt: new Date(Date.now() + 86400000 * 90).toISOString(),
        state: 'ACTIVE',
        stateJustification: 'Actif',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 400,
        isActiveInCurrentSnapshot: true,
        source: 'esi',
      };
      ordersRepo.saveOrderSnapshots([order]);

      const positions = capitalService.getPositions(CHAR_1);
      expect(positions).toHaveLength(1);

      const pos = positions[0];
      expect(pos.totalPhysicalQuantity).toBe(1000);
      expect(pos.committedSellOrderQuantity).toBe(400);
      expect(pos.freeHubStockQuantity).toBe(600);
      expect(pos.remoteDormantStockQuantity).toBe(0);
      expect(pos.inTransitQuantity).toBe(0);
      expect(pos.isConfiguredHub).toBe(true);
      expect(pos.sellOrderNotionalValueIsk).toBe(2200); // 400 * 5.5
      expect(pos.decompositionProof.isSumExact).toBe(true);
      expect(
        pos.committedSellOrderQuantity +
        pos.freeHubStockQuantity +
        pos.remoteDormantStockQuantity +
        pos.inTransitQuantity
      ).toBe(pos.totalPhysicalQuantity);
    });

    it('identifies in-transit stock in ship cargo hold and deliveries', () => {
      const transitAsset: CharacterAsset = {
        id: `${CHAR_1}:102`,
        characterId: CHAR_1,
        itemId: 102,
        typeId: 36,
        typeName: 'Mexallon',
        quantity: 5000,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4',
        locationType: 'station',
        locationFlag: 'CargoHold',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      };
      assetsRepo.saveAssets([transitAsset]);

      const positions = capitalService.getPositions(CHAR_1);
      expect(positions).toHaveLength(1);

      const pos = positions[0];
      expect(pos.inTransitQuantity).toBe(5000);
      expect(pos.committedSellOrderQuantity).toBe(0);
      expect(pos.freeHubStockQuantity).toBe(0);
      expect(pos.remoteDormantStockQuantity).toBe(0);
      expect(pos.primaryClassification).toBe('IN_TRANSIT_STOCK');
      expect(pos.decompositionProof.isSumExact).toBe(true);
    });

    it('classifies remote unmapped assets without activity as remote dormant stock (>30 days)', () => {
      const remoteAsset: CharacterAsset = {
        id: `${CHAR_1}:103`,
        characterId: CHAR_1,
        itemId: 103,
        typeId: 38,
        typeName: 'Nocxium',
        quantity: 800,
        locationId: REMOTE_STATION_ID,
        locationName: 'Remote Outpost Station',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      };
      assetsRepo.saveAssets([remoteAsset]);

      // Purchase transaction in remote station 60 days ago
      const oldDate = new Date(Date.now() - 60 * 86400000).toISOString();
      const buyTx: CharacterTransaction = {
        id: `${CHAR_1}:9991`,
        characterId: CHAR_1,
        transactionId: 9991,
        date: oldDate,
        typeId: 38,
        typeName: 'Nocxium',
        quantity: 800,
        unitPrice: 120,
        totalValue: 96000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 8881,
        locationId: REMOTE_STATION_ID,
        locationName: 'Remote Outpost Station',
        clientId: 12345,
        source: 'esi',
        observedAt: Date.now() - 60 * 86400000,
      };
      ledgerRepo.saveTransactions([buyTx]);

      const positions = capitalService.getPositions(CHAR_1);
      expect(positions).toHaveLength(1);

      const pos = positions[0];
      expect(pos.remoteDormantStockQuantity).toBe(800);
      expect(pos.freeHubStockQuantity).toBe(0);
      expect(pos.committedSellOrderQuantity).toBe(0);
      expect(pos.isConfiguredHub).toBe(false);
      expect(pos.isDormant).toBe(true);
      expect(pos.daysInactive).toBeGreaterThanOrEqual(59);
      expect(pos.primaryClassification).toBe('REMOTE_DORMANT_STOCK');
      expect(pos.unitCostIsk).toBe(120);
      expect(pos.totalCostBasisIsk).toBe(96000);
      expect(pos.decompositionProof.isSumExact).toBe(true);
    });

    it('marks physical stock without purchase records as UNRECONCILED_STOCK with UNKNOWN cost basis', () => {
      const unreconciledAsset: CharacterAsset = {
        id: `${CHAR_1}:104`,
        characterId: CHAR_1,
        itemId: 104,
        typeId: 99999,
        typeName: 'Unrecorded Exotic Item',
        quantity: 50,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: Date.now(),
      };
      assetsRepo.saveAssets([unreconciledAsset]);

      const positions = capitalService.getPositions(CHAR_1);
      expect(positions).toHaveLength(1);

      const pos = positions[0];
      expect(pos.totalPhysicalQuantity).toBe(50);
      expect(pos.costBasisStatus).toBe('UNKNOWN');
      expect(pos.unitCostIsk).toBeNull();
      expect(pos.totalCostBasisIsk).toBeNull();
      expect(pos.decompositionProof.isSumExact).toBe(true);
    });
  });

  describe('2. Monetary Capital & Net Real Capital Aggregation', () => {
    it('aggregates liquid wallet cash, buy order escrow, and unsold inventory acquisition cost into net real capital', () => {
      // 1. Wallet Journal with balance 50,000,000 ISK
      const journalEntry: CharacterWalletJournalEntry = {
        id: `${CHAR_1}:701`,
        characterId: CHAR_1,
        journalId: 701,
        date: new Date().toISOString(),
        refType: 'market_transaction',
        amount: -1000000,
        balance: 50000000,
        description: 'Vente de marché',
        source: 'esi',
        observedAt: Date.now(),
      };
      ledgerRepo.saveJournalEntries([journalEntry]);

      // 2. Buy Order with 15,000,000 ISK in Escrow
      const buyOrder: CharacterOrderSnapshot = {
        id: `${CHAR_1}:502`,
        characterId: CHAR_1,
        orderId: 502,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4',
        isBuyOrder: true,
        price: 5.0,
        volumeTotal: 3000000,
        volumeRemain: 3000000,
        volumeFilled: 0,
        issued: new Date().toISOString(),
        duration: 90,
        expiresAt: new Date(Date.now() + 86400000 * 90).toISOString(),
        escrow: 15000000,
        state: 'ACTIVE',
        stateJustification: 'Actif',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 3000000,
        isActiveInCurrentSnapshot: true,
        source: 'esi',
      };
      ordersRepo.saveOrderSnapshots([buyOrder]);

      // 3. Unsold Purchase Transaction (100 units @ 200,000 ISK = 20,000,000 ISK)
      const buyTx: CharacterTransaction = {
        id: `${CHAR_1}:9901`,
        characterId: CHAR_1,
        transactionId: 9901,
        date: new Date().toISOString(),
        typeId: 11399,
        typeName: 'Heavy Missile Launcher II',
        quantity: 100,
        unitPrice: 200000,
        totalValue: 20000000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 701,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4',
        clientId: 444,
        source: 'esi',
        observedAt: Date.now(),
      };
      ledgerRepo.saveTransactions([buyTx]);

      // 4. Active Sell Order with Notional Value 80,000,000 ISK (MUST NOT BE ADDED TO REAL CAPITAL)
      const sellOrder: CharacterOrderSnapshot = {
        id: `${CHAR_1}:503`,
        characterId: CHAR_1,
        orderId: 503,
        typeId: 11399,
        typeName: 'Heavy Missile Launcher II',
        regionId: 10000002,
        locationId: JITA_STATION_ID,
        locationName: 'Jita IV - Moon 4',
        isBuyOrder: false,
        price: 800000,
        volumeTotal: 100,
        volumeRemain: 100,
        volumeFilled: 0,
        issued: new Date().toISOString(),
        duration: 90,
        expiresAt: new Date(Date.now() + 86400000 * 90).toISOString(),
        state: 'ACTIVE',
        stateJustification: 'Actif',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 100,
        isActiveInCurrentSnapshot: true,
        source: 'esi',
      };
      ordersRepo.saveOrderSnapshots([sellOrder]);

      const monetary = capitalService.getMonetaryCapital(CHAR_1);

      expect(monetary.liquidWalletBalanceIsk).toBe(50000000);
      expect(monetary.marketBuyEscrowIsk).toBe(15000000);
      expect(monetary.inventoryCostValueIsk).toBe(20000000);
      // Net Real Capital = 50M + 15M + 20M = 85M
      expect(monetary.netRealCapitalIsk).toBe(85000000);

      // Notional Ask Value is strictly segregated
      expect(monetary.notionalMarketAskValueIsk).toBe(80000000);
      expect(monetary.netRealCapitalIsk).not.toBe(85000000 + 80000000);
    });

    it('aggregates multiple characters seamlessly across the whole trading ecosystem', () => {
      // Character 1 Wallet: 30M
      ledgerRepo.saveJournalEntries([
        {
          id: `${CHAR_1}:1`,
          characterId: CHAR_1,
          journalId: 1,
          date: new Date().toISOString(),
          refType: 'market_transaction',
          balance: 30000000,
          description: 'Tx Char 1',
          source: 'esi',
          observedAt: Date.now(),
        },
      ]);

      // Character 2 Wallet: 70M
      ledgerRepo.saveJournalEntries([
        {
          id: `${CHAR_2}:2`,
          characterId: CHAR_2,
          journalId: 2,
          date: new Date().toISOString(),
          refType: 'market_transaction',
          balance: 70000000,
          description: 'Tx Char 2',
          source: 'esi',
          observedAt: Date.now(),
        },
      ]);

      const multiSummary = capitalService.getMonetaryCapital(undefined, [CHAR_1, CHAR_2]);
      expect(multiSummary.liquidWalletBalanceIsk).toBe(100000000); // 30M + 70M
    });
  });

  describe('3. API Endpoints & Multi-Character Isolation', () => {
    let sessionStore: SessionStore;
    let app: express.Express;
    let testSessionId: string;

    beforeEach(() => {
      sessionStore = new SessionStore();
      const session = sessionStore.createSession({
        characterId: CHAR_1,
        characterName: 'Trader One',
        scopes: ['esi-assets.read_assets.v1', 'esi-wallet.read_character_wallet.v1'],
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
        expiresAt: Date.now() + 3600000,
      });
      testSessionId = session.sessionId;

      // Link Character 2
      sessionStore.addOrUpdateCharacter(
        testSessionId,
        {
          characterId: CHAR_2,
          characterName: 'Trader Two',
          scopes: ['esi-assets.read_assets.v1'],
          accessToken: 'access-token-2',
          refreshToken: 'refresh-token-2',
          expiresAt: Date.now() + 3600000,
        },
        false
      );

      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use('/api/capital', createCapitalRouter(capitalService, sessionStore));
    });

    it('returns 401 on /api/capital/summary when not authenticated', async () => {
      const res = await request(app).get('/api/capital/summary');
      expect(res.status).toBe(401);
    });

    it('returns 403 on /api/capital/summary when querying an unlinked character', async () => {
      const res = await request(app)
        .get('/api/capital/summary?character_id=999999')
        .set('Cookie', [`eve_session_id=${testSessionId}`]);

      expect(res.status).toBe(403);
    });

    it('returns 200 with complete capital summary for authorized active character', async () => {
      const res = await request(app)
        .get('/api/capital/summary')
        .set('Cookie', [`eve_session_id=${testSessionId}`]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('monetary');
      expect(res.body).toHaveProperty('physicalSummary');
      expect(res.body).toHaveProperty('dormantSummary');
      expect(res.body.characterCount).toBeGreaterThanOrEqual(1);
    });

    it('returns 200 with breakdown and supports filters by search and classification', async () => {
      // Seed assets for test
      assetsRepo.saveAssets([
        {
          id: `${CHAR_1}:201`,
          characterId: CHAR_1,
          itemId: 201,
          typeId: 34,
          typeName: 'Tritanium',
          quantity: 20000,
          locationId: JITA_STATION_ID,
          locationName: 'Jita IV - Moon 4',
          locationType: 'station',
          locationFlag: 'Hangar',
          isSingleton: false,
          isCorpAsset: false,
          source: 'esi',
          observedAt: Date.now(),
        },
      ]);

      const res = await request(app)
        .get('/api/capital/breakdown?search=Tritanium')
        .set('Cookie', [`eve_session_id=${testSessionId}`]);

      expect(res.status).toBe(200);
      expect(res.body.positions).toHaveLength(1);
      expect(res.body.positions[0].typeName).toBe('Tritanium');
      expect(res.body.positions[0].totalPhysicalQuantity).toBe(20000);
    });

    it('returns dormant stock positions via /api/capital/dormant', async () => {
      assetsRepo.saveAssets([
        {
          id: `${CHAR_1}:202`,
          characterId: CHAR_1,
          itemId: 202,
          typeId: 38,
          typeName: 'Nocxium',
          quantity: 500,
          locationId: REMOTE_STATION_ID,
          locationName: 'Remote Base',
          locationType: 'station',
          locationFlag: 'Hangar',
          isSingleton: false,
          isCorpAsset: false,
          source: 'esi',
          observedAt: Date.now(),
        },
      ]);

      const res = await request(app)
        .get('/api/capital/dormant')
        .set('Cookie', [`eve_session_id=${testSessionId}`]);

      expect(res.status).toBe(200);
      expect(res.body.totalDormantItems).toBe(1);
      expect(res.body.items[0].typeId).toBe(38);
      expect(res.body.items[0].isDormant).toBe(true);
    });
  });
});
