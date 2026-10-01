// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../server.ts';
import { defaultSessionStore } from './auth/sessionStore.ts';
import { defaultLedgerRepository } from './ledger/repository.ts';
import { defaultOrdersRepository } from './orders/repository.ts';
import { defaultAssetsRepository } from './assets/repository.ts';
import { defaultSyncRepository } from './sync/repository.ts';
import { defaultEsiRateLimiter } from './esi/rateLimiter.ts';

describe('Level 3: HTTP API & Middleware Endpoints Exhaustive Test Suite', () => {
  let app: Express;
  let sessionToken: string;
  let multiCharSessionToken: string;
  const testCharId = 888001;
  const secondaryCharId = 888002;
  const foreignCharId = 999999;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();

    // Create session for primary character
    const primarySession = defaultSessionStore.createSession({
      characterId: testCharId,
      characterName: 'Primary Test Pilot',
      scopes: [
        'publicData',
        'esi-wallet.read_character_wallet.v1',
        'esi-markets.read_character_orders.v1',
        'esi-assets.read_assets.v1',
      ],
      accessToken: 'access-888001',
      refreshToken: 'refresh-888001',
      expiresAt: Date.now() + 3600000,
    });
    sessionToken = primarySession.sessionId;

    // Create multi-character session
    const multiSession = defaultSessionStore.createSession({
      characterId: testCharId,
      characterName: 'Primary Test Pilot',
      scopes: ['publicData'],
      accessToken: 'access-888001',
      refreshToken: 'refresh-888001',
      expiresAt: Date.now() + 3600000,
    });
    multiSession.characters = {
      [testCharId]: {
        characterId: testCharId,
        characterName: 'Primary Test Pilot',
        scopes: ['publicData'],
        accessToken: 'access-888001',
        refreshToken: 'refresh-888001',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
      [secondaryCharId]: {
        characterId: secondaryCharId,
        characterName: 'Secondary Alt Pilot',
        scopes: ['publicData'],
        accessToken: 'access-888002',
        refreshToken: 'refresh-888002',
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      },
    };
    multiCharSessionToken = multiSession.sessionId;

    // Seed test data for testCharId
    defaultLedgerRepository.saveTransactions([
      {
        id: `${testCharId}:1001`,
        characterId: testCharId,
        transactionId: 1001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 10000,
        unitPrice: 5.5,
        totalValue: 55000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 5001,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        clientId: 3001,
        clientName: 'Supplier Corp',
        date: '2026-09-30T10:00:00Z',
        source: 'test',
        observedAt: Date.now(),
      },
      {
        id: `${testCharId}:1002`,
        characterId: testCharId,
        transactionId: 1002,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 5000,
        unitPrice: 6.5,
        totalValue: 32500,
        isBuy: false,
        isPersonal: true,
        journalRefId: 5002,
        locationId: 60008494,
        locationName: 'Amarr VIII',
        clientId: 3002,
        clientName: 'Consumer Corp',
        date: '2026-09-30T11:00:00Z',
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    defaultOrdersRepository.saveOrderSnapshots([
      {
        id: `${testCharId}:2001`,
        characterId: testCharId,
        orderId: 2001,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        price: 6.5,
        volumeTotal: 5000,
        volumeRemain: 5000,
        volumeFilled: 0,
        isBuyOrder: false,
        duration: 90,
        issued: '2026-09-30T09:00:00Z',
        expiresAt: '2026-12-29T09:00:00Z',
        state: 'ACTIVE',
        stateJustification: 'Actif',
        isActiveInCurrentSnapshot: true,
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 5000,
        source: 'test',
      },
    ]);

    defaultAssetsRepository.saveAssets([
      {
        id: `${testCharId}:3001`,
        characterId: testCharId,
        itemId: 3001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 20000,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'test',
        observedAt: Date.now(),
      },
    ]);

    defaultSyncRepository.updateSyncState(testCharId, 'wallet_transactions', {
      status: 'COMPLETE',
      totalRecords: 2,
      lastSyncCompletedAt: Date.now(),
    });
  });

  describe('1. Public Routes & System Headers', () => {
    it('returns 200 with security headers for /api/health', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('returns 200 with system info for /api/info', async () => {
      const res = await request(app).get('/api/info');
      expect(res.status).toBe(200);
      expect(res.body.phase).toBeDefined();
    });

    it('returns 200 for /api/auth/status', async () => {
      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured');
    });

    it('returns unauthenticated session status when no cookie is sent', async () => {
      const res = await request(app).get('/api/auth/session');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('2. Authentication & Multi-Character Session Guard', () => {
    it('returns authenticated user details when session cookie is provided', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.character.characterId).toBe(testCharId);
      expect(res.body.character.characterName).toBe('Primary Test Pilot');
    });

    it('switches active character successfully in multi-character session', async () => {
      const res = await request(app)
        .post('/api/auth/switch')
        .set('Cookie', [`eve_session_id=${multiCharSessionToken}`])
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ characterId: secondaryCharId });

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.character.characterId).toBe(secondaryCharId);
    });

    it('rejects character switch to unauthorized character with 404', async () => {
      const res = await request(app)
        .post('/api/auth/switch')
        .set('Cookie', [`eve_session_id=${multiCharSessionToken}`])
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ characterId: foreignCharId });

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    it('performs logout and clears cookie on /api/auth/logout', async () => {
      const tempSession = defaultSessionStore.createSession({
        characterId: 999111,
        characterName: 'Temp Logout Pilot',
        scopes: ['publicData'],
        accessToken: 'access-temp',
        refreshToken: 'refresh-temp',
        expiresAt: Date.now() + 60000,
      });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`eve_session_id=${tempSession.sessionId}`])
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(defaultSessionStore.getSession(tempSession.sessionId)).toBeNull();
    });
  });

  describe('3. Ledger Endpoints (/api/ledger/*)', () => {
    it('returns 401 when accessing ledger without session', async () => {
      const res = await request(app).get('/api/ledger/transactions');
      expect(res.status).toBe(401);
    });

    it('returns 200 with paginated transactions for authenticated user', async () => {
      const res = await request(app)
        .get('/api/ledger/transactions?page=1&pageSize=10')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.freshness).toBeDefined();
    });

    it('returns 200 with fallback defaults for out-of-range pagination', async () => {
      const res = await request(app)
        .get('/api/ledger/transactions?page=1&pageSize=50')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });

    it('returns transaction details by ID for /api/ledger/transactions/:id', async () => {
      const res = await request(app)
        .get('/api/ledger/transactions/1001')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.transaction).toBeDefined();
      expect(res.body.transaction.transactionId).toBe(1001);
      expect(res.body.transaction.typeName).toBe('Tritanium');
    });

    it('returns 404 for non-existent transaction ID', async () => {
      const res = await request(app)
        .get('/api/ledger/transactions/999999')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns ledger summary metrics on /api/ledger/summary', async () => {
      const res = await request(app)
        .get('/api/ledger/summary')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.totalTransactionsCount).toBe(2);
      expect(res.body.buyTransactionsCount).toBe(1);
      expect(res.body.sellTransactionsCount).toBe(1);
      expect(res.body.totalBuySpendIsk).toBe(55000);
      expect(res.body.totalGrossSalesIsk).toBe(32500);
      expect(res.body.completeness).toBe('COMPLETE');
    });

    it('returns filter options on /api/ledger/filter-options', async () => {
      const res = await request(app)
        .get('/api/ledger/filter-options')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.types).toHaveLength(1);
      expect(res.body.types[0].name).toBe('Tritanium');
    });

    it('returns sync status on /api/ledger/sync-status', async () => {
      const res = await request(app)
        .get('/api/ledger/sync-status')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.transactions.status).toBe('COMPLETE');
      expect(res.body.freshness).toBe('FRESH');
    });

    it('enforces character isolation: blocks access to other character data with 403', async () => {
      const res = await request(app)
        .get(`/api/ledger/transactions?characterId=${foreignCharId}`)
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(403);
    });
  });

  describe('4. Orders & Restock Endpoints (/api/orders/*)', () => {
    it('returns 200 with orders on /api/orders', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].orderId).toBe(2001);
      expect(res.body.items[0].state).toBe('ACTIVE');
    });

    it('returns orders summary on /api/orders/summary', async () => {
      const res = await request(app)
        .get('/api/orders/summary')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.activeOrdersCount).toBe(1);
      expect(res.body.totalActiveIskValue).toBe(32500);
    });

    it('generates restock suggestions on POST /api/orders/restock/generate', async () => {
      const res = await request(app)
        .post('/api/orders/restock/generate')
        .set('Cookie', [`eve_session_id=${sessionToken}`])
        .set('X-Requested-With', 'XMLHttpRequest')
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('generated');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('returns restock items on GET /api/orders/restock', async () => {
      const res = await request(app)
        .get('/api/orders/restock')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('5. ROI & Hubs Endpoints (/api/roi/* & /api/hubs/*)', () => {
    it('returns hubs list on /api/hubs', async () => {
      const res = await request(app)
        .get('/api/hubs')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.hubs)).toBe(true);
      expect(res.body.hubs.length).toBeGreaterThanOrEqual(1);
    });

    it('returns hubs location mappings on /api/hubs/mappings', async () => {
      const res = await request(app)
        .get('/api/hubs/mappings')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.mappings)).toBe(true);
    });

    it('executes automated FIFO reconciliation on POST /api/roi/reconcile', async () => {
      const res = await request(app)
        .post('/api/roi/reconcile')
        .set('Cookie', [`eve_session_id=${sessionToken}`])
        .set('X-Requested-With', 'XMLHttpRequest')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
    });

    it('returns ROI summary on /api/roi/summary', async () => {
      const res = await request(app)
        .get('/api/roi/summary')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.coverage_status).toBeDefined();
    });

    it('returns explicit allocations on /api/roi/allocations', async () => {
      const res = await request(app)
        .get('/api/roi/allocations')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.allocations)).toBe(true);
      expect(res.body.allocations.length).toBeGreaterThanOrEqual(1);
    });

    it('returns unsold inventory lots on /api/roi/unsold-inventory', async () => {
      const res = await request(app)
        .get('/api/roi/unsold-inventory')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.inventory)).toBe(true);
    });
  });

  describe('6. Capital & Breakdown Endpoints (/api/capital/*)', () => {
    it('returns capital summary on /api/capital/summary', async () => {
      const res = await request(app)
        .get('/api/capital/summary')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.monetary).toBeDefined();
      expect(res.body.physicalSummary).toBeDefined();
      expect(res.body.dormantSummary).toBeDefined();
    });

    it('returns positions breakdown on /api/capital/breakdown', async () => {
      const res = await request(app)
        .get('/api/capital/breakdown')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.positions).toBeDefined();
      expect(Array.isArray(res.body.positions)).toBe(true);
    });

    it('returns dormant stock positions on /api/capital/dormant', async () => {
      const res = await request(app)
        .get('/api/capital/dormant')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.totalDormantItems).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('7. Analytics & Product 360 Endpoints (/api/analytics/*)', () => {
    it('returns Product 360 inspection for /api/analytics/product/34', async () => {
      const res = await request(app)
        .get('/api/analytics/product/34')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.type_id).toBe(34);
      expect(res.body.type_name).toBe('Tritanium');
      expect(res.body.kpis).toBeDefined();
      expect(res.body.locations_breakdown).toBeDefined();
    });

    it('returns 400 when invalid typeId is passed to Product 360', async () => {
      const res = await request(app)
        .get('/api/analytics/product/invalid-type')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns timeseries analysis on /api/analytics/timeseries', async () => {
      const res = await request(app)
        .get('/api/analytics/timeseries?timeframe=30d&groupBy=day')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.timeframe).toBe('30d');
      expect(res.body.data_points).toBeDefined();
      expect(res.body.freshness_status).toBeDefined();
    });
  });

  describe('8. Backup, Restore & Data Audit Endpoints (/api/backup/*)', () => {
    it('exports SHA-256 verified backup snapshot on GET /api/backup/export', async () => {
      const res = await request(app)
        .get('/api/backup/export')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.schemaVersion).toBe(2);
      expect(res.body.checksum).toBeDefined();
      expect(res.body.data.ledger.transactions).toBeDefined();
    });

    it('performs data integrity audit on GET /api/backup/audit', async () => {
      const res = await request(app)
        .get('/api/backup/audit')
        .set('Cookie', [`eve_session_id=${sessionToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.status).toMatch(/HEALTHY|WARNING/);
      expect(res.body.summary).toBeDefined();
    });

    it('rejects tampered backup imports with 400 checksum mismatch on /api/backup/restore', async () => {
      const tamperedBackup = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        checksum: 'invalid-sha256-checksum',
        data: {
          ledger: { transactions: [], journalEntries: [] },
          orders: { snapshots: [], restockItems: [] },
          hubs: { definitions: [], mappings: [] },
          roi: { allocations: [], openingBalances: [] },
          assets: { assets: [] },
          sync: { states: [] },
        },
      };

      const res = await request(app)
        .post('/api/backup/restore')
        .set('Cookie', [`eve_session_id=${sessionToken}`])
        .set('X-Requested-With', 'XMLHttpRequest')
        .send(tamperedBackup);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/checksum/i);
    });
  });

  describe('9. Rate Limiting & ESI Error Window Resilience (429 handling)', () => {
    it('handles rate limiter status checking on /api/esi/status', async () => {
      const res = await request(app).get('/api/esi/status');
      expect(res.status).toBe(200);
      expect(res.body.rateLimit).toBeDefined();
      expect(res.body.rateLimit.errorLimitRemain).toBeGreaterThan(0);
    });

    it('correctly handles suspended rate limit state', async () => {
      // Simulate rate limiter suspension
      defaultEsiRateLimiter.handleRateLimitHit(420, 60); // ESI 420
      expect(defaultEsiRateLimiter.isSuspended()).toBe(true);

      const status = defaultEsiRateLimiter.getStatus();
      expect(status.isSuspended).toBe(true);
      expect(status.suspendedUntil).toBeGreaterThan(Date.now());

      // Reset for subsequent tests
      defaultEsiRateLimiter.reset();
    });
  });

  describe('10. System Observability & Production Diagnostics (/api/system/*)', () => {
    it('returns real-time metrics on GET /api/system/metrics with latency percentiles and memory stats', async () => {
      const res = await request(app).get('/api/system/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.body.system).toBeDefined();
      expect(res.body.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.system.memory.heapUsedMb).toBeGreaterThan(0);
      expect(res.body.esi).toBeDefined();
      expect(res.body.sql).toBeDefined();
      expect(res.body.business).toBeDefined();
    });

    it('returns diagnostic self-test report on GET /api/system/diagnostics', async () => {
      const res = await request(app).get('/api/system/diagnostics');
      expect([200, 503]).toContain(res.status);
      expect(res.body.status).toMatch(/HEALTHY|DEGRADED|UNHEALTHY/);
      expect(res.body.checks.database).toBeDefined();
      expect(res.body.checks.syncCoordinator).toBeDefined();
      expect(res.body.checks.esiRateLimiter).toBeDefined();
      expect(res.body.checks.dataIntegrity).toBeDefined();
    });
  });
});
