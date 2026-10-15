/**
 * Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)
 * Routeur Express pour les endpoints REST du module de production (/api/production)
 */

import { Router, type Request, type Response } from 'express';
import { ProductionService, defaultProductionService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { extractSessionId } from '../auth/router.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';

export function createProductionRouter(
  productionService: ProductionService = defaultProductionService,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

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
   * GET /api/production/breakdown/:typeId
   * Retourne l'arbre de décomposition multi-niveaux d'un article avec preuve de calcul.
   */
  router.get('/breakdown/:typeId', (req: Request, res: Response) => {
    const typeId = parseInt(req.params.typeId, 10);
    if (Number.isNaN(typeId) || typeId <= 0) {
      res.status(400).json({ error: 'Invalid type_id' });
      return;
    }

    const qty = req.query.quantity ? parseInt(String(req.query.quantity), 10) : 1;
    const safeQty = !Number.isNaN(qty) && qty > 0 ? qty : 1;

    try {
      const breakdown = productionService.getBreakdown(typeId, safeQty);
      res.json(breakdown);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/production/lineage/:lotId
   * Récupère la généalogie complète d'un lot de fabrication.
   */
  router.get('/lineage/:lotId', requireSession, (req: Request, res: Response) => {
    const lotId = req.params.lotId;
    if (!lotId) {
      res.status(400).json({ error: 'Missing lotId' });
      return;
    }

    const lineage = productionService.getLineageForLot(lotId);
    if (!lineage) {
      res.status(404).json({ error: `Lignée introuvable pour le lot ${lotId}` });
      return;
    }

    res.json(lineage);
  });

  /**
   * GET /api/production/allocations
   * Liste les allocations de fabrication pour la session active.
   */
  router.get('/allocations', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const charIdParam = req.query.character_id ? parseInt(String(req.query.character_id), 10) : undefined;
    const typeIdParam = req.query.type_id ? parseInt(String(req.query.type_id), 10) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, charIdParam);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    const allocations = productionService.listAllocations(undefined, targetCharIds, typeIdParam);
    res.json({
      asOf: Date.now(),
      allocationsCount: allocations.length,
      allocations,
    });
  });

  /**
   * POST /api/production/propagate
   * Déclenche la propagation des coûts sur tous les jobs d'industrie terminés.
   */
  router.post('/propagate', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const charIdParam = req.body?.character_id ? parseInt(String(req.body.character_id), 10) : undefined;

    const { targetCharIds, error, status } = resolveTargetCharacterIds(session, charIdParam);
    if (error) {
      res.status(status || 403).json({ error });
      return;
    }

    try {
      const result = productionService.propagateDeliveredJobs({
        characterIds: targetCharIds,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/production/propagate/:jobId
   * Propage manuellement le coût d'un job spécifique.
   */
  router.post('/propagate/:jobId', requireSession, (req: Request, res: Response) => {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid jobId' });
      return;
    }

    const customsTax = req.body?.customs_tax_isk ? Number(req.body.customs_tax_isk) : 0;

    try {
      const alloc = productionService.propagateSingleJob(jobId, customsTax);
      res.json(alloc);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

export const defaultProductionRouter = createProductionRouter();
