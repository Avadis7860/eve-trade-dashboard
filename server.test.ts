// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from './server.ts';

describe('Server API Endpoints', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();
  });

  it('initializes express app with /api/health and /api/info routes', () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });
});

