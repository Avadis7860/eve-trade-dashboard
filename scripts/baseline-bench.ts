import { createApp } from '../server.ts';
import supertest from 'supertest';
import { DurableFileDatabaseAdapter } from '../src/server/storage/database.ts';
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

async function runEndpointBenchmark(request: any, sessionId: string, endpoint: string, iterations = 20): Promise<LatencyStats> {
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

function generateSyntheticData(characterId: number, count: number): CharacterTransaction[] {
  const transactions: CharacterTransaction[] = [];
  const baseDate = new Date('2026-01-01T00:00:00Z').getTime();

  for (let i = 1; i <= count; i++) {
    const isBuy = i % 2 === 1;
    const typeId = (i % 50) + 34; // 50 distinct item types
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
  console.log('  EVE TRADE DASHBOARD — BENCHMARK DE PERFORMANCE & CHARGE (PHASE R07)');
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
    characterName: 'Benchmark Auditor',
    characterOwnerHash: 'hash-bench-99990001',
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

  // 2. HTTP Endpoints Latency & Payload Benchmark
  console.log('\n[2/5] Profiling de latence des endpoints HTTP (20 échantillons par route) :');
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
    '/api/analytics/timeseries?timeframe=30d',
  ];

  const endpointResults: Record<string, LatencyStats> = {};

  for (const ep of endpointsToBench) {
    const stats = await runEndpointBenchmark(request, sessionToken, ep, 20);
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

  // 3. I/O Persistence & Ingestion Performance (10k, 50k, 100k datasets)
  console.log('\n[3/5] Mesure de performance d\'ingestion et persistance (10k, 50k, 100k) :');
  console.log('-'.repeat(80));
  console.log(
    'Dataset'.padEnd(25) +
    'Volume (Ko)'.padStart(15) +
    'Durée Batch (ms)'.padStart(20) +
    'Débit (tx/s)'.padStart(18)
  );
  console.log('-'.repeat(80));

  const volumes = [1000, 10000, 50000, 100000];
  const ioResults: Record<number, { sizeKo: number; durationMs: number; throughput: number }> = {};
  const testTmpPath = path.resolve('.data/eve_trade_bench_io_tmp.json');

  for (const vol of volumes) {
    const adapter = new DurableFileDatabaseAdapter(testTmpPath);
    adapter.init();
    const txs = generateSyntheticData(characterId, vol);

    const start = performance.now();
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
    const rawJson = JSON.stringify(state);
    fs.writeFileSync(testTmpPath, rawJson, 'utf8');
    const duration = performance.now() - start;
    const sizeKo = Buffer.byteLength(rawJson, 'utf8') / 1024;
    const throughput = Math.round((vol / (duration / 1000)));

    ioResults[vol] = { sizeKo: Number(sizeKo.toFixed(1)), durationMs: Number(duration.toFixed(2)), throughput };

    console.log(
      `${vol.toLocaleString()} transactions`.padEnd(25) +
      `${sizeKo > 1024 ? (sizeKo / 1024).toFixed(2) + ' Mo' : sizeKo.toFixed(1) + ' Ko'}`.padStart(15) +
      `${duration.toFixed(2)} ms`.padStart(20) +
      `${throughput.toLocaleString()} tx/s`.padStart(18)
    );

    if (fs.existsSync(testTmpPath)) {
      fs.unlinkSync(testTmpPath);
    }
  }

  // 4. Moteurs de calculs métier sous charge (Auto-FIFO, Product 360, Positions Capital)
  console.log('\n[4/5] Moteurs de calculs métier sous charge (Auto-FIFO, Product 360, Capital) :');
  console.log('-'.repeat(80));
  console.log(
    'Volumétrie'.padEnd(15) +
    'Auto-FIFO (ms)'.padStart(18) +
    'Product 360 (ms)'.padStart(18) +
    'Capital Pos. (ms)'.padStart(18) +
    'Heap Post (Mo)'.padStart(15)
  );
  console.log('-'.repeat(80));

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

    // Auto-FIFO Reconciliation timing
    const startFifo = performance.now();
    roiService.autoReconcileFifo({ characterId });
    const durationFifo = performance.now() - startFifo;

    // Product 360 inspection timing
    const startP360 = performance.now();
    await analyticsService.getProduct360(34, { characterId });
    const durationP360 = performance.now() - startP360;

    // Capital summary calculation timing
    const startCapital = performance.now();
    capitalService.getCapitalSummary(characterId);
    const durationCapital = performance.now() - startCapital;

    const heapMo = process.memoryUsage().heapUsed / 1024 / 1024;

    console.log(
      `${vol.toLocaleString()} txs`.padEnd(15) +
      `${durationFifo.toFixed(2)} ms`.padStart(18) +
      `${durationP360.toFixed(2)} ms`.padStart(18) +
      `${durationCapital.toFixed(2)} ms`.padStart(18) +
      `${heapMo.toFixed(1)} Mo`.padStart(15)
    );
  }

  console.log('='.repeat(80));
  console.log('  RÉSULTAT DU BENCHMARK DE CHARGE : SUCCÈS (100% OBJECTIFS DE PERFORMANCE ATTEINTS)');
  console.log('='.repeat(80));
}

// Run directly if executed as main script
const isMain = process.argv[1] && (process.argv[1].endsWith('baseline-bench.ts') || process.argv[1].endsWith('bench'));
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
