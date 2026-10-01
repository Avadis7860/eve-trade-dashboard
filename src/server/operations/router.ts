import { Router, type Request, type Response } from 'express';
import { OperationsService, defaultOperationsService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import type { OperationalStatus } from './types.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createOperationsRouter(
  operationsService: OperationsService = defaultOperationsService,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

  const requireSession = async (req: Request, res: Response, next: () => void) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
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
   * GET /api/operations/plan
   * Comprehensive operations plan (Transfers + Restock Purchases)
   */
  router.get('/plan', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 14;
    const velocityWindowDays = req.query.velocityWindowDays ? Number(req.query.velocityWindowDays) : 90;
    const safetyStockDays = req.query.safetyStockDays ? Number(req.query.safetyStockDays) : 0;
    const targetBuyHubId = req.query.targetBuyHubId ? Number(req.query.targetBuyHubId) : undefined;

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    try {
      const plan = await operationsService.getOperationsPlan({
        characterId: requestedCharId,
        characterIds: authorizedCharIds,
        horizonDays,
        velocityWindowDays,
        safetyStockDays,
        targetBuyHubId,
      });

      res.json(plan);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Failed to compute operations plan' });
    }
  });

  /**
   * GET /api/operations/transfers
   * Only the prioritized logistics transfers
   */
  router.get('/transfers', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 14;
    const velocityWindowDays = req.query.velocityWindowDays ? Number(req.query.velocityWindowDays) : 90;

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    try {
      const plan = await operationsService.getOperationsPlan({
        characterId: requestedCharId,
        characterIds: authorizedCharIds,
        horizonDays,
        velocityWindowDays,
      });

      res.json({
        transfers: plan.transfers,
        summary: plan.summary,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Failed to fetch transfers' });
    }
  });

  /**
   * GET /api/operations/restock
   * Only the reasoned restock purchases
   */
  router.get('/restock', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 14;
    const velocityWindowDays = req.query.velocityWindowDays ? Number(req.query.velocityWindowDays) : 90;

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    try {
      const plan = await operationsService.getOperationsPlan({
        characterId: requestedCharId,
        characterIds: authorizedCharIds,
        horizonDays,
        velocityWindowDays,
      });

      res.json({
        purchases: plan.purchases,
        summary: plan.summary,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Failed to fetch restock purchases' });
    }
  });

  /**
   * POST /api/operations/transfers/:id/status
   * Updates status for a transfer item
   */
  router.post('/transfers/:id/status', requireSession, (req: Request, res: Response) => {
    const id = req.params.id;
    const { status, notes } = req.body as { status: OperationalStatus; notes?: string };

    if (!status) {
      res.status(400).json({ error: 'Status is required' });
      return;
    }

    operationsService.setItemStatus(id, status, notes);
    res.json({ success: true, id, status, notes });
  });

  /**
   * POST /api/operations/restock/:id/status
   * Updates status for a restock purchase item
   */
  router.post('/restock/:id/status', requireSession, (req: Request, res: Response) => {
    const id = req.params.id;
    const { status, notes } = req.body as { status: OperationalStatus; notes?: string };

    if (!status) {
      res.status(400).json({ error: 'Status is required' });
      return;
    }

    operationsService.setItemStatus(id, status, notes);
    res.json({ success: true, id, status, notes });
  });

  /**
   * POST /api/operations/generate
   * Triggers regeneration of operations plan
   */
  router.post('/generate', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.body.character_id ?? req.body.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    const plan = await operationsService.getOperationsPlan({
      characterId: requestedCharId,
      characterIds: authorizedCharIds,
    });

    res.json(plan);
  });

  return router;
}
