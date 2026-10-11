import { Router, type Request, type Response } from 'express';
import { SyncService, defaultSyncService } from './service.ts';
import { type ISyncRepository, defaultSyncRepository } from './repository.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { extractSessionId } from '../auth/router.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';

export function createSyncRouter(
  _syncService: SyncService = defaultSyncService,
  syncRepo: ISyncRepository = defaultSyncRepository,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

  /**
   * Middleware to enforce valid character session
   */
  const requireSession = async (req: Request, res: Response, next: () => void) => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const session = await authService.getValidSession(sessionId);
    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    (req as Request & { session: typeof session }).session = session;
    next();
  };

  /**
   * GET /api/sync/status
   * Returns current sync states, freshness, and domain coverage (including PI, Industry, Mining)
   */
  router.get('/status', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : session.characterId;

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const status = syncRepo.getFullStatus(requestedCharId);
    res.json(status);
  });

  return router;
}
