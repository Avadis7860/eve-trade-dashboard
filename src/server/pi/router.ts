/**
 * Phase P03 — Colonies Planétaires & Flux de Matières PI
 * Routeur Express pour les endpoints REST du module PI (/api/pi)
 */

import { Router, type Request, type Response } from 'express';
import { PiService, defaultPiService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { extractSessionId } from '../auth/router.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';

export function createPiRouter(
  piService: PiService = defaultPiService,
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
   * GET /api/pi/colonies
   * Liste des colonies planétaires de la flotte avec synthèse de stock et cadences
   */
  router.get('/colonies', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const colonies = await piService.getColonySummaries(
      targetCharIds.length === 1 ? targetCharIds[0] : undefined,
      targetCharIds
    );
    res.json({ colonies, total: colonies.length, asOf: Date.now() });
  });

  /**
   * GET /api/pi/colonies/:id
   * Détail complet d'une colonie planétaire : pins, liens, routes et prévisions d'épuisement
   */
  router.get('/colonies/:id', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const planetId = Number(req.params.id);
    if (Number.isNaN(planetId)) {
      res.status(400).json({ error: 'Valid planet id required' });
      return;
    }

    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;
    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    // Chercher la colonie parmi les personnages autorisés
    let colonyDetail = null;
    for (const charId of targetCharIds) {
      const detail = await piService.getColonyDetail(charId, planetId);
      if (detail) {
        colonyDetail = detail;
        break;
      }
    }

    if (!colonyDetail) {
      res.status(404).json({ error: 'Colony not found for authorized characters' });
      return;
    }

    res.json(colonyDetail);
  });

  /**
   * GET /api/pi/stocks
   * Stocks consolidés en silos et spatioports planétaires (PLANETARY_COLONY_STOCK)
   */
  router.get('/stocks', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const stocks = await piService.getAggregatedStocks(targetCharIds);
    res.json({ stocks, total: stocks.length, asOf: Date.now() });
  });

  /**
   * GET /api/pi/production-rates
   * Rapport global des flux horaires d'extraction et de production
   */
  router.get('/production-rates', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const report = await piService.getProductionRatesReport(targetCharIds);
    res.json(report);
  });

  /**
   * POST /api/pi/calculate-export-tax
   * Calcul estimé des frais douaniers POCO et taxes SCC pour un lot
   */
  router.post('/calculate-export-tax', requireSession, (req: Request, res: Response) => {
    const { typeId, quantity, pocoTaxRate, solarSystemId } = req.body;
    if (!typeId || typeof quantity !== 'number' || quantity <= 0) {
      res.status(400).json({ error: 'typeId and positive quantity are required' });
      return;
    }

    const result = piService.calculateExportTax({
      typeId: Number(typeId),
      quantity,
      pocoTaxRate: pocoTaxRate !== undefined ? Number(pocoTaxRate) : undefined,
      solarSystemId: solarSystemId !== undefined ? Number(solarSystemId) : undefined,
    });

    res.json(result);
  });

  /**
   * POST /api/pi/impute-export-taxes
   * Impute les taxes d'exportation réelles du portefeuille aux lots de matériaux exportés
   */
  router.post('/impute-export-taxes', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const { characterId, batches } = req.body;
    const targetCharId = characterId ? Number(characterId) : session.activeCharacterId;

    const access = validateCharacterSessionAccess(session, targetCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    if (!Array.isArray(batches) || batches.length === 0) {
      res.status(400).json({ error: 'batches array required' });
      return;
    }

    const results = piService.imputeExportTaxesToLandedLots(targetCharId, batches);
    res.json({ results, characterId: targetCharId });
  });

  return router;
}
