import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from './service.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { InMemoryOrdersRepository } from '../orders/repository.ts';
import { InMemoryAssetsRepository } from '../assets/repository.ts';
import { RoiRepository } from '../roi/repository.ts';
import { HubsService } from '../hubs/service.ts';
import { HubsRepository } from '../hubs/repository.ts';
import { UniverseService } from '../universe/service.ts';
import { CapitalService } from '../capital/service.ts';
import { InMemorySyncRepository } from '../sync/repository.ts';
import { createAnalyticsRouter } from './router.ts';
import { SessionStore } from '../auth/sessionStore.ts';
import type { OpeningBalanceLot } from '../roi/types.ts';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

describe('PHASE-10: Product 360 & Time Series Analytics Engine', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ordersRepo: InMemoryOrdersRepository;
  let assetsRepo: InMemoryAssetsRepository;
  let roiRepo: RoiRepository;
  let hubsRepo: HubsRepository;
  let hubsService: HubsService;
  let universeService: UniverseService;
  let capitalService: CapitalService;
  let syncRepo: InMemorySyncRepository;
  let analyticsService: AnalyticsService;
  let sessionStore: SessionStore;

  const CHAR_1 = 9001;
  const CHAR_2 = 9002;
  const TRITANIUM_ID = 34; // Tritanium
  const PLEX_ID = 44992; // PLEX
  const JITA_44_ID = 60003760; // Jita IV-4
  const AMARR_8_ID = 60008494; // Amarr VIII

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository(null);
    ordersRepo = new InMemoryOrdersRepository(null);
    assetsRepo = new InMemoryAssetsRepository(null);
    roiRepo = new RoiRepository(ledgerRepo, null);
    hubsRepo = new HubsRepository(null);
    hubsService = new HubsService(hubsRepo);
    universeService = new UniverseService();
    capitalService = new CapitalService(
      assetsRepo,
      ordersRepo,
      ledgerRepo,
      roiRepo,
      hubsService
    );
    syncRepo = new InMemorySyncRepository(null);
    analyticsService = new AnalyticsService(
      ledgerRepo,
      ordersRepo,
      roiRepo,
      hubsService,
      universeService,
      capitalService,
      syncRepo
    );
    sessionStore = new SessionStore();
  });

  it('calculates Product 360 KPIs, velocity, holding duration and capital yield accurately', async () => {
    const fixedNow = new Date('2026-09-30T12:00:00Z');

    // 1. Seed Buy transaction 20 days before now
    const buyDate = new Date(fixedNow.getTime() - 20 * 24 * 3600 * 1000).toISOString();
    ledgerRepo.saveTransactions([
      {
        id: `${CHAR_1}:1001`,
        transactionId: 1001,
        characterId: CHAR_1,
        typeId: TRITANIUM_ID,
        typeName: 'Tritanium',
        isBuy: true,
        isPersonal: true,
        journalRefId: 9001,
        clientId: 50001,
        quantity: 10000,
        unitPrice: 5.0,
        totalValue: 50000,
        locationId: JITA_44_ID,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        date: buyDate,
        source: 'esi',
        observedAt: fixedNow.getTime(),
      },
    ]);

    // 2. Seed Sell transaction 5 days before now (holding duration = 15 days)
    const sellDate = new Date(fixedNow.getTime() - 5 * 24 * 3600 * 1000).toISOString();
    ledgerRepo.saveTransactions([
      {
        id: `${CHAR_1}:2001`,
        transactionId: 2001,
        characterId: CHAR_1,
        typeId: TRITANIUM_ID,
        typeName: 'Tritanium',
        isBuy: false,
        isPersonal: true,
        journalRefId: 9002,
        clientId: 50002,
        quantity: 6000,
        unitPrice: 8.0,
        totalValue: 48000,
        locationId: AMARR_8_ID,
        locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
        date: sellDate,
        source: 'esi',
        observedAt: fixedNow.getTime(),
      },
    ]);

    // 3. Seed FIFO allocation for this sale
    roiRepo.saveAllocations([
      {
        id: 'alloc-1',
        character_id: CHAR_1,
        sell_character_id: CHAR_1,
        buy_character_id: CHAR_1,
        sell_transaction_id: 2001,
        source_type: 'TRANSACTION',
        buy_transaction_id: 1001,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity_allocated: 6000,
        unit_buy_price: 5.0,
        allocated_buy_cost: 30000,
        allocated_buy_fees: 600, // 2% broker fee on buy
        allocated_sell_fees: 1920, // 4% tax + fee on sell
        buy_location_id: JITA_44_ID,
        buy_hub_id: 'jita',
        buy_hub_name: 'Jita',
        sell_location_id: AMARR_8_ID,
        sell_hub_id: 'amarr',
        sell_hub_name: 'Amarr',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: sellDate,
        updated_at: sellDate,
        version: 1,
      },
    ]);

    // 4. Seed Physical Assets remaining: 4,000 units in Amarr
    assetsRepo.saveAssets([
      {
        id: `${CHAR_1}:5001`,
        itemId: 5001,
        characterId: CHAR_1,
        typeId: TRITANIUM_ID,
        typeName: 'Tritanium',
        quantity: 4000,
        locationId: AMARR_8_ID,
        locationName: 'Amarr VIII',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi',
        observedAt: fixedNow.getTime(),
      },
    ]);

    // 5. Seed open sell order
    ordersRepo.saveOrderSnapshots([
      {
        id: `${CHAR_1}:9901`,
        orderId: 9901,
        characterId: CHAR_1,
        typeId: TRITANIUM_ID,
        typeName: 'Tritanium',
        isBuyOrder: false,
        price: 9.0,
        volumeRemain: 1000,
        volumeTotal: 1000,
        volumeFilled: 0,
        locationId: AMARR_8_ID,
        locationName: 'Amarr VIII',
        regionId: 10000043,
        state: 'ACTIVE',
        stateJustification: 'Actif',
        issued: sellDate,
        duration: 90,
        expiresAt: new Date(fixedNow.getTime() + 85 * 24 * 3600 * 1000).toISOString(),
        firstObservedAt: fixedNow.getTime(),
        lastObservedAt: fixedNow.getTime(),
        lastSnapshotVolumeRemain: 1000,
        isActiveInCurrentSnapshot: true,
        source: 'esi',
      },
    ]);

    const res = await analyticsService.getProduct360(TRITANIUM_ID, {
      timeframe: '90d',
      characterId: CHAR_1,
      now: fixedNow,
    });

    expect(res.type_id).toBe(TRITANIUM_ID);
    expect(res.image_url).toBe(`https://images.evetech.net/types/${TRITANIUM_ID}/icon?size=64`);
    expect(res.timeframe).toBe('90d');

    // KPIs:
    // CA Brut = 6000 * 8 = 48,000 ISK
    expect(res.kpis.gross_revenue_isk).toBe(48000);
    // COGS = 30000 + 600 = 30,600 ISK
    expect(res.kpis.cogs_allocated_isk).toBe(30600);
    expect(res.kpis.allocated_sell_fees_isk).toBe(1920);
    // Profit TTC = 48000 - 30600 - 1920 = 15,480 ISK
    expect(res.kpis.realized_profit_ttc_isk).toBe(15480);
    // ROI TTC = (15480 / 30600) * 100 = 50.59%
    expect(res.kpis.roi_percent_ttc).toBe(50.59);

    // Units:
    expect(res.kpis.units_sold).toBe(6000);
    expect(res.kpis.units_bought).toBe(10000);

    // Velocity V_jour = 6000 / 90 = 66.67 units/day
    expect(res.kpis.velocity_daily).toBe(66.67);
    expect(res.kpis.velocity_observation_days).toBe(90);

    // Average Holding Duration D_detention = 15.0 days
    expect(res.kpis.average_holding_days).toBe(15.0);
    expect(res.kpis.coverage_ratio_holding_days).toBe(1.0);

    // Yield per capital day: R_cap_jour = 50.59 / 15.0 = 3.37 %/day
    expect(res.kpis.yield_per_capital_day_percent).toBe(3.37);

    // Stock breakdown
    expect(res.locations_breakdown.length).toBeGreaterThanOrEqual(1);
    expect(res.open_orders.length).toBe(1);
    expect(res.open_orders[0].order_id).toBe(9901);
    expect(res.open_orders[0].price).toBe(9.0);

    // Transactions table
    expect(res.transactions_history.length).toBe(2);
    const saleTxRow = res.transactions_history.find((t) => !t.is_buy);
    expect(saleTxRow?.reconciliation_status).toBe('COMPLETE');
    expect(saleTxRow?.proof).not.toBeNull();
    expect(saleTxRow?.proof?.realized_profit_ttc_isk).toBe(15480);
  });

  it('handles item with no sales or unreconciled sales cleanly without division by zero', async () => {
    const fixedNow = new Date('2026-09-30T12:00:00Z');

    const res = await analyticsService.getProduct360(PLEX_ID, {
      timeframe: '90d',
      characterId: CHAR_1,
      now: fixedNow,
    });

    expect(res.type_id).toBe(PLEX_ID);
    expect(res.kpis.gross_revenue_isk).toBe(0);
    expect(res.kpis.units_sold).toBe(0);
    expect(res.kpis.velocity_daily).toBe(0);
    expect(res.kpis.average_holding_days).toBeNull();
    expect(res.kpis.yield_per_capital_day_percent).toBeNull();
    expect(res.kpis.realized_profit_ttc_isk).toBeNull();
    expect(res.kpis.roi_percent_ttc).toBeNull();
    expect(res.open_orders).toEqual([]);
    expect(res.transactions_history).toEqual([]);
  });

  it('computes time series activity points, cumulative curves, and age brackets pyramid', async () => {
    const fixedNow = new Date('2026-09-30T12:00:00Z');

    // Create unsold lots with varying ages:
    // Lot 1: 5 days old (bracket 0-14d)
    const d5 = new Date(fixedNow.getTime() - 5 * 24 * 3600 * 1000).toISOString();
    // Lot 2: 25 days old (bracket 15-30d)
    const d25 = new Date(fixedNow.getTime() - 25 * 24 * 3600 * 1000).toISOString();
    // Lot 3: 45 days old (bracket 31-60d)
    const d45 = new Date(fixedNow.getTime() - 45 * 24 * 3600 * 1000).toISOString();
    // Lot 4: 75 days old (bracket 61-90d)
    const d75 = new Date(fixedNow.getTime() - 75 * 24 * 3600 * 1000).toISOString();
    // Lot 5: 120 days old (bracket >90d)
    const d120 = new Date(fixedNow.getTime() - 120 * 24 * 3600 * 1000).toISOString();

    const lots: OpeningBalanceLot[] = [
      {
        id: 'ob-1',
        character_id: CHAR_1,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity: 1000,
        allocated_quantity: 0,
        remaining_quantity: 1000,
        unit_cost_isk: 5.0,
        total_cost_isk: 5000,
        location_id: JITA_44_ID,
        hub_id: 'jita',
        hub_name: 'Jita',
        acquisition_date: d5,
        justification: 'Frais 5j',
        created_at: d5,
        updated_at: d5,
        version: 1,
      },
      {
        id: 'ob-2',
        character_id: CHAR_1,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity: 2000,
        allocated_quantity: 0,
        remaining_quantity: 2000,
        unit_cost_isk: 5.0,
        total_cost_isk: 10000,
        location_id: JITA_44_ID,
        hub_id: 'jita',
        hub_name: 'Jita',
        acquisition_date: d25,
        justification: 'Actif 25j',
        created_at: d25,
        updated_at: d25,
        version: 1,
      },
      {
        id: 'ob-3',
        character_id: CHAR_1,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity: 3000,
        allocated_quantity: 0,
        remaining_quantity: 3000,
        unit_cost_isk: 5.0,
        total_cost_isk: 15000,
        location_id: JITA_44_ID,
        hub_id: 'jita',
        hub_name: 'Jita',
        acquisition_date: d45,
        justification: 'Ralenti 45j',
        created_at: d45,
        updated_at: d45,
        version: 1,
      },
      {
        id: 'ob-4',
        character_id: CHAR_1,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity: 4000,
        allocated_quantity: 0,
        remaining_quantity: 4000,
        unit_cost_isk: 5.0,
        total_cost_isk: 20000,
        location_id: JITA_44_ID,
        hub_id: 'jita',
        hub_name: 'Jita',
        acquisition_date: d75,
        justification: 'Alerte 75j',
        created_at: d75,
        updated_at: d75,
        version: 1,
      },
      {
        id: 'ob-5',
        character_id: CHAR_1,
        type_id: TRITANIUM_ID,
        type_name: 'Tritanium',
        quantity: 5000,
        allocated_quantity: 0,
        remaining_quantity: 5000,
        unit_cost_isk: 5.0,
        total_cost_isk: 25000,
        location_id: JITA_44_ID,
        hub_id: 'jita',
        hub_name: 'Jita',
        acquisition_date: d120,
        justification: 'Dormant >90j',
        created_at: d120,
        updated_at: d120,
        version: 1,
      },
    ];

    for (const lot of lots) {
      roiRepo.saveOpeningBalance(lot);
    }

    const ts = await analyticsService.getTimeSeries({
      typeId: TRITANIUM_ID,
      timeframe: '90d',
      groupBy: 'day',
      characterId: CHAR_1,
      now: fixedNow,
    });

    expect(ts.lot_age_distribution.length).toBe(5);
    const b0_14 = ts.lot_age_distribution.find((b) => b.bracket === '0-14d');
    const b15_30 = ts.lot_age_distribution.find((b) => b.bracket === '15-30d');
    const b31_60 = ts.lot_age_distribution.find((b) => b.bracket === '31-60d');
    const b61_90 = ts.lot_age_distribution.find((b) => b.bracket === '61-90d');
    const b90plus = ts.lot_age_distribution.find((b) => b.bracket === '>90d');

    expect(b0_14?.quantity).toBe(1000);
    expect(b15_30?.quantity).toBe(2000);
    expect(b31_60?.quantity).toBe(3000);
    expect(b61_90?.quantity).toBe(4000);
    expect(b90plus?.quantity).toBe(5000);

    // Sum of costs = 5k + 10k + 15k + 20k + 25k = 75,000 ISK
    expect(b90plus?.cost_isk).toBe(25000);
    expect(b90plus?.percentage_of_capital).toBe(33.3); // 25k / 75k = 33.3%
  });

  it('exposes secured HTTP endpoints with multi-character isolation and parameter validations', async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());

    const session = sessionStore.createSession({
      characterId: CHAR_1,
      characterName: 'Trader One',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600000,
      scopes: ['esi-wallet.read_character_wallet.v1'],
    });

    app.use('/api/analytics', createAnalyticsRouter(analyticsService, sessionStore));

    // 1. Unauthenticated request
    const unauthRes = await request(app).get(`/api/analytics/product/${TRITANIUM_ID}`);
    expect(unauthRes.status).toBe(401);

    // 2. Authenticated request for authorized character
    const authRes = await request(app)
      .get(`/api/analytics/product/${TRITANIUM_ID}?timeframe=30d`)
      .set('Cookie', [`eve_session_id=${session.sessionId}`]);

    expect(authRes.status).toBe(200);
    expect(authRes.body.type_id).toBe(TRITANIUM_ID);
    expect(authRes.body.timeframe).toBe('30d');

    // 3. Unauthorized cross-character request
    const unauthCharRes = await request(app)
      .get(`/api/analytics/product/${TRITANIUM_ID}?character_id=${CHAR_2}`)
      .set('Cookie', [`eve_session_id=${session.sessionId}`]);

    expect(unauthCharRes.status).toBe(403);

    // 4. Invalid typeId param
    const invalidTypeRes = await request(app)
      .get('/api/analytics/product/not-a-number')
      .set('Cookie', [`eve_session_id=${session.sessionId}`]);

    expect(invalidTypeRes.status).toBe(400);

    // 5. Timeseries endpoint
    const tsRes = await request(app)
      .get('/api/analytics/timeseries?timeframe=90d&groupBy=week')
      .set('Cookie', [`eve_session_id=${session.sessionId}`]);

    expect(tsRes.status).toBe(200);
    expect(tsRes.body.timeframe).toBe('90d');
    expect(tsRes.body.group_by).toBe('week');
    expect(Array.isArray(tsRes.body.data_points)).toBe(true);
  });

  it('isolates multi-character freshness in getTimeSeries: error on Character B does not alter Character A FRESH status (S1-3 fix)', async () => {
    const now = Date.now();

    // Character 1 has fresh complete sync
    syncRepo.updateSyncState(CHAR_1, 'wallet_transactions', {
      status: 'COMPLETE',
      totalRecords: 10,
      lastSyncCompletedAt: now - 60000,
    });

    // Character 2 has an error in sync
    syncRepo.updateSyncState(CHAR_2, 'wallet_transactions', {
      status: 'ERROR',
      totalRecords: 0,
      errorMessage: 'Fatal network timeout',
    });

    // 1. Query for Character 1 only: MUST BE FRESH, not contaminated by Character 2!
    const char1Ts = await analyticsService.getTimeSeries({
      characterId: CHAR_1,
      now: new Date(now),
    });
    expect(char1Ts.freshness_status).toBe('FRESH');

    // 2. Query for Character 2 only: MUST BE PARTIAL / ERROR
    const char2Ts = await analyticsService.getTimeSeries({
      characterId: CHAR_2,
      now: new Date(now),
    });
    expect(char2Ts.freshness_status).toBe('PARTIAL');
    expect(char2Ts.uncertainty_notes.some((n) => n.includes('incomplètes'))).toBe(true);
  });

  it('reflects SYNCING or PARTIAL status as PARTIAL in getTimeSeries instead of falsely FRESH (S1-3 fix)', async () => {
    const now = Date.now();

    syncRepo.updateSyncState(CHAR_1, 'wallet_transactions', {
      status: 'SYNCING',
      lastSyncStartedAt: now - 10000,
      lastSyncCompletedAt: now - 60000,
      totalRecords: 10,
    });

    const ts = await analyticsService.getTimeSeries({
      characterId: CHAR_1,
      now: new Date(now),
    });

    // Must be PARTIAL, not falsely FRESH
    expect(ts.freshness_status).toBe('PARTIAL');
  });
});
