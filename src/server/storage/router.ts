import { Router, type Request, type Response } from 'express';
import { BackupRestoreService, defaultBackupService } from './backupService.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import type { AppBackupSnapshot } from './types.ts';

export function createBackupRouter(backupService: BackupRestoreService = defaultBackupService): Router {
  const router = Router();

  /**
   * Helper to validate session presence
   */
  const getSession = (req: Request) => {
    const sessionId = req.cookies?.eve_session_id;
    return sessionId ? defaultSessionStore.getSession(sessionId) : null;
  };

  /**
   * GET /api/backup/export
   * Exports full application snapshot with cryptographic checksum
   */
  router.get('/export', (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' });
    }

    const backup = backupService.exportBackup();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="eve-trade-dashboard-backup-${Date.now()}.json"`);
    return res.json(backup);
  });

  /**
   * POST /api/backup/restore
   * Validates and restores full application snapshot atomically
   */
  router.post('/restore', (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' });
    }

    const snapshot = req.body as AppBackupSnapshot;
    const result = backupService.restoreBackup(snapshot);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({
      success: true,
      message: 'Restauration effectuée avec succès',
      restoredCounts: result.restoredCounts,
    });
  });

  /**
   * GET /api/backup/audit
   * Audits data integrity across all repositories
   */
  router.get('/audit', (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' });
    }

    const report = backupService.auditDataIntegrity();
    return res.json(report);
  });

  return router;
}
