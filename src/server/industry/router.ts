/**
 * Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)
 * Routeur Express pour les endpoints REST du module Industrie (/api/industry)
 */

import { Router, type Request, type Response } from 'express';
import { IndustryService, defaultIndustryService, STANDARD_BLUEPRINTS } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { extractSessionId } from '../auth/router.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import { IndustryCollector, defaultIndustryCollector } from './collector.ts';

export function createIndustryRouter(
  industryService: IndustryService = defaultIndustryService,
  authService: AuthService = new AuthService(undefined, defaultSessionStore),
  collector: IndustryCollector = defaultIndustryCollector
): Router {
  const router = Router();

  /**
   * Middleware vérifiant l'existence d'une session valide
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
   * Résout les identifiants de personnages autorisés pour la requête
   */
  function resolveTargetCharacterIds(
    session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>>,
    requestedCharId?: number
  ): { targetCharIds: number[]; error?: string; status?: number } {
    if (requestedCharId !== undefined && !Number.isNaN(requestedCharId)) {
      const access = validateCharacterSessionAccess(session, requestedCharId);
      if (!access.allowed) {
        return { targetCharIds: [], error: 'Accès refusé pour ce personnage', status: 403 };
      }
      return { targetCharIds: [requestedCharId] };
    }

    const characterIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];
    return { targetCharIds: characterIds.length > 0 ? characterIds : [session.characterId] };
  }

  /**
   * GET /api/industry/jobs
   * Liste des jobs d'industrie filtrés par personnage, corporation, statut ou activité.
   */
  router.get('/jobs', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status: errStatus } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(errStatus || 403).json({ error });
      return;
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const activityFilter = req.query.activity_id ? Number(req.query.activity_id) : undefined;
    const corpFilter = req.query.corporation_id ? Number(req.query.corporation_id) : undefined;
    const installerFilter = req.query.installer_id ? Number(req.query.installer_id) : undefined;
    const productFilter = req.query.product_type_id ? Number(req.query.product_type_id) : undefined;
    const blueprintFilter = req.query.blueprint_type_id ? Number(req.query.blueprint_type_id) : undefined;

    const jobs = industryService.getJobs({
      characterIds: targetCharIds,
      status: statusFilter,
      activityId: activityFilter,
      corporationId: corpFilter,
      installerId: installerFilter,
      productTypeId: productFilter,
      blueprintTypeId: blueprintFilter,
    });

    res.json({
      jobs,
      total: jobs.length,
      asOf: Date.now(),
    });
  });

  /**
   * GET /api/industry/summary
   * Synthèse complète du grand livre industriel : répartition des jobs, encours WIP et réconciliation fiscale.
   */
  router.get('/summary', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status: errStatus } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(errStatus || 403).json({ error });
      return;
    }

    const summary = await industryService.getSummary(
      targetCharIds.length === 1 ? targetCharIds[0] : undefined,
      targetCharIds
    );

    res.json(summary);
  });

  /**
   * GET /api/industry/wip-capital
   * Détail du capital immobilisé en cours de fabrication (WIP_INVENTORY_CAPITAL).
   */
  router.get('/wip-capital', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status: errStatus } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(errStatus || 403).json({ error });
      return;
    }

    const wip = industryService.getWipCapital(
      targetCharIds.length === 1 ? targetCharIds[0] : undefined,
      targetCharIds
    );

    res.json(wip);
  });

  /**
   * GET /api/industry/bom/:blueprintTypeId
   * Nomenclature et arbre des composants d'un plan de construction (BOM).
   */
  router.get('/bom/:blueprintTypeId', requireSession, async (req: Request, res: Response) => {
    const blueprintTypeId = Number(req.params.blueprintTypeId);
    if (Number.isNaN(blueprintTypeId)) {
      res.status(400).json({ error: 'Valid blueprintTypeId required' });
      return;
    }

    const blueprintDef = STANDARD_BLUEPRINTS[blueprintTypeId];
    if (blueprintDef) {
      res.json({
        found: true,
        blueprint: blueprintDef,
        asOf: Date.now(),
      });
      return;
    }

    // Réponse de secours si le plan n'est pas dans le catalogue statique
    res.json({
      found: false,
      blueprintTypeId,
      message: `Blueprint #${blueprintTypeId} not present in standard catalog`,
      asOf: Date.now(),
    });
  });

  /**
   * POST /api/industry/sync
   * Déclenche la collecte et l'ingestion des jobs ESI pour les personnages de la session.
   */
  router.post('/sync', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.body?.character_id ?? req.body?.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status: errStatus } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(errStatus || 403).json({ error });
      return;
    }

    let totalFetched = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (const charId of targetCharIds) {
      const charRecord = session.characters?.[charId];
      if (!charRecord) continue;

      const accessToken = typeof authService?.getValidAccessTokenForCharacter === 'function'
        ? await authService.getValidAccessTokenForCharacter(session.sessionId, charId)
        : charRecord.accessToken;
      if (!accessToken) continue;

      const collResult = await collector.collectCharacterJobs(charId, accessToken);
      if (collResult.characterJobs && collResult.characterJobs.length > 0) {
        totalFetched += collResult.characterJobs.length;
        const ingestRes = await industryService.ingestRawJobs(charId, collResult.characterJobs, 'CHARACTER');
        totalInserted += ingestRes.inserted;
        totalUpdated += ingestRes.updated;
      }
    }

    res.json({
      success: true,
      charactersProcessed: targetCharIds.length,
      totalFetched,
      totalInserted,
      totalUpdated,
      asOf: Date.now(),
    });
  });

  return router;
}

export const defaultIndustryRouter = createIndustryRouter();
