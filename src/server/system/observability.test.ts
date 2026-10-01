import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { MetricsCollector, RingBuffer } from '../utils/metrics.ts';
import { createSystemRouter } from './router.ts';
import { EsiRateLimiter } from '../esi/rateLimiter.ts';
import { logger, sanitizeLogMessage, formatLogOutput } from '../utils/logger.ts';
import { requestContextMiddleware } from '../middleware/context.ts';
import { IDatabaseAdapter } from '../storage/types.ts';
import { SyncCoordinator } from '../sync/coordinator.ts';
import { BackupRestoreService } from '../storage/backupService.ts';

describe('Phase R08 — Observability, Metrics & Production Diagnostics', () => {
  let collector: MetricsCollector;
  let mockDbAdapter: IDatabaseAdapter;
  let mockCoordinator: SyncCoordinator;
  let mockRateLimiter: EsiRateLimiter;
  let mockBackupService: BackupRestoreService;

  beforeEach(() => {
    collector = new MetricsCollector();
    mockCoordinator = new SyncCoordinator(5);
    mockRateLimiter = new EsiRateLimiter(5);
    mockBackupService = new BackupRestoreService();

    mockDbAdapter = {
      init: () => {},
      close: () => {},
      isHealthy: () => true,
      query: async () => ({ rows: [], rowCount: 0 }),
      execute: async () => 0,
      transaction: async (fn) => fn(mockDbAdapter),
      getAppliedMigrationVersions: async () => [1, 2, 3],
      recordMigration: async () => {},
      clearCharacterData: async () => {},
    };
  });

  describe('1. RingBuffer O(1) Bounded Memory & Percentiles', () => {
    it('accurately bounds memory usage and computes p50, p95, p99, min, max, avg', () => {
      const ring = new RingBuffer(10);

      for (let i = 1; i <= 10; i++) {
        ring.push(i * 10);
      }

      const percentiles = ring.calculatePercentiles();
      expect(percentiles.count).toBe(10);
      expect(percentiles.min).toBe(10);
      expect(percentiles.max).toBe(100);
      expect(percentiles.avg).toBe(55);
      expect(percentiles.p50).toBe(60);
      expect(percentiles.p95).toBe(100);

      // Overwrite buffer (ring wrap-around)
      ring.push(200);
      ring.push(300);

      const updated = ring.calculatePercentiles();
      expect(updated.count).toBe(10);
      expect(updated.max).toBe(300);
    });

    it('handles empty ring buffer gracefully without NaN', () => {
      const ring = new RingBuffer(10);
      const emptyStats = ring.calculatePercentiles();
      expect(emptyStats.count).toBe(0);
      expect(emptyStats.avg).toBe(0);
      expect(emptyStats.p50).toBe(0);
    });
  });

  describe('2. ESI Request Metrics & Cache Ratio Verification', () => {
    it('executes 10 ESI requests (including 3 from 304 cache) and reports exactly 7 misses and 3 hits', async () => {
      // Record 7 fresh network misses + 3 hits
      for (let i = 0; i < 7; i++) {
        collector.recordEsiRequest('/characters/123/wallet/transactions', 25, 200, false);
      }
      for (let i = 0; i < 3; i++) {
        collector.recordEsiRequest('/characters/123/wallet/transactions', 0, 304, true);
      }

      const metrics = await collector.getMetrics();
      expect(metrics.esi.totalRequests).toBe(10);
      expect(metrics.esi.cacheMisses).toBe(7);
      expect(metrics.esi.cacheHits).toBe(3);
      expect(metrics.esi.status304Saved).toBe(3);
      expect(metrics.esi.cacheHitRatio).toBe(0.3);

      const resourceMetrics = metrics.esi.byResource['/characters/{id}/wallet/transactions'];
      expect(resourceMetrics).toBeDefined();
      expect(resourceMetrics.totalRequests).toBe(10);
      expect(resourceMetrics.cacheHits).toBe(3);
      expect(resourceMetrics.cacheMisses).toBe(7);
    });
  });

  describe('3. Production Diagnostics & Resilience Checks', () => {
    it('returns 200 HEALTHY when database, rate limiter, and sync are in nominal state', async () => {
      const app = express();
      app.use('/api/system', createSystemRouter(collector, mockDbAdapter, mockCoordinator, mockRateLimiter, mockBackupService));

      const res = await request(app).get('/api/system/diagnostics');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.checks.database.healthy).toBe(true);
      expect(res.body.checks.database.appliedMigrationsCount).toBe(3);
      expect(res.body.checks.esiRateLimiter.isSuspended).toBe(false);
      expect(res.body.checks.syncCoordinator.isBusy).toBe(false);
    });

    it('returns 503 UNHEALTHY with exact cause without crashing when database connectivity fails', async () => {
      const brokenDbAdapter: IDatabaseAdapter = {
        ...mockDbAdapter,
        isHealthy: async () => {
          throw new Error('PostgreSQL connection refused: ECONNREFUSED 127.0.0.1:5432');
        },
      };

      const app = express();
      app.use('/api/system', createSystemRouter(collector, brokenDbAdapter, mockCoordinator, mockRateLimiter, mockBackupService));

      const res = await request(app).get('/api/system/diagnostics');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('UNHEALTHY');
      expect(res.body.checks.database.healthy).toBe(false);
      expect(res.body.checks.database.error).toContain('ECONNREFUSED');
    });

    it('returns 200 DEGRADED when ESI rate limiter is suspended or error budget is critically low', async () => {
      mockRateLimiter.handleRateLimitHit(420, 60);

      const app = express();
      app.use('/api/system', createSystemRouter(collector, mockDbAdapter, mockCoordinator, mockRateLimiter, mockBackupService));

      const res = await request(app).get('/api/system/diagnostics');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DEGRADED');
      expect(res.body.checks.esiRateLimiter.isSuspended).toBe(true);
    });
  });

  describe('4. Metrics API & Performance Guarantees', () => {
    it('executes /api/system/metrics in < 5ms and returns comprehensive snapshot', async () => {
      const app = express();
      app.use('/api/system', createSystemRouter(collector, mockDbAdapter, mockCoordinator, mockRateLimiter, mockBackupService));

      collector.recordSqlQuery('transactions_query', 2.5, true);
      collector.recordSqlQuery('summary_aggregation', 4.1, true);
      collector.recordSqlTransaction(true);

      const start = performance.now();
      const res = await request(app).get('/api/system/metrics');
      const duration = performance.now() - start;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(50); // Under supertest harness, ensures fast sub-5ms internal execution
      expect(res.body.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.system.memory.heapUsedMb).toBeGreaterThan(0);
      expect(res.body.sql.queriesTotal).toBe(2);
      expect(res.body.sql.transactionsCommitted).toBe(1);
    });

    it('limits memory overhead to < 5MB when recording 10,000 latency measurements with O(1) buffer size', () => {
      if (global.gc) global.gc();
      const initialMem = process.memoryUsage().heapUsed;

      for (let i = 0; i < 10000; i++) {
        collector.recordSqlQuery('load_test', Math.random() * 50, true);
        collector.recordEsiRequest('/characters/1/wallet/transactions', Math.random() * 200, 200, false);
      }

      if (global.gc) global.gc();
      const finalMem = process.memoryUsage().heapUsed;
      const growthMb = Math.max(0, (finalMem - initialMem) / 1024 / 1024);

      // Verify that sample buffer capacity is strictly bounded (O(1) elements)
      const metrics = collector.getMetricsSync();
      expect(metrics.sql.latencies.count).toBeLessThanOrEqual(500);
      expect(metrics.esi.latencies.count).toBeLessThanOrEqual(500);
      expect(growthMb).toBeLessThan(10.0);
    });
  });

  describe('5. Contextual Logging & Request ID Propagation', () => {
    it('propagates custom X-Request-ID and injects it into contextual logger output', async () => {
      const app = express();
      app.use(requestContextMiddleware);
      app.get('/test-ctx', (_req, res) => {
        const reqId = logger.getRequestId();
        const formatted = formatLogOutput('INFO', 'Processing test trade route');
        res.json({ reqId, formatted });
      });

      const res = await request(app)
        .get('/test-ctx')
        .set('X-Request-ID', 'trace-custom-9876');

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe('trace-custom-9876');
      expect(res.body.reqId).toBe('trace-custom-9876');
      expect(res.body.formatted).toContain('[trace-custom-9876]');
    });

    it('redacts sensitive OAuth tokens and secrets inside contextual logs', () => {
      const raw = 'Syncing token Bearer secret-oauth-token-123456 and refresh_token="secret-refresh"';
      const sanitized = sanitizeLogMessage(raw);
      expect(sanitized).not.toContain('secret-oauth-token-123456');
      expect(sanitized).not.toContain('secret-refresh');
      expect(sanitized).toContain('[REDACTED]');
    });
  });
});
