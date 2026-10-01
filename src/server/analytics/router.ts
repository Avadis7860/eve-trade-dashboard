import { Router, type Request, type Response } from 'express';
import { AnalyticsService, analyticsService as defaultAnalyticsService } from './service.ts';
import { SessionStore, defaultSessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import type { TimeframeOption, GroupByOption } from './types.ts';

export function createAnalyticsRouter(
  service: AnalyticsService = defaultAnalyticsService,
  sessionStore: SessionStore = defaultSessionStore
): Router {
  const router = Router();

  // Enforce session authentication
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

  /**
   * Helper to extract & validate character access
   */
  const extractCharactersAndValidate = (req: Request, res: Response) => {
    const session = (req as Request & { session: UserSession }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;
    const characterIdParam = rawCharId !== undefined ? Number(rawCharId) : undefined;
    const characterIdsParam = rawCharIds !== undefined
      ? String(rawCharIds)
          .split(',')
          .map((id) => Number(id.trim()))
          .filter((n) => !isNaN(n))
      : undefined;

    const idsToValidate =
      characterIdsParam || (characterIdParam !== undefined ? [characterIdParam] : [session.activeCharacterId || session.characterId]);
    const access = validateCharacterSessionAccess(session, idsToValidate);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return null;
    }

    const effectiveCharId =
      characterIdsParam && characterIdsParam.length > 0
        ? undefined
        : (characterIdParam || session.activeCharacterId || session.characterId);

    return { effectiveCharId, characterIdsParam };
  };

  /**
   * GET /api/analytics/product/:typeId
   * Returns Product 360 multi-dimensional analytics for a specific item
   */
  router.get('/product/:typeId', async (req: Request, res: Response) => {
    try {
      const typeId = Number(req.params.typeId);
      if (isNaN(typeId) || typeId <= 0) {
        res.status(400).json({ error: 'Identifiant de type_id invalide' });
        return;
      }

      const charContext = extractCharactersAndValidate(req, res);
      if (!charContext) return;

      const timeframeParam = req.query.timeframe as TimeframeOption | undefined;
      const allowedTimeframes: TimeframeOption[] = ['7d', '14d', '30d', '90d', '180d', 'all'];
      const timeframe: TimeframeOption = timeframeParam && allowedTimeframes.includes(timeframeParam)
        ? timeframeParam
        : '90d';

      const hubId = req.query.hub_id ? String(req.query.hub_id) : undefined;

      const result = await service.getProduct360(typeId, {
        timeframe,
        characterId: charContext.effectiveCharId,
        characterIds: charContext.characterIdsParam,
        hubId,
      });

      res.json(result);
    } catch (error) {
      console.error('[AnalyticsRouter] Error generating Product 360:', error);
      res.status(500).json({ error: 'Erreur lors de la génération de la fiche Product 360' });
    }
  });

  /**
   * GET /api/analytics/timeseries
   * Returns time series data points, stock age distribution and hub flows
   */
  router.get('/timeseries', async (req: Request, res: Response) => {
    try {
      const charContext = extractCharactersAndValidate(req, res);
      if (!charContext) return;

      const typeIdParam = req.query.type_id ? Number(req.query.type_id) : undefined;
      const typeId = typeIdParam && !isNaN(typeIdParam) && typeIdParam > 0 ? typeIdParam : undefined;

      const timeframeParam = req.query.timeframe as TimeframeOption | undefined;
      const allowedTimeframes: TimeframeOption[] = ['7d', '14d', '30d', '90d', '180d', 'all'];
      const timeframe: TimeframeOption = timeframeParam && allowedTimeframes.includes(timeframeParam)
        ? timeframeParam
        : '90d';

      const groupByParam = req.query.groupBy as GroupByOption | undefined;
      const allowedGroupBy: GroupByOption[] = ['day', 'week', 'month'];
      const groupBy: GroupByOption = groupByParam && allowedGroupBy.includes(groupByParam)
        ? groupByParam
        : 'day';

      const hubId = req.query.hub_id ? String(req.query.hub_id) : undefined;

      const result = await service.getTimeSeries({
        typeId,
        timeframe,
        groupBy,
        characterId: charContext.effectiveCharId,
        characterIds: charContext.characterIdsParam,
        hubId,
      });

      res.json(result);
    } catch (error) {
      console.error('[AnalyticsRouter] Error generating time series:', error);
      res.status(500).json({ error: 'Erreur lors de la génération des séries temporelles' });
    }
  });

  return router;
}

export const analyticsRouter = createAnalyticsRouter();
