import { Router, type Request, type Response } from 'express';
import { MetricsCollector, defaultMetricsCollector } from '../utils/metrics.ts';
import { IDatabaseAdapter } from '../storage/types.ts';
import { defaultDatabaseAdapter } from '../storage/database.ts';
import { SyncCoordinator, defaultSyncCoordinator } from '../sync/coordinator.ts';
import { EsiRateLimiter, defaultEsiRateLimiter } from '../esi/rateLimiter.ts';
import { BackupRestoreService, defaultBackupService } from '../storage/backupService.ts';

export interface DiagnosticsReport {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: {
      healthy: boolean;
      error?: string;
      appliedMigrationsCount: number;
    };
    syncCoordinator: {
      activeWorkers: number;
      queuedTasks: number;
      inFlightTasksCount: number;
      isBusy: boolean;
    };
    esiRateLimiter: {
      errorLimitRemain: number;
      errorLimitResetSeconds: number;
      isSuspended: boolean;
    };
    dataIntegrity: {
      status: 'HEALTHY' | 'WARNING' | 'CORRUPTED';
      issuesCount: number;
    };
  };
}

export function createSystemRouter(
  metricsCollector: MetricsCollector = defaultMetricsCollector,
  dbAdapter: IDatabaseAdapter = defaultDatabaseAdapter,
  syncCoordinator: SyncCoordinator = defaultSyncCoordinator,
  rateLimiter: EsiRateLimiter = defaultEsiRateLimiter,
  backupService: BackupRestoreService = defaultBackupService
): Router {
  const router = Router();

  /**
   * GET /api/system/metrics
   * Exposes real-time in-memory metrics snapshot in JSON format (p50/p95/p99, ESI, SQL, Node.js)
   */
  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = await metricsCollector.getMetrics();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json(metrics);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to collect system metrics',
        details: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/system/diagnostics
   * Comprehensive operational self-diagnostics checking DB connectivity, sync lock, and ESI health
   */
  router.get('/diagnostics', async (_req: Request, res: Response) => {
    const startTime = Date.now();
    let dbHealthy = false;
    let dbError: string | undefined;
    let appliedMigrationsCount = 0;

    try {
      dbHealthy = await dbAdapter.isHealthy();
      if (dbHealthy) {
        const migrations = await dbAdapter.getAppliedMigrationVersions();
        appliedMigrationsCount = migrations.length;
      } else {
        dbError = 'Database health check query returned falsy';
      }
    } catch (err) {
      dbHealthy = false;
      dbError = (err as Error).message;
    }

    const syncStats = syncCoordinator.getStats();
    const rateLimitStatus = rateLimiter.getStatus();
    const integrityReport = backupService.auditDataIntegrity();

    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
    if (!dbHealthy) {
      overallStatus = 'UNHEALTHY';
    } else if (
      rateLimitStatus.isSuspended ||
      rateLimitStatus.errorLimitRemain <= 10 ||
      integrityReport.status === 'CORRUPTED'
    ) {
      overallStatus = 'DEGRADED';
    } else if (integrityReport.status === 'WARNING') {
      overallStatus = 'DEGRADED';
    }

    const report: DiagnosticsReport = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      checks: {
        database: {
          healthy: dbHealthy,
          ...(dbError ? { error: dbError } : {}),
          appliedMigrationsCount,
        },
        syncCoordinator: {
          activeWorkers: syncStats.activeWorkers,
          queuedTasks: syncStats.queuedTasks,
          inFlightTasksCount: syncStats.inFlightKeys.length,
          isBusy: syncCoordinator.isBusy(),
        },
        esiRateLimiter: {
          errorLimitRemain: rateLimitStatus.errorLimitRemain,
          errorLimitResetSeconds: rateLimitStatus.errorLimitResetSeconds,
          isSuspended: rateLimitStatus.isSuspended,
        },
        dataIntegrity: {
          status: integrityReport.status,
          issuesCount: integrityReport.issues.length,
        },
      },
    };

    const httpStatusCode = overallStatus === 'UNHEALTHY' ? 503 : 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(httpStatusCode).json(report);
  });

  return router;
}
