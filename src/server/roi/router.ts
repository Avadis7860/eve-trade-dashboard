import { Router, type Request, type Response } from 'express';
import { roiService } from './service.ts';
import { defaultSessionStore, SessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createRoiRouter(
  sessionStore: SessionStore = defaultSessionStore
): Router {
  const router = Router();

  const requireSession = (req: Request, res: Response, next: () => void) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
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
  };

  router.use(requireSession);

  // POST /api/roi/reconcile - Trigger automatic chronological FIFO reconciliation (supports multi-character)
  router.post('/reconcile', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const { character_id, character_ids, type_id } = req.body;

      let targetCharIds: number[] | undefined;
      let targetCharId: number | undefined;

      if (Array.isArray(character_ids) && character_ids.length > 0) {
        targetCharIds = character_ids.map(Number);
      } else if (character_id) {
        targetCharId = Number(character_id);
      } else if (session.characters && Object.keys(session.characters).length > 1) {
        targetCharIds = Object.keys(session.characters).map(Number);
      } else {
        targetCharId = session.activeCharacterId || session.characterId;
      }

      const idsToValidate = targetCharIds || (targetCharId ? [targetCharId] : []);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const result = roiService.autoReconcileFifo({
        characterId: targetCharIds && targetCharIds.length > 0 ? undefined : targetCharId,
        characterIds: targetCharIds,
        typeId: type_id ? Number(type_id) : undefined,
      });

      return res.json({ result });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/roi/summary - Get aggregate financial summary & ROI TTC
  router.get('/summary', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;

      let characterIds: number[] | undefined;
      if (typeof req.query.character_ids === 'string') {
        characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      } else if (!requestedCharId && session.characters && Object.keys(session.characters).length > 1) {
        characterIds = Object.keys(session.characters).map(Number);
      }

      const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.activeCharacterId || session.characterId]);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const characterId = characterIds && characterIds.length > 0 ? undefined : (requestedCharId || session.activeCharacterId || session.characterId);

      const summary = roiService.getSummary({
        character_id: characterId,
        character_ids: characterIds,
        start_date: req.query.start_date as string,
        end_date: req.query.end_date as string,
        type_id: req.query.type_id ? Number(req.query.type_id) : undefined,
        buy_hub_id: req.query.buy_hub_id as string,
        sell_hub_id: req.query.sell_hub_id as string,
      });

      return res.json({ summary });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/roi/allocations - List explicit cost allocations
  router.get('/allocations', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;
      const sellTxId = req.query.sell_transaction_id ? Number(req.query.sell_transaction_id) : undefined;

      let characterIds: number[] | undefined;
      if (typeof req.query.character_ids === 'string') {
        characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      } else if (!requestedCharId && session.characters && Object.keys(session.characters).length > 1) {
        characterIds = Object.keys(session.characters).map(Number);
      }

      const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.activeCharacterId || session.characterId]);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const characterId = characterIds && characterIds.length > 0 ? undefined : (requestedCharId || session.activeCharacterId || session.characterId);

      const allocations = roiService.listAllocations(characterId, sellTxId, characterIds);
      return res.json({ allocations });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/roi/allocations - Create explicit/manual cost allocation
  router.post('/allocations', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const {
        character_id,
        buy_character_id,
        sell_transaction_id,
        buy_transaction_id,
        opening_balance_id,
        quantity_to_allocate,
        custom_buy_fees,
        custom_sell_fees,
        notes,
      } = req.body;

      const targetCharId = character_id ? Number(character_id) : (session.activeCharacterId || session.characterId);
      const access = validateCharacterSessionAccess(session, targetCharId);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      if (!sell_transaction_id || (!buy_transaction_id && !opening_balance_id) || !quantity_to_allocate) {
        return res.status(400).json({
          error: 'sell_transaction_id, (buy_transaction_id ou opening_balance_id) et quantity_to_allocate requis',
        });
      }

      const result = roiService.createExplicitAllocation({
        character_id: targetCharId,
        buy_character_id: buy_character_id ? Number(buy_character_id) : undefined,
        sell_transaction_id: Number(sell_transaction_id),
        buy_transaction_id: buy_transaction_id ? Number(buy_transaction_id) : undefined,
        opening_balance_id: opening_balance_id ? String(opening_balance_id) : undefined,
        quantity_to_allocate: Number(quantity_to_allocate),
        custom_buy_fees: custom_buy_fees !== undefined ? Number(custom_buy_fees) : undefined,
        custom_sell_fees: custom_sell_fees !== undefined ? Number(custom_sell_fees) : undefined,
        notes,
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      return res.status(201).json({ allocation: result.allocation });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // DELETE /api/roi/allocations/:id - Delete an explicit cost allocation
  router.delete('/allocations/:id', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const { id } = req.params;
      const deleted = roiService.deleteAllocation(id, session.activeCharacterId || session.characterId);
      if (!deleted) {
        return res.status(404).json({ error: 'Allocation introuvable ou non autorisée' });
      }
      return res.json({ success: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/roi/opening-balances - List opening balance lots
  router.get('/opening-balances', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;

      let characterIds: number[] | undefined;
      if (typeof req.query.character_ids === 'string') {
        characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      } else if (!requestedCharId && session.characters && Object.keys(session.characters).length > 1) {
        characterIds = Object.keys(session.characters).map(Number);
      }

      const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.activeCharacterId || session.characterId]);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const characterId = characterIds && characterIds.length > 0 ? undefined : (requestedCharId || session.activeCharacterId || session.characterId);
      const openingBalances = roiService.listOpeningBalances(characterId, characterIds);
      return res.json({ openingBalances });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/roi/opening-balances - Declare a new opening inventory balance lot
  router.post('/opening-balances', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const {
        character_id,
        type_id,
        type_name,
        quantity,
        unit_cost_isk,
        location_id,
        location_name,
        acquisition_date,
        justification,
      } = req.body;

      const targetCharId = character_id ? Number(character_id) : (session.activeCharacterId || session.characterId);
      const access = validateCharacterSessionAccess(session, targetCharId);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const result = roiService.createOpeningBalance({
        character_id: targetCharId,
        type_id: Number(type_id),
        type_name,
        quantity: Number(quantity),
        unit_cost_isk: Number(unit_cost_isk),
        location_id: Number(location_id),
        location_name,
        acquisition_date,
        justification,
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      return res.status(201).json({ opening_balance: result.opening_balance });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // DELETE /api/roi/opening-balances/:id - Delete an opening balance lot
  router.delete('/opening-balances/:id', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const { id } = req.params;
      const result = roiService.deleteOpeningBalance(id, session.activeCharacterId || session.characterId);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ success: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/roi/sales-reconciliation - Line-by-line sales audit with arithmetic proofs
  router.get('/sales-reconciliation', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;

      let characterIds: number[] | undefined;
      if (typeof req.query.character_ids === 'string') {
        characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      } else if (!requestedCharId && session.characters && Object.keys(session.characters).length > 1) {
        characterIds = Object.keys(session.characters).map(Number);
      }

      const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.activeCharacterId || session.characterId]);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const characterId = characterIds && characterIds.length > 0 ? undefined : (requestedCharId || session.activeCharacterId || session.characterId);

      const salesDetails = roiService.getSalesReconciliationDetails({
        character_id: characterId,
        character_ids: characterIds,
        start_date: req.query.start_date as string,
        end_date: req.query.end_date as string,
        type_id: req.query.type_id ? Number(req.query.type_id) : undefined,
        sell_hub_id: req.query.sell_hub_id as string,
      });

      return res.json({ sales: salesDetails });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/roi/unsold-inventory - Get unallocated bought items / tied capital
  router.get('/unsold-inventory', (req: Request, res: Response) => {
    try {
      const session = (req as Request & { session: UserSession }).session;
      const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;

      let characterIds: number[] | undefined;
      if (typeof req.query.character_ids === 'string') {
        characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
      } else if (!requestedCharId && session.characters && Object.keys(session.characters).length > 1) {
        characterIds = Object.keys(session.characters).map(Number);
      }

      const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.activeCharacterId || session.characterId]);
      const access = validateCharacterSessionAccess(session, idsToValidate);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }

      const characterId = characterIds && characterIds.length > 0 ? undefined : (requestedCharId || session.activeCharacterId || session.characterId);

      const inventory = roiService.getUnsoldInventory(characterId, characterIds);
      return res.json({ inventory });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}

export const roiRouter = createRoiRouter();
