import { Router, type Request, type Response } from 'express';
import { defaultAssetsService, AssetsService } from './service.ts';
import { defaultSessionStore, SessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import { extractSessionId } from '../auth/router.ts';

export function createAssetsRouter(
  service: AssetsService = defaultAssetsService,
  sessionStore: SessionStore = defaultSessionStore
): Router {
  const router = Router();

  // Middleware to resolve active session
  router.use((req: Request, res: Response, next) => {
    const sessionId = extractSessionId(req);
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
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;
    const characterIdParam = rawCharId !== undefined ? Number(rawCharId) : undefined;
    const characterIdsParam = rawCharIds !== undefined
      ? String(rawCharIds).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : undefined;

    const idsToValidate = characterIdsParam || (characterIdParam !== undefined ? [characterIdParam] : [session.activeCharacterId || session.characterId]);
    const access = validateCharacterSessionAccess(session, idsToValidate);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const effectiveCharId = characterIdsParam && characterIdsParam.length > 0 ? undefined : (characterIdParam || session.activeCharacterId || session.characterId);

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
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;
    const characterIdParam = rawCharId !== undefined ? Number(rawCharId) : undefined;
    const characterIdsParam = rawCharIds !== undefined
      ? String(rawCharIds).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : undefined;

    const idsToValidate = characterIdsParam || (characterIdParam !== undefined ? [characterIdParam] : [session.activeCharacterId || session.characterId]);
    const access = validateCharacterSessionAccess(session, idsToValidate);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const effectiveCharId = characterIdsParam && characterIdsParam.length > 0 ? undefined : (characterIdParam || session.activeCharacterId || session.characterId);
    const summary = service.getSummary(effectiveCharId, characterIdsParam);

    res.json(summary);
  });

  router.get('/stock/:typeId', (req: Request, res: Response) => {
    const session = (req as Request & { session: UserSession }).session;
    const typeId = Number(req.params.typeId);
    if (isNaN(typeId)) {
      res.status(400).json({ error: 'typeId invalide' });
      return;
    }

    const locationId = req.query.location_id ? Number(req.query.location_id) : undefined;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;
    const characterIdsParam = rawCharIds !== undefined
      ? String(rawCharIds).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : (rawCharId !== undefined ? [Number(rawCharId)] : undefined);

    const authorizedIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.activeCharacterId || session.characterId];

    const idsToValidate = characterIdsParam || authorizedIds;
    const access = validateCharacterSessionAccess(session, idsToValidate);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const effectiveCharIds = characterIdsParam || authorizedIds;
    const breakdown = service.getStockBreakdown(typeId, effectiveCharIds);
    const specificLocationQty = locationId !== undefined
      ? service.getStockForType(typeId, locationId, effectiveCharIds)
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
