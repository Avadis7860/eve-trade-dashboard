import { createApp } from '../server.ts';
import supertest from 'supertest';
import { StorageManager, DurableFileDatabaseAdapter } from '../src/server/storage/database.ts';
import { PersistentLedgerRepository } from '../src/server/ledger/repository.ts';
import { PersistentOrdersRepository } from '../src/server/orders/repository.ts';
import { HubsRepository } from '../src/server/hubs/repository.ts';
import { RoiRepository } from '../src/server/roi/repository.ts';
import { PersistentAssetsRepository } from '../src/server/assets/repository.ts';
import { RoiService } from '../src/server/roi/service.ts';
import { AnalyticsService } from '../src/server/analytics/service.ts';
import { HubsService } from '../src/server/hubs/service.ts';
import { AssetsService } from '../src/server/assets/service.ts';
import { CapitalService } from '../src/server/capital/service.ts';
import { defaultUniverseService } from '../src/server/universe/service.ts';
import { defaultSyncRepository } from '../src/server/sync/repository.ts';
import { defaultSessionStore } from '../src/server/auth/sessionStore.ts';
import type { CharacterTransaction } from '../src/server/ledger/types.ts';
import type { CharacterOrderSnapshot } from '../src/server/orders/types.ts';
import type { CharacterAsset } from '../src/server/assets/types.ts';
import fs from 'node:fs';
import path from 'node:path';

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
  payloadBytes: number;
}

function computeStats(samples: number[], payloadBytes: number): LatencyStats {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: 0, payloadBytes: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return {
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    samples: sorted.length,
    payloadBytes,
  };
}

async function runEndpointBenchmark(request: any, sessionId: string, endpoint: string, iterations = 30): Promise<LatencyStats> {
  const durations: number[] = [];
  let payloadBytes = 0;

  // Warmup
  await request
    .get(endpoint)
    .set('Cookie', [`eve_trade_session=${sessionId}`]);

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await request
      .get(endpoint)
      .set('Cookie', [`eve_trade_session=${sessionId}`]);
    const duration = performance.now() - start;
    durations.push(duration);
    if (i === 0 && res.text) {
      payloadBytes = Buffer.byteLength(res.text, 'utf8');
    }
  }

  return computeStats(durations, payloadBytes);
}

function generateSyntheticData(characterId: number, count: number) {
  const transactions: CharacterTransaction[] = [];
  const baseDate = new Date('2026-01-01T00:00:00Z').getTime();

  for (let i = 1; i <= count; i++) {
    const isBuy = i % 2 === 1;
    const typeId = (i % 20) + 34; // 20 distinct item types
    const quantity = (i % 10 + 1) * 100;
    const unitPrice = 1000 + (i % 50) * 10;
    const totalValue = quantity * unitPrice;
    const date = new Date(baseDate + i * 3600 * 1000).toISOString();

    transactions.push({
      id: `tx-bench-${characterId}-${i}`,
      characterId,
      transactionId: 1000000 + i,
      date,
      typeId,
      typeName: `Synthetic Item ${typeId}`,
      quantity,
      unitPrice,
      totalValue,
      isBuy,
      isPersonal: true,
      journalRefId: 2000000 + i,
      locationId: (i % 5 === 0) ? 60003760 : 60008494,
      locationName: (i % 5 === 0) ? 'Jita IV-4' : 'Amarr VIII',
      clientId: 3000000 + (i % 10),
      clientName: `Trader ${(i % 10)}`,
      source: 'esi_sync',
      observedAt: baseDate + i * 3600 * 1000,
      tax: isBuy ? 0 : totalValue * 0.036,
      brokerFee: totalValue * 0.012,
      netValue: isBuy ? totalValue : totalValue * 0.952,
    });
  }

  return transactions;
}

export async function runFullBaseline() {
  console.log('='.repeat(80));
  console.log('  EVE TRADE DASHBOARD — BENCHMARK DE RÉFÉRENCE BASELINE (PHASE R00)');
  console.log('='.repeat(80));
  console.log(`Date d'exécution : ${new Date().toISOString()}`);
  console.log(`Node.js Version  : ${process.version}`);
  console.log(`Architecture     : ${process.arch} (${process.platform})`);
  console.log('-'.repeat(80));

  // 1. Initial Memory & Startup Baseline
  const memStartup = process.memoryUsage();
  console.log('\n[1/5] Mesure du démarrage serveur & empreinte mémoire initiale :');
  console.log(`  - Heap Utilisé   : ${(memStartup.heapUsed / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  - Heap Total     : ${(memStartup.heapTotal / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  - RSS (Résident) : ${(memStartup.rss / 1024 / 1024).toFixed(2)} Mo`);
  console.log(`  - External       : ${(memStartup.external / 1024 / 1024).toFixed(2)} Mo`);

  // Initialize App & Session
  const serverStart = performance.now();
  const app = await createApp();
  const serverDuration = performance.now() - serverStart;
  console.log(`  - Temps initialisation createApp() : ${serverDuration.toFixed(2)} ms`);

  const request = supertest(app);

  // Create authenticated session
  const characterId = 99990001;
  const sessionToken = defaultSessionStore.createSession({
    characterId,
    characterName: 'Baseline Auditor',
    characterOwnerHash: 'hash-baseline-99990001',
    scopes: [
      'publicData',
      'esi-wallet.read_character_wallet.v1',
      'esi-markets.read_character_orders.v1',
      'esi-assets.read_assets.v1',
    ],
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    tokenExpiresAt: Date.now() + 3600000,
  });

  // 2. HTTP Endpoints Latency & Payload Benchmark (on default dataset)
  console.log('\n[2/5] Profiling de latence des endpoints HTTP (30 échantillons par route) :');
  console.log('-'.repeat(80));
  console.log(
    'Endpoint'.padEnd(42) +
    'p50 (ms)'.padStart(10) +
    'p95 (ms)'.padStart(10) +
    'p99 (ms)'.padStart(10) +
    'Moy (ms)'.padStart(10) +
    'Payload'.padStart(10)
  );
  console.log('-'.repeat(80));

  const endpointsToBench = [
    '/api/health',
    '/api/info',
    '/api/ledger/transactions?page=1&pageSize=50',
    '/api/ledger/summary',
    '/api/ledger/filter-options',
    '/api/ledger/sync-status',
    '/api/orders',
    '/api/orders/summary',
    '/api/orders/restock',
    '/api/hubs',
    '/api/hubs/mappings',
    '/api/roi/summary',
    '/api/roi/allocations',
    '/api/roi/unsold-inventory',
    '/api/assets',
    '/api/assets/summary',
    '/api/capital/summary',
    '/api/capital/breakdown',
    '/api/capital/dormant',
    '/api/analytics/product/34',
    '/api/analytics/timeseries?range=30d',
  ];

  const endpointResults: Record<string, LatencyStats> = {};

  for (const ep of endpointsToBench) {
    const stats = await runEndpointBenchmark(request, sessionToken, ep, 30);
    endpointResults[ep] = stats;
    const payloadStr = stats.payloadBytes > 1024
      ? `${(stats.payloadBytes / 1024).toFixed(1)} Ko`
      : `${stats.payloadBytes} B`;
    console.log(
      ep.padEnd(42) +
      stats.p50.toString().padStart(10) +
      stats.p95.toString().padStart(10) +
      stats.p99.toString().padStart(10) +
      stats.avg.toString().padStart(10) +
      payloadStr.padStart(10)
    );
  }

  // 3. I/O File Persist Blocking Time Benchmark
  console.log('\n[3/5] Mesure du coût I/O bloquant (DurableFileDatabaseAdapter.persist) :');
  console.log('-'.repeat(80));
  console.log(
    'Volumétrie (Transactions)'.padEnd(30) +
    'Taille JSON'.padStart(15) +
    'Durée Sync Write'.padStart(20)
  );
  console.log('-'.repeat(80));

  const ioResults: Record<number, { sizeKo: number; durationMs: number }> = {};
  const testTmpPath = path.resolve('.data/eve_trade_bench_io_tmp.json');

  const volumes = [100, 1000, 10000, 50000];

  for (const vol of volumes) {
    const adapter = new DurableFileDatabaseAdapter(testTmpPath);
    adapter.init();
    const txs = generateSyntheticData(characterId, vol);

    // Prepare state
    const state = {
      version: 2,
      appliedMigrations: [1, 2],
      data: {
        ledger: { transactions: txs, journalEntries: [] },
        orders: { snapshots: [], restockItems: [] },
        hubs: { definitions: [], mappings: [] },
        roi: { allocations: [], openingBalances: [] },
        assets: { assets: [] },
        sync: { states: [] },
      },
    };

    const startPersist = performance.now();
    const rawJson = JSON.stringify(state, null, 2);
    fs.writeFileSync(testTmpPath, rawJson, 'utf8');
    const duration = performance.now() - startPersist;
    const sizeKo = Buffer.byteLength(rawJson, 'utf8') / 1024;

    ioResults[vol] = { sizeKo, durationMs: Number(duration.toFixed(2)) };

    console.log(
      `${vol.toLocaleString()} txs`.padEnd(30) +
      `${sizeKo > 1024 ? (sizeKo / 1024).toFixed(2) + ' Mo' : sizeKo.toFixed(1) + ' Ko'}`.padStart(15) +
      `${duration.toFixed(2)} ms`.padStart(20)
    );

    if (fs.existsSync(testTmpPath)) {
      fs.unlinkSync(testTmpPath);
    }
  }

  // 4. Business Calculation Engine Timings Benchmark (FIFO, Product 360, Capital)
  console.log('\n[4/5] Mesure des moteurs de calculs métier (FIFO, Product 360, Capital) :');
  console.log('-'.repeat(80));
  console.log(
    'Volumétrie'.padEnd(15) +
    'Auto-FIFO (ms)'.padStart(18) +
    'Product 360 (ms)'.padStart(18) +
    'Capital Pos. (ms)'.padStart(18) +
    'Heap Post (Mo)'.padStart(15)
  );
  console.log('-'.repeat(80));

  const engineResults: Record<number, { fifoMs: number; p360Ms: number; capitalMs: number; heapMo: number }> = {};

  for (const vol of volumes) {
    const adapter = new DurableFileDatabaseAdapter(null);
    adapter.init();

    const benchLedgerRepo = new PersistentLedgerRepository(adapter);
    const benchOrdersRepo = new PersistentOrdersRepository(adapter);
    const benchHubsRepo = new HubsRepository(adapter);
    const benchRoiRepo = new RoiRepository(benchLedgerRepo, adapter);
    const benchAssetsRepo = new PersistentAssetsRepository(adapter);

    const txs = generateSyntheticData(characterId, vol);
    benchLedgerRepo.saveTransactions(txs);

    const hubsService = new HubsService(benchHubsRepo);
    const assetsService = new AssetsService(benchAssetsRepo);
    const roiService = new RoiService(benchRoiRepo, assetsService, benchLedgerRepo);
    const capitalService = new CapitalService(benchAssetsRepo, benchOrdersRepo, benchLedgerRepo, benchRoiRepo, hubsService, defaultUniverseService);
    const analyticsService = new AnalyticsService(benchLedgerRepo, benchOrdersRepo, benchRoiRepo, hubsService, defaultUniverseService, capitalService, defaultSyncRepository);

    // 1. Auto-FIFO Reconciliation timing
    const startFifo = performance.now();
    roiService.autoReconcileFifo({ characterId });
    const durationFifo = performance.now() - startFifo;

    // 2. Product 360 inspection timing (typeId 34)
    const startP360 = performance.now();
    await analyticsService.getProduct360(34, { characterId });
    const durationP360 = performance.now() - startP360;

    // 3. Capital summary calculation timing
    const startCapital = performance.now();
    capitalService.getCapitalSummary(characterId);
    const durationCapital = performance.now() - startCapital;

    const heapMo = process.memoryUsage().heapUsed / 1024 / 1024;

    engineResults[vol] = {
      fifoMs: Number(durationFifo.toFixed(2)),
      p360Ms: Number(durationP360.toFixed(2)),
      capitalMs: Number(durationCapital.toFixed(2)),
      heapMo: Number(heapMo.toFixed(2)),
    };

    console.log(
      `${vol.toLocaleString()} txs`.padEnd(15) +
      `${durationFifo.toFixed(2)} ms`.padStart(18) +
      `${durationP360.toFixed(2)} ms`.padStart(18) +
      `${durationCapital.toFixed(2)} ms`.padStart(18) +
      `${heapMo.toFixed(1)} Mo`.padStart(15)
    );
  }

  // 5. Frontend Cascades Mapping Summary
  console.log('\n[5/5] Cartographie des cascades de requêtes réseau UI (App.tsx) :');
  console.log('-'.repeat(80));
  const frontendCascades = [
    { action: 'Montage initial (DashboardOverview)', reqCount: 5, endpoints: 'ledger, orders, roi, capital, analytics' },
    { action: 'Onglet Grand Livre (fetchLedgerData)', reqCount: 5, endpoints: 'transactions, summary, sync-status, filter-options, journal' },
    { action: 'Changement de page / filtre Grand Livre', reqCount: 5, endpoints: 'transactions, summary, sync-status, filter-options, journal (re-fetch global)' },
    { action: 'Onglet Ordres (fetchOrdersData)', reqCount: 3, endpoints: 'orders, summary, restock' },
    { action: 'Onglet Hubs & ROI (fetchRoiAndHubsData)', reqCount: 5, endpoints: 'summary, allocations, unsold-inventory, hubs, mappings' },
    { action: 'Onglet Capital & Stocks (fetchCapitalData)', reqCount: 3, endpoints: 'summary, breakdown, dormant' },
    { action: 'Onglet Analytics (fetchAnalyticsData)', reqCount: 2, endpoints: 'timeseries, breakdown' },
    { action: 'Inspection Product 360 (fetchProduct360Data)', reqCount: 1, endpoints: 'product/:typeId' },
    { action: 'Bascule de personnage actif (handleSwitchCharacter)', reqCount: 14, endpoints: 'switch (1) + fetchLedgerData (5) + fetchOrdersData (3) + fetchRoiAndHubsData (5)' },
    { action: 'Synchronisation globale (handleSyncAll)', reqCount: 13, endpoints: 'fetchLedgerData (5) + fetchOrdersData (3) + fetchRoiAndHubsData (5) en parallèle' },
  ];

  for (const cascade of frontendCascades) {
    console.log(`  • ${cascade.action.padEnd(52)} : ${cascade.reqCount.toString().padStart(2)} requêtes HTTP (${cascade.endpoints})`);
  }

  console.log('='.repeat(80));
  console.log('  RÉSULTAT DU BENCHMARK BASELINE : SUCCÈS & CONSIGNATION TERMINÉE');
  console.log('='.repeat(80));

  return {
    memStartup,
    serverDuration,
    endpointResults,
    ioResults,
    engineResults,
    frontendCascades,
  };
}

// Run directly if executed as main script
const isMain = process.argv[1] && process.argv[1].endsWith('baseline-bench.ts');
if (isMain) {
  runFullBaseline()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
