// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp, bootstrapApp } from './server.ts';
import { StorageManager } from './src/server/storage/database.ts';

describe('Server API Endpoints', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();
  });

  it('initializes express app with /api/health and /api/info routes', async () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');

    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    const infoRes = await request(app).get('/api/info');
    expect(infoRes.status).toBe(200);
    expect(infoRes.body.phase).toBe('PHASE-G04-corp-deduplication-backup-probes');

    const liveRes = await request(app).get('/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('live');

    const readyRes = await request(app).get('/health/ready');
    expect([200, 503]).toContain(readyRes.status);
    expect(readyRes.body.status).toBeDefined();

    const metricsRes = await request(app).get('/api/system/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.system).toBeDefined();

    const diagRes = await request(app).get('/api/system/diagnostics');
    expect([200, 503]).toContain(diagRes.status);
    expect(diagRes.body.status).toBeDefined();
  });

  it('protects /api/capital, /api/analytics, and /api/operations routes against unauthenticated requests', async () => {
    const capRes = await request(app).get('/api/capital/summary');
    expect(capRes.status).toBe(401);

    const opsRes = await request(app).get('/api/operations/plan');
    expect(opsRes.status).toBe(401);

    const analyticsProductRes = await request(app).get('/api/analytics/product/34');
    expect(analyticsProductRes.status).toBe(401);

    const analyticsTsRes = await request(app).get('/api/analytics/timeseries');
    expect(analyticsTsRes.status).toBe(401);
  });

  it('Phase G02: bootstrapApp performs ordered async startup and logs lifecycle stages', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    try {
      const res = await bootstrapApp();
      expect(res.app).toBeDefined();

      const dbConnectedIdx = logs.findIndex((l) => l.includes('[Bootstrap] DB Connected'));
      const migrationsIdx = logs.findIndex((l) => l.includes('[Bootstrap] Migrations Applied'));
      const servicesReadyIdx = logs.findIndex((l) => l.includes('[Bootstrap] Services Ready'));

      expect(dbConnectedIdx).toBeGreaterThanOrEqual(0);
      expect(migrationsIdx).toBeGreaterThanOrEqual(dbConnectedIdx);
      expect(servicesReadyIdx).toBeGreaterThanOrEqual(migrationsIdx);
    } finally {
      console.log = originalLog;
    }
  });

  it('Phase G02: fails fast during bootstrap if database connection fails', async () => {
    const originalManager = StorageManager.getInstance();
    const originalConfig = originalManager.getConfig();
    try {
      StorageManager.resetInstance({
        engine: 'postgres',
        databaseUrl: 'postgresql://invalid_user:invalid_pass@127.0.0.1:54329/nonexistent_db?connect_timeout=1',
      });

      await expect(bootstrapApp()).rejects.toThrow();
    } finally {
      StorageManager.resetInstance(originalConfig);
    }
  });
});


