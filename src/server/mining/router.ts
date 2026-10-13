/**
 * Phase P02 — Registre Minier & Coûts d'Opportunité Farm / Mining
 * Routeur Express pour les endpoints REST du module de minage (/api/mining)
 */

import { Router, type Request, type Response } from 'express';
import { MiningService, defaultMiningService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { extractSessionId } from '../auth/router.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import type { MiningLedgerFilterOptions } from './types.ts';

export function createMiningRouter(
  miningService: MiningService = defaultMiningService,
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

    // Si aucun personnage spécifique demandé, inclure tous les personnages de la session
    const characterIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];
    return { targetCharIds: characterIds.length > 0 ? characterIds : [session.characterId] };
  }

  /**
   * GET /api/mining/ledger
   * Renvoie les écritures du journal de minage filtrées
   */
  router.get('/ledger', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const filters: MiningLedgerFilterOptions = {
      typeId: req.query.type_id !== undefined ? Number(req.query.type_id) : undefined,
      solarSystemId: req.query.solar_system_id !== undefined ? Number(req.query.solar_system_id) : undefined,
      startDate: req.query.start_date as string | undefined,
      endDate: req.query.end_date as string | undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
    };

    const ledger = await miningService.getLedger(targetCharIds, filters);
    res.json(ledger);
  });

  /**
   * GET /api/mining/summary
   * Synthèse globale des extractions avec décomposition par minerai, système et personnage
   */
  router.get('/summary', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, requestedCharId);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const filters: MiningLedgerFilterOptions = {
      typeId: req.query.type_id !== undefined ? Number(req.query.type_id) : undefined,
      solarSystemId: req.query.solar_system_id !== undefined ? Number(req.query.solar_system_id) : undefined,
      startDate: req.query.start_date as string | undefined,
      endDate: req.query.end_date as string | undefined,
    };

    const summary = await miningService.getSummary(targetCharIds, filters);
    res.json(summary);
  });

  /**
   * GET /api/mining/opportunity-costs
   * Référentiel des prix unitaires d'opportunité d'extraction
   */
  router.get('/opportunity-costs', requireSession, (_req: Request, res: Response) => {
    const oppCosts = miningService.getOpportunityCosts();
    res.json(oppCosts);
  });

  /**
   * POST /api/mining/opportunity-costs
   * Configuration d'un prix unitaire d'opportunité de référence
   */
  router.post('/opportunity-costs', requireSession, async (req: Request, res: Response) => {
    const { typeId, referencePrice, source } = req.body;
    if (!typeId || typeof referencePrice !== 'number' || referencePrice <= 0) {
      res.status(400).json({ error: 'typeId and positive referencePrice are required' });
      return;
    }

    miningService.setOpportunityPrice(Number(typeId), referencePrice, source || 'USER_OVERRIDE');
    res.json({ success: true, typeId, referencePrice });
  });

  /**
   * POST /api/mining/recalculate
   * Recalcule les valorisations d'opportunité des entrées existantes
   */
  router.post('/recalculate', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const { targetCharIds } = resolveTargetCharacterIds(session);
    const updatedCount = await miningService.recalculateValuations(targetCharIds);
    res.json({ success: true, updatedCount });
  });

  /**
   * GET /api/mining/dual-profitability
   * Calcule la double rentabilité (ROI Commercial d'arbitrage vs Marge de trésorerie brute de farm)
   */
  router.get('/dual-profitability', requireSession, (req: Request, res: Response) => {
    const typeId = Number(req.query.type_id ?? req.query.typeId);
    const quantity = Number(req.query.quantity);
    const salePriceIsk = Number(req.query.sale_price_isk ?? req.query.salePriceIsk);
    const taxesIsk = req.query.taxes_isk !== undefined ? Number(req.query.taxes_isk) : 0;
    const overridePrice = req.query.override_price !== undefined ? Number(req.query.override_price) : undefined;

    if (!typeId || !quantity || Number.isNaN(salePriceIsk)) {
      res.status(400).json({ error: 'type_id, quantity, and sale_price_isk are required' });
      return;
    }

    const dualProfitability = miningService.calculateDualProfitability({
      typeId,
      quantity,
      salePriceIsk,
      taxesIsk,
      opportunityUnitPriceOverride: overridePrice,
    });

    res.json(dualProfitability);
  });

  return router;
}
