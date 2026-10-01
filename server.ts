import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthRouter } from './src/server/auth/router.ts';
import { createEsiRouter } from './src/server/esi/router.ts';
import { createLedgerRouter } from './src/server/ledger/router.ts';
import { createOrdersRouter } from './src/server/orders/router.ts';
import { createHubsRouter } from './src/server/hubs/router.ts';
import { createRoiRouter } from './src/server/roi/router.ts';
import { createAssetsRouter } from './src/server/assets/router.ts';
import { createCapitalRouter } from './src/server/capital/router.ts';
import { createAnalyticsRouter } from './src/server/analytics/router.ts';
import { createOperationsRouter } from './src/server/operations/router.ts';
import { createBackupRouter } from './src/server/storage/router.ts';
import { createSystemRouter } from './src/server/system/router.ts';
import { requestContextMiddleware } from './src/server/middleware/context.ts';
import { securityHeadersMiddleware, csrfProtectionMiddleware } from './src/server/middleware/security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Request correlation & context tracking
  app.use(requestContextMiddleware);

  // Security Headers and CORS
  app.use(securityHeadersMiddleware);
  app.use(cors({
    origin: (origin, callback) => {
      // Allow local and current applet origins
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('run.app')) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '20mb' }));
  app.use(csrfProtectionMiddleware);

  // API Routes
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'eve-trade-dashboard',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  app.get('/api/info', (_req: Request, res: Response) => {
    res.json({
      name: 'EVE Trade Dashboard',
      description: 'EVE Online trade dashboard',
      phase: 'PHASE-11-restock-and-transfers',
      status: 'operational',
    });
  });

  // Auth Router
  app.use('/api/auth', createAuthRouter());

  // System Observability & Diagnostics Router
  app.use('/api/system', createSystemRouter());

  // ESI Gateway Router
  app.use('/api/esi', createEsiRouter());

  // Sales Ledger Router
  app.use('/api/ledger', createLedgerRouter());

  // Orders Lifecycle & Restock Router
  app.use('/api/orders', createOrdersRouter());

  // Operations: Logistics Transfers & Replenishment Router
  app.use('/api/operations', createOperationsRouter());

  // Hubs Router
  app.use('/api/hubs', createHubsRouter());

  // ROI TTC Router
  app.use('/api/roi', createRoiRouter());

  // ESI Assets Router
  app.use('/api/assets', createAssetsRouter());

  // Capital & Inventory Positions Router
  app.use('/api/capital', createCapitalRouter());

  // Analytics & Product 360 Router
  app.use('/api/analytics', createAnalyticsRouter());

  // Backup & Storage Reliability Router
  app.use('/api/backup', createBackupRouter());

  // Vite middleware in dev or static serving in prod
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  return app;
}

// Start server when executed directly
const isDirectExecution =
  process.env.NODE_ENV !== 'test' &&
  !process.env.VITEST &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  createApp().then((app) => {
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    const HOST = '0.0.0.0';
    app.listen(PORT, HOST, () => {
      console.log(`[EVE Trade Dashboard] Server running on http://${HOST}:${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
