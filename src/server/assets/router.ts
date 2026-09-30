import { Router, type Request, type Response } from 'express';
import { defaultAssetsService, AssetsService } from './service.ts';
import { defaultSessionStore, SessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';

export function createAssetsRouter(
  service: AssetsService = defaultAssetsService,
  sessionStore: SessionStore = defaultSessionStore
): Router {
  const router = Router();

  // Middleware to resolve active session
  router.use((req: Request, res: Response, next) => {
    const sessionId = req.cookies?.eve_session_id;
    if (!sessionId) {
      res.status(401).json({ error: 'Session non authentifiée' });
      return;
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      res.status(401).json({ error: 'Session invalide ou expirée' });
      return;
    }

    (req as Request & { session: UserSession }).session = session;
    next();
  });

  router.get('/', (req: Request, res: Response) => {
    const session = (req as Request & { session: UserSession }).session;
    const characterIdParam = req.query.character_id ? Number(req.query.character_id) : undefined;
    const characterIdsParam = req.query.character_ids
      ? String(req.query.character_ids).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : undefined;

    const effectiveCharId = characterIdsParam && characterIdsParam.length > 0 ? undefined : (characterIdParam || session.activeCharacterId);

    const typeId = req.query.type_id ? Number(req.query.type_id) : undefined;
    const locationId = req.query.location_id ? Number(req.query.location_id) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;

    const result = service.getAssets({
      characterId: effectiveCharId,
      characterIds: characterIdsParam,
      typeId,
      locationId,
      search,
      page,
      pageSize,
    });

    res.json(result);
  });

  router.get('/summary', (req: Request, res: Response) => {
    const session = (req as Request & { session: UserSession }).session;
    const characterIdParam = req.query.character_id ? Number(req.query.character_id) : undefined;
    const characterIdsParam = req.query.character_ids
      ? String(req.query.character_ids).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : undefined;

    const effectiveCharId = characterIdsParam && characterIdsParam.length > 0 ? undefined : (characterIdParam || session.activeCharacterId);
    const summary = service.getSummary(effectiveCharId, characterIdsParam);

    res.json(summary);
  });

  router.get('/stock/:typeId', (req: Request, res: Response) => {
    const typeId = Number(req.params.typeId);
    if (isNaN(typeId)) {
      res.status(400).json({ error: 'typeId invalide' });
      return;
    }

    const locationId = req.query.location_id ? Number(req.query.location_id) : undefined;
    const characterIdsParam = req.query.character_ids
      ? String(req.query.character_ids).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : undefined;

    const breakdown = service.getStockBreakdown(typeId, characterIdsParam);
    const specificLocationQty = locationId !== undefined
      ? service.getStockForType(typeId, locationId, characterIdsParam)
      : undefined;

    res.json({
      ...breakdown,
      specificLocationQty,
      locationId,
    });
  });

  return router;
}

export const assetsRouter = createAssetsRouter();
