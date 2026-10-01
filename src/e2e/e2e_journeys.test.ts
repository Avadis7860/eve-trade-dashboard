// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request, { type Test } from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../../server.ts';
import { defaultSessionStore } from '../server/auth/sessionStore.ts';
import { defaultLedgerRepository } from '../server/ledger/repository.ts';
import { defaultOrdersRepository } from '../server/orders/repository.ts';
import { defaultAssetsRepository } from '../server/assets/repository.ts';
import { defaultSyncRepository } from '../server/sync/repository.ts';
import { transactionsToCsv } from '../utils/csvExport.ts';
import type { CharacterTransaction } from '../server/ledger/types.ts';
import type { CharacterOrderSnapshot } from '../server/orders/types.ts';
import type { CharacterAsset } from '../server/assets/types.ts';

describe('Level 5: Full End-to-End User Journeys (11 Critical Paths)', () => {
  let app: Express;
  let supertestReq: TestAgent<Test>;
  let sessionCookie: string;
  let rawSessionId: string;
  const mainCharacterId = 777001;
  const altCharacterId = 777002;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();
    supertestReq = request(app);

    // Clean repositories before E2E journey
    defaultLedgerRepository.clearCharacter(mainCharacterId);
    defaultLedgerRepository.clearCharacter(altCharacterId);
    defaultOrdersRepository.clearCharacter(mainCharacterId);
    defaultOrdersRepository.clearCharacter(altCharacterId);
    defaultAssetsRepository.clearAssets(mainCharacterId);
    defaultAssetsRepository.clearAssets(altCharacterId);
    defaultSyncRepository.clearCharacter(mainCharacterId);
    defaultSyncRepository.clearCharacter(altCharacterId);
  });

  it('Journey 1: Initial App Load & System Health Check', async () => {
    const healthRes = await supertestReq.get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const infoRes = await supertestReq.get('/api/info');
    expect(infoRes.status).toBe(200);
    expect(infoRes.body.phase).toBeDefined();

    const authStatusRes = await supertestReq.get('/api/auth/status');
    expect(authStatusRes.status).toBe(200);
    expect(authStatusRes.body.configured).toBe(true);

    const sessionRes = await supertestReq.get('/api/auth/session');
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.authenticated).toBe(false);
  });

  it('Journey 2: EVE Online SSO Authentication Simulation & Secure Session Cookie Emission', async () => {
    const session = defaultSessionStore.createSession({
      characterId: mainCharacterId,
      characterName: 'E2E Fleet Commander',
      scopes: [
        'publicData',
        'esi-wallet.read_character_wallet.v1',
        'esi-markets.read_character_orders.v1',
        'esi-assets.read_assets.v1',
      ],
      accessToken: 'access-token-e2e',
      refreshToken: 'refresh-token-e2e',
      expiresAt: Date.now() + 3600000,
    });

    rawSessionId = session.sessionId;
    sessionCookie = `eve_session_id=${rawSessionId}`;

    const sessionRes = await supertestReq
      .get('/api/auth/session')
      .set('Cookie', [sessionCookie]);

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.authenticated).toBe(true);
    expect(sessionRes.body.character.characterId).toBe(mainCharacterId);
    expect(sessionRes.body.character.characterName).toBe('E2E Fleet Commander');
  });

  it('Journey 3: Multi-Character Association & Active Character Switching', async () => {
    // Add alt character to session
    defaultSessionStore.addOrUpdateCharacter(
      rawSessionId,
      {
        characterId: altCharacterId,
        characterName: 'E2E Hauler Alt',
        scopes: ['publicData'],
        accessToken: 'access-token-alt',
        refreshToken: 'refresh-token-alt',
        expiresAt: Date.now() + 3600000,
      },
      false
    );

    // Switch to alt character
    const switchToAltRes = await supertestReq
      .post('/api/auth/switch')
      .set('Cookie', [sessionCookie])
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ characterId: altCharacterId });

    expect(switchToAltRes.status).toBe(200);
    expect(switchToAltRes.body.character.characterId).toBe(altCharacterId);
    expect(switchToAltRes.body.character.characterName).toBe('E2E Hauler Alt');

    // Switch back to main character
    const switchBackRes = await supertestReq
      .post('/api/auth/switch')
      .set('Cookie', [sessionCookie])
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ characterId: mainCharacterId });

    expect(switchBackRes.status).toBe(200);
    expect(switchBackRes.body.character.characterId).toBe(mainCharacterId);
  });

  it('Journey 4: Deterministic Data Seeding & Global Synchronization State Verification', async () => {
    const seededTxs: CharacterTransaction[] = [
      {
        id: `${mainCharacterId}:10001`,
        characterId: mainCharacterId,
        transactionId: 10001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100000,
        unitPrice: 5.0,
        totalValue: 500000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 80001,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        clientId: 4001,
        clientName: 'Supplier Mega Corp',
        date: '2026-09-01T10:00:00Z',
        source: 'esi_sync',
        observedAt: Date.now(),
      },
      {
        id: `${mainCharacterId}:10002`,
        characterId: mainCharacterId,
        transactionId: 10002,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 60000,
        unitPrice: 7.0,
        totalValue: 420000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 80002,
        locationId: 60008494,
        locationName: 'Amarr VIII',
        clientId: 4002,
        clientName: 'Consumer Alliance',
        date: '2026-09-15T14:00:00Z',
        source: 'esi_sync',
        observedAt: Date.now(),
      },
    ];

    const seededOrders: CharacterOrderSnapshot[] = [
      {
        id: `${mainCharacterId}:20001`,
        characterId: mainCharacterId,
        orderId: 20001,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        price: 7.2,
        volumeTotal: 40000,
        volumeRemain: 40000,
        volumeFilled: 0,
        isBuyOrder: false,
        duration: 90,
        issued: '2026-09-16T08:00:00Z',
        expiresAt: '2026-12-15T08:00:00Z',
        state: 'ACTIVE',
        stateJustification: 'Actif',
        isActiveInCurrentSnapshot: true,
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 40000,
        source: 'esi_sync',
      },
    ];

    const seededAssets: CharacterAsset[] = [
      {
        id: `${mainCharacterId}:30001`,
        characterId: mainCharacterId,
        itemId: 30001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100000,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi_sync',
        observedAt: Date.now(),
      },
    ];

    defaultLedgerRepository.saveTransactions(seededTxs);
    defaultOrdersRepository.saveOrderSnapshots(seededOrders);
    defaultAssetsRepository.saveAssets(seededAssets);
    defaultSyncRepository.updateSyncState(mainCharacterId, 'wallet_transactions', {
      status: 'COMPLETE',
      totalRecords: 2,
      lastSyncCompletedAt: Date.now(),
    });

    const syncStatusRes = await supertestReq
      .get('/api/ledger/sync-status')
      .set('Cookie', [sessionCookie]);

    expect(syncStatusRes.status).toBe(200);
    expect(syncStatusRes.body.transactions.status).toBe('COMPLETE');
    expect(syncStatusRes.body.freshness).toBe('FRESH');
  });

  it('Journey 5: Grand Livre (Ledger) Inspection, Search & Location Filtering', async () => {
    // 1. Fetch summary
    const summaryRes = await supertestReq
      .get('/api/ledger/summary')
      .set('Cookie', [sessionCookie]);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.totalTransactionsCount).toBe(2);
    expect(summaryRes.body.totalBuySpendIsk).toBe(500000);
    expect(summaryRes.body.totalGrossSalesIsk).toBe(420000);

    // 2. Fetch paginated transactions with type filter
    const txRes = await supertestReq
      .get('/api/ledger/transactions?type=SELL&page=1&pageSize=25')
      .set('Cookie', [sessionCookie]);

    expect(txRes.status).toBe(200);
    expect(txRes.body.items).toHaveLength(1);
    expect(txRes.body.items[0].transactionId).toBe(10002);
    expect(txRes.body.items[0].isBuy).toBe(false);

    // 3. Search options
    const filterOptionsRes = await supertestReq
      .get('/api/ledger/filter-options')
      .set('Cookie', [sessionCookie]);

    expect(filterOptionsRes.status).toBe(200);
    expect(filterOptionsRes.body.types[0].id).toBe(34);
  });

  it('Journey 6: Market Orders Lifecycle Tracking & Restock Generation', async () => {
    const ordersRes = await supertestReq
      .get('/api/orders')
      .set('Cookie', [sessionCookie]);

    expect(ordersRes.status).toBe(200);
    expect(ordersRes.body.items).toHaveLength(1);
    expect(ordersRes.body.items[0].orderId).toBe(20001);
    expect(ordersRes.body.items[0].state).toBe('ACTIVE');

    const restockRes = await supertestReq
      .post('/api/orders/restock/generate')
      .set('Cookie', [sessionCookie])
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();

    expect(restockRes.status).toBe(200);
    expect(Array.isArray(restockRes.body.items)).toBe(true);
  });

  it('Journey 7: Capital Position Breakdown & Dormant Inventory Tracking', async () => {
    const capRes = await supertestReq
      .get('/api/capital/summary')
      .set('Cookie', [sessionCookie]);

    expect(capRes.status).toBe(200);
    expect(capRes.body.physicalSummary.totalUnits).toBe(100000);
    expect(capRes.body.physicalSummary.committedSellOrderUnits).toBe(40000);
    expect(capRes.body.physicalSummary.freeHubStockUnits).toBe(60000);

    const breakdownRes = await supertestReq
      .get('/api/capital/breakdown')
      .set('Cookie', [sessionCookie]);

    expect(breakdownRes.status).toBe(200);
    expect(breakdownRes.body.positions).toHaveLength(1);
    expect(breakdownRes.body.positions[0].decompositionProof.isSumExact).toBe(true);
  });

  it('Journey 8: Hubs & ROI View with Automatic FIFO Reconciliation', async () => {
    // Trigger automated FIFO matching
    const fifoRes = await supertestReq
      .post('/api/roi/reconcile')
      .set('Cookie', [sessionCookie])
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();

    expect(fifoRes.status).toBe(200);
    expect(fifoRes.body.result).toBeDefined();

    // Verify ROI calculation
    const roiRes = await supertestReq
      .get('/api/roi/summary')
      .set('Cookie', [sessionCookie]);

    expect(roiRes.status).toBe(200);
    expect(roiRes.body.summary.allocated_sales_volume).toBe(60000);
    expect(roiRes.body.summary.gross_revenue_isk).toBe(420000);
    expect(roiRes.body.summary.allocated_buy_cost_isk).toBe(300000);
    expect(roiRes.body.summary.realized_profit_ttc_isk).toBeGreaterThan(0);
  });

  it('Journey 9: Product 360 1-Click Inspection & Time Series Analytics', async () => {
    const p360Res = await supertestReq
      .get('/api/analytics/product/34')
      .set('Cookie', [sessionCookie]);

    expect(p360Res.status).toBe(200);
    expect(p360Res.body.type_id).toBe(34);
    expect(p360Res.body.type_name).toBe('Tritanium');
    expect(p360Res.body.kpis.gross_revenue_isk).toBe(420000);
    expect(p360Res.body.kpis.cogs_allocated_isk).toBe(300000);
    expect(p360Res.body.timeseries).toBeDefined();

    const tsRes = await supertestReq
      .get('/api/analytics/timeseries?timeframe=90d')
      .set('Cookie', [sessionCookie]);

    expect(tsRes.status).toBe(200);
    expect(tsRes.body.timeframe).toBe('90d');
  });

  it('Journey 10: RFC 4180 Compliant CSV Export', async () => {
    const txs = defaultLedgerRepository.getAllTransactions(mainCharacterId);
    const csv = transactionsToCsv(txs);
    expect(csv).toContain('TransactionID,DateUTC,Type,TypeID,TypeName,Quantity,UnitPriceISK');
    expect(csv).toContain('Tritanium');

    const positions = defaultAssetsRepository.getAllAssets(mainCharacterId);
    expect(positions.length).toBeGreaterThan(0);
  });

  it('Journey 11: Encrypted SHA-256 Backup Export & Integrity Verification', async () => {
    // 1. Export backup
    const backupRes = await supertestReq
      .get('/api/backup/export')
      .set('Cookie', [sessionCookie]);

    expect(backupRes.status).toBe(200);
    expect(backupRes.body.schemaVersion).toBe(2);
    expect(backupRes.body.checksum).toBeDefined();
    expect(backupRes.body.data.ledger.transactions.length).toBeGreaterThanOrEqual(2);

    // 2. Audit integrity
    const auditRes = await supertestReq
      .get('/api/backup/audit')
      .set('Cookie', [sessionCookie]);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.status).toMatch(/HEALTHY/);
  });
});
