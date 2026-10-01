/**
 * Metrics and Observability Collector for EVE Trade Dashboard
 * High-performance, low-overhead in-memory metrics aggregation with bounded ring buffers
 */

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface ResourceMetric {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  status304: number;
  errors: number;
  latencies: PercentileStats;
}

export interface EsiMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  status304Saved: number;
  errorsCCP: {
    '420': number;
    '429': number;
    '500': number;
    '502': number;
    '503': number;
    '504': number;
    other: number;
  };
  errorLimitRemain: number;
  errorLimitResetSeconds: number;
  latencies: PercentileStats;
  byResource: Record<string, ResourceMetric>;
}

export interface SqlOperationMetric {
  totalQueries: number;
  successes: number;
  errors: number;
  latencies: PercentileStats;
}

export interface SqlStorageMetrics {
  queriesTotal: number;
  successes: number;
  errors: number;
  latencies: PercentileStats;
  byOperation: Record<string, SqlOperationMetric>;
  activeConnections: number;
  poolSize: number;
  transactionsCommitted: number;
  transactionsRolledBack: number;
}

export interface BusinessIntegrityMetrics {
  activeCharactersCount: number;
  totalTransactions: number;
  totalJournalEntries: number;
  totalOrders: number;
  totalAssets: number;
  totalHubs: number;
  totalMappings: number;
  classifiedCapitalPositions: number;
  autoFifoReconciledLots: number;
  manualReconciledLots: number;
  partialStatusCount: number;
  unknownStatusCount: number;
  knownStatusCount: number;
  dataQualityRatio: number;
  lastIntegrityStatus: 'HEALTHY' | 'WARNING' | 'CORRUPTED' | 'UNKNOWN';
}

export interface SystemHealthMetrics {
  uptimeSeconds: number;
  startTime: string;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
    externalMb: number;
  };
  eventLoopLagMs: number;
  nodeVersion: string;
  pid: number;
}

export interface SystemMetricsSnapshot {
  timestamp: string;
  system: SystemHealthMetrics;
  esi: EsiMetrics;
  sql: SqlStorageMetrics;
  business: BusinessIntegrityMetrics;
}

/**
 * Fixed-capacity circular ring buffer to store latency samples in O(1) time and bounded memory.
 */
export class RingBuffer {
  private buffer: number[];
  private capacity: number;
  private pointer = 0;
  private size = 0;

  constructor(capacity = 500) {
    this.capacity = Math.max(10, capacity);
    this.buffer = new Array(this.capacity);
  }

  public push(value: number): void {
    this.buffer[this.pointer] = value;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  public getSamples(): number[] {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    return [...this.buffer.slice(this.pointer), ...this.buffer.slice(0, this.pointer)];
  }

  public calculatePercentiles(): PercentileStats {
    if (this.size === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
    }

    const samples = this.getSamples().sort((a, b) => a - b);
    const count = samples.length;

    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += samples[i];
    }
    const avg = Number((sum / count).toFixed(2));
    const min = Number(samples[0].toFixed(2));
    const max = Number(samples[count - 1].toFixed(2));

    const getPercentile = (p: number): number => {
      const idx = Math.min(count - 1, Math.floor((p / 100) * count));
      return Number(samples[idx].toFixed(2));
    };

    return {
      p50: getPercentile(50),
      p95: getPercentile(95),
      p99: getPercentile(99),
      min,
      max,
      avg,
      count,
    };
  }

  public reset(): void {
    this.pointer = 0;
    this.size = 0;
    this.buffer = new Array(this.capacity);
  }
}

export class MetricsCollector {
  private startTime: number;
  private startTimeIso: string;

  // ESI metrics
  private totalEsiRequests = 0;
  private esiCacheHits = 0;
  private esiCacheMisses = 0;
  private esiStatus304Saved = 0;
  private esiErrorsCCP = {
    '420': 0,
    '429': 0,
    '500': 0,
    '502': 0,
    '503': 0,
    '504': 0,
    other: 0,
  };
  private esiErrorLimitRemain = 100;
  private esiErrorLimitResetSeconds = 0;
  private esiGlobalLatencies: RingBuffer;
  private esiResourceMetrics = new Map<
    string,
    {
      totalRequests: number;
      cacheHits: number;
      cacheMisses: number;
      status304: number;
      errors: number;
      latencies: RingBuffer;
    }
  >();

  // SQL / Storage metrics
  private sqlQueriesTotal = 0;
  private sqlSuccesses = 0;
  private sqlErrors = 0;
  private sqlGlobalLatencies: RingBuffer;
  private sqlOperationMetrics = new Map<
    string,
    {
      totalQueries: number;
      successes: number;
      errors: number;
      latencies: RingBuffer;
    }
  >();
  private activeSqlConnections = 0;
  private sqlPoolSize = 20;
  private sqlTransactionsCommitted = 0;
  private sqlTransactionsRolledBack = 0;

  // Business state & data integrity metrics
  private businessIntegrity: BusinessIntegrityMetrics = {
    activeCharactersCount: 0,
    totalTransactions: 0,
    totalJournalEntries: 0,
    totalOrders: 0,
    totalAssets: 0,
    totalHubs: 0,
    totalMappings: 0,
    classifiedCapitalPositions: 0,
    autoFifoReconciledLots: 0,
    manualReconciledLots: 0,
    partialStatusCount: 0,
    unknownStatusCount: 0,
    knownStatusCount: 0,
    dataQualityRatio: 1.0,
    lastIntegrityStatus: 'HEALTHY',
  };

  constructor() {
    this.startTime = Date.now();
    this.startTimeIso = new Date(this.startTime).toISOString();
    this.esiGlobalLatencies = new RingBuffer(500);
    this.sqlGlobalLatencies = new RingBuffer(500);
  }

  /**
   * Normalizes ESI path for resource aggregation (e.g. replaces dynamic IDs with placeholders)
   */
  public normalizeEsiResource(path: string): string {
    return path
      .replace(/\/characters\/\d+\//g, '/characters/{id}/')
      .replace(/\/corporations\/\d+\//g, '/corporations/{id}/')
      .replace(/\/markets\/structures\/\d+\//g, '/markets/structures/{id}/')
      .replace(/\/markets\/\d+\//g, '/markets/{id}/')
      .replace(/\/universe\/types\/\d+\//g, '/universe/types/{id}/')
      .replace(/\/universe\/stations\/\d+\//g, '/universe/stations/{id}/')
      .replace(/\/universe\/systems\/\d+\//g, '/universe/systems/{id}/')
      .replace(/\?.*$/, '');
  }

  /**
   * Records an ESI HTTP request execution
   */
  public recordEsiRequest(
    path: string,
    durationMs: number,
    statusCode: number,
    fromCache: boolean
  ): void {
    this.totalEsiRequests++;
    const resource = this.normalizeEsiResource(path);

    let resMetric = this.esiResourceMetrics.get(resource);
    if (!resMetric) {
      resMetric = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        status304: 0,
        errors: 0,
        latencies: new RingBuffer(200),
      };
      this.esiResourceMetrics.set(resource, resMetric);
    }

    resMetric.totalRequests++;
    this.esiGlobalLatencies.push(durationMs);
    resMetric.latencies.push(durationMs);

    if (fromCache || statusCode === 304) {
      this.esiCacheHits++;
      resMetric.cacheHits++;
      if (statusCode === 304) {
        this.esiStatus304Saved++;
        resMetric.status304++;
      }
    } else {
      this.esiCacheMisses++;
      resMetric.cacheMisses++;
    }

    if (statusCode >= 400) {
      resMetric.errors++;
      const codeStr = String(statusCode);
      if (codeStr in this.esiErrorsCCP) {
        this.esiErrorsCCP[codeStr as keyof typeof this.esiErrorsCCP]++;
      } else {
        this.esiErrorsCCP.other++;
      }
    }
  }

  /**
   * Updates current ESI rate limit budget values
   */
  public updateEsiRateLimit(remain: number, resetSeconds: number): void {
    this.esiErrorLimitRemain = remain;
    this.esiErrorLimitResetSeconds = resetSeconds;
  }

  /**
   * Records a SQL or storage query execution
   */
  public recordSqlQuery(operation: string, durationMs: number, success = true): void {
    this.sqlQueriesTotal++;
    this.sqlGlobalLatencies.push(durationMs);

    if (success) {
      this.sqlSuccesses++;
    } else {
      this.sqlErrors++;
    }

    const opKey = operation || 'generic_query';
    let opMetric = this.sqlOperationMetrics.get(opKey);
    if (!opMetric) {
      opMetric = {
        totalQueries: 0,
        successes: 0,
        errors: 0,
        latencies: new RingBuffer(200),
      };
      this.sqlOperationMetrics.set(opKey, opMetric);
    }

    opMetric.totalQueries++;
    opMetric.latencies.push(durationMs);
    if (success) {
      opMetric.successes++;
    } else {
      opMetric.errors++;
    }
  }

  /**
   * Records SQL transaction outcome (COMMIT vs ROLLBACK)
   */
  public recordSqlTransaction(committed: boolean): void {
    if (committed) {
      this.sqlTransactionsCommitted++;
    } else {
      this.sqlTransactionsRolledBack++;
    }
  }

  /**
   * Updates connection pool telemetry
   */
  public updatePoolStats(activeConnections: number, poolSize = 20): void {
    this.activeSqlConnections = Math.max(0, activeConnections);
    this.sqlPoolSize = poolSize;
  }

  /**
   * Updates business and data integrity state
   */
  public recordBusinessIntegrity(stats: Partial<BusinessIntegrityMetrics>): void {
    this.businessIntegrity = {
      ...this.businessIntegrity,
      ...stats,
    };

    const total =
      this.businessIntegrity.knownStatusCount +
      this.businessIntegrity.partialStatusCount +
      this.businessIntegrity.unknownStatusCount;

    if (total > 0) {
      this.businessIntegrity.dataQualityRatio = Number(
        (this.businessIntegrity.knownStatusCount / total).toFixed(4)
      );
    }
  }

  /**
   * Measures event loop lag in milliseconds using setImmediate
   */
  public async measureEventLoopLag(): Promise<number> {
    const start = performance.now();
    return new Promise<number>((resolve) => {
      setImmediate(() => {
        const lag = performance.now() - start;
        resolve(Number(lag.toFixed(2)));
      });
    });
  }

  /**
   * Generates a complete snapshot of all collected metrics
   */
  public async getMetrics(): Promise<SystemMetricsSnapshot> {
    const mem = process.memoryUsage();
    const eventLoopLag = await this.measureEventLoopLag();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const cacheHitRatio =
      this.totalEsiRequests > 0
        ? Number((this.esiCacheHits / this.totalEsiRequests).toFixed(4))
        : 1.0;

    const byResource: Record<string, ResourceMetric> = {};
    for (const [key, val] of this.esiResourceMetrics.entries()) {
      byResource[key] = {
        totalRequests: val.totalRequests,
        cacheHits: val.cacheHits,
        cacheMisses: val.cacheMisses,
        status304: val.status304,
        errors: val.errors,
        latencies: val.latencies.calculatePercentiles(),
      };
    }

    const byOperation: Record<string, SqlOperationMetric> = {};
    for (const [key, val] of this.sqlOperationMetrics.entries()) {
      byOperation[key] = {
        totalQueries: val.totalQueries,
        successes: val.successes,
        errors: val.errors,
        latencies: val.latencies.calculatePercentiles(),
      };
    }

    return {
      timestamp: new Date().toISOString(),
      system: {
        uptimeSeconds,
        startTime: this.startTimeIso,
        memory: {
          rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
          heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
          heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
          externalMb: Number((mem.external / 1024 / 1024).toFixed(2)),
        },
        eventLoopLagMs: eventLoopLag,
        nodeVersion: process.version,
        pid: process.pid,
      },
      esi: {
        totalRequests: this.totalEsiRequests,
        cacheHits: this.esiCacheHits,
        cacheMisses: this.esiCacheMisses,
        cacheHitRatio,
        status304Saved: this.esiStatus304Saved,
        errorsCCP: { ...this.esiErrorsCCP },
        errorLimitRemain: this.esiErrorLimitRemain,
        errorLimitResetSeconds: this.esiErrorLimitResetSeconds,
        latencies: this.esiGlobalLatencies.calculatePercentiles(),
        byResource,
      },
      sql: {
        queriesTotal: this.sqlQueriesTotal,
        successes: this.sqlSuccesses,
        errors: this.sqlErrors,
        latencies: this.sqlGlobalLatencies.calculatePercentiles(),
        byOperation,
        activeConnections: this.activeSqlConnections,
        poolSize: this.sqlPoolSize,
        transactionsCommitted: this.sqlTransactionsCommitted,
        transactionsRolledBack: this.sqlTransactionsRolledBack,
      },
      business: { ...this.businessIntegrity },
    };
  }

  /**
   * Synchronous metrics summary (for fast health checks without async event loop lag measurement)
   */
  public getMetricsSync(): SystemMetricsSnapshot {
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const cacheHitRatio =
      this.totalEsiRequests > 0
        ? Number((this.esiCacheHits / this.totalEsiRequests).toFixed(4))
        : 1.0;

    const byResource: Record<string, ResourceMetric> = {};
    for (const [key, val] of this.esiResourceMetrics.entries()) {
      byResource[key] = {
        totalRequests: val.totalRequests,
        cacheHits: val.cacheHits,
        cacheMisses: val.cacheMisses,
        status304: val.status304,
        errors: val.errors,
        latencies: val.latencies.calculatePercentiles(),
      };
    }

    const byOperation: Record<string, SqlOperationMetric> = {};
    for (const [key, val] of this.sqlOperationMetrics.entries()) {
      byOperation[key] = {
        totalQueries: val.totalQueries,
        successes: val.successes,
        errors: val.errors,
        latencies: val.latencies.calculatePercentiles(),
      };
    }

    return {
      timestamp: new Date().toISOString(),
      system: {
        uptimeSeconds,
        startTime: this.startTimeIso,
        memory: {
          rssMb: Number((mem.rss / 1024 / 1024).toFixed(2)),
          heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
          heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
          externalMb: Number((mem.external / 1024 / 1024).toFixed(2)),
        },
        eventLoopLagMs: 0,
        nodeVersion: process.version,
        pid: process.pid,
      },
      esi: {
        totalRequests: this.totalEsiRequests,
        cacheHits: this.esiCacheHits,
        cacheMisses: this.esiCacheMisses,
        cacheHitRatio,
        status304Saved: this.esiStatus304Saved,
        errorsCCP: { ...this.esiErrorsCCP },
        errorLimitRemain: this.esiErrorLimitRemain,
        errorLimitResetSeconds: this.esiErrorLimitResetSeconds,
        latencies: this.esiGlobalLatencies.calculatePercentiles(),
        byResource,
      },
      sql: {
        queriesTotal: this.sqlQueriesTotal,
        successes: this.sqlSuccesses,
        errors: this.sqlErrors,
        latencies: this.sqlGlobalLatencies.calculatePercentiles(),
        byOperation,
        activeConnections: this.activeSqlConnections,
        poolSize: this.sqlPoolSize,
        transactionsCommitted: this.sqlTransactionsCommitted,
        transactionsRolledBack: this.sqlTransactionsRolledBack,
      },
      business: { ...this.businessIntegrity },
    };
  }

  /**
   * Resets all metric counters (useful for unit tests)
   */
  public reset(): void {
    this.totalEsiRequests = 0;
    this.esiCacheHits = 0;
    this.esiCacheMisses = 0;
    this.esiStatus304Saved = 0;
    this.esiErrorsCCP = {
      '420': 0,
      '429': 0,
      '500': 0,
      '502': 0,
      '503': 0,
      '504': 0,
      other: 0,
    };
    this.esiErrorLimitRemain = 100;
    this.esiErrorLimitResetSeconds = 0;
    this.esiGlobalLatencies.reset();
    this.esiResourceMetrics.clear();

    this.sqlQueriesTotal = 0;
    this.sqlSuccesses = 0;
    this.sqlErrors = 0;
    this.sqlGlobalLatencies.reset();
    this.sqlOperationMetrics.clear();
    this.activeSqlConnections = 0;
    this.sqlTransactionsCommitted = 0;
    this.sqlTransactionsRolledBack = 0;

    this.businessIntegrity = {
      activeCharactersCount: 0,
      totalTransactions: 0,
      totalJournalEntries: 0,
      totalOrders: 0,
      totalAssets: 0,
      totalHubs: 0,
      totalMappings: 0,
      classifiedCapitalPositions: 0,
      autoFifoReconciledLots: 0,
      manualReconciledLots: 0,
      partialStatusCount: 0,
      unknownStatusCount: 0,
      knownStatusCount: 0,
      dataQualityRatio: 1.0,
      lastIntegrityStatus: 'HEALTHY',
    };
  }
}

export const defaultMetricsCollector = new MetricsCollector();
