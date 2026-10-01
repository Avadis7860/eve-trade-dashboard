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
   * Exports application snapshot strictly scoped to the active session's authorized characters
   */
  router.get('/export', (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' });
    }

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.activeCharacterId || session.characterId];

    const backup = backupService.exportBackup(authorizedCharIds);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="eve-trade-dashboard-backup-${Date.now()}.json"`);
    return res.json(backup);
  });

  /**
   * POST /api/backup/restore
   * Validates and restores application snapshot in scoped mode (only authorized characters without altering others)
   */
  router.post('/restore', (req: Request, res: Response) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Session non authentifiée' });
    }

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.activeCharacterId || session.characterId];

    const snapshot = req.body as AppBackupSnapshot;
    const result = backupService.restoreBackup(snapshot, { authorizedCharacterIds: authorizedCharIds });

    if (!result.success) {
      const statusCode = result.unauthorized ? 403 : 400;
      return res.status(statusCode).json({ error: result.error });
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
