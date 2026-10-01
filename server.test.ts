// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from './server.ts';

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
    expect(infoRes.body.phase).toBe('PHASE-R08-observability-production');

    const metricsRes = await request(app).get('/api/system/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.system).toBeDefined();

    const diagRes = await request(app).get('/api/system/diagnostics');
    expect([200, 503]).toContain(diagRes.status);
    expect(diagRes.body.status).toBeDefined();
  });

  it('protects /api/capital and /api/analytics routes against unauthenticated requests', async () => {
    const capRes = await request(app).get('/api/capital/summary');
    expect(capRes.status).toBe(401);

    const analyticsProductRes = await request(app).get('/api/analytics/product/34');
    expect(analyticsProductRes.status).toBe(401);

    const analyticsTsRes = await request(app).get('/api/analytics/timeseries');
    expect(analyticsTsRes.status).toBe(401);
  });
});


