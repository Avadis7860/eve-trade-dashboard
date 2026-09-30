import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthRouter } from './src/server/auth/router.ts';
import { createEsiRouter } from './src/server/esi/router.ts';
import { createLedgerRouter } from './src/server/ledger/router.ts';
import { createOrdersRouter } from './src/server/orders/router.ts';
import { hubsRouter } from './src/server/hubs/router.ts';
import { roiRouter } from './src/server/roi/router.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  const app = express();
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json());

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
      phase: 'PHASE-05-hubs-and-roi',
      status: 'operational',
    });
  });

  // Auth Router
  app.use('/api/auth', createAuthRouter());

  // ESI Gateway Router
  app.use('/api/esi', createEsiRouter());

  // Sales Ledger Router
  app.use('/api/ledger', createLedgerRouter());

  // Orders Lifecycle & Restock Router
  app.use('/api/orders', createOrdersRouter());

  // Hubs Router
  app.use('/api/hubs', hubsRouter);

  // ROI TTC Router
  app.use('/api/roi', roiRouter);

  // Vite middleware in dev or static serving in prod
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
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
const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url) || !process.env.VITEST;

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
