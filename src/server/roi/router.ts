import { Router, Request, Response } from 'express';
import { roiService } from './service';
import { defaultSessionStore } from '../auth/sessionStore';

export const roiRouter = Router();

// Middleware: extract character ID from session if logged in
function getSessionCharacterId(req: Request): number | undefined {
  const sessionId = req.cookies?.eve_session_id;
  if (!sessionId) return undefined;
  const session = defaultSessionStore.getSession(sessionId);
  return session ? session.characterId : undefined;
}

// POST /api/roi/reconcile - Trigger automatic chronological FIFO reconciliation (supports multi-character)
roiRouter.post('/reconcile', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const { character_id, character_ids, type_id } = req.body;

    const charId = character_id ? Number(character_id) : sessionCharId;
    const charIds = Array.isArray(character_ids) ? character_ids.map(Number) : undefined;

    const result = roiService.autoReconcileFifo({
      characterId: charId,
      characterIds: charIds,
      typeId: type_id ? Number(type_id) : undefined,
    });

    return res.json({ result });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: errorMsg });
  }
});

// GET /api/roi/summary - Get aggregate financial summary & ROI TTC
roiRouter.get('/summary', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;
    const characterId = requestedCharId || sessionCharId;

    let characterIds: number[] | undefined;
    if (typeof req.query.character_ids === 'string') {
      characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
    }

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
roiRouter.get('/allocations', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;
    const characterId = requestedCharId || sessionCharId;
    const sellTxId = req.query.sell_transaction_id ? Number(req.query.sell_transaction_id) : undefined;

    let characterIds: number[] | undefined;
    if (typeof req.query.character_ids === 'string') {
      characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
    }

    const allocations = roiService.listAllocations(characterId, sellTxId, characterIds);
    return res.json({ allocations });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: errorMsg });
  }
});

// POST /api/roi/allocations - Create explicit/manual cost allocation
roiRouter.post('/allocations', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const {
      character_id,
      buy_character_id,
      sell_transaction_id,
      buy_transaction_id,
      quantity_to_allocate,
      custom_buy_fees,
      custom_sell_fees,
      notes,
    } = req.body;

    const targetCharId = character_id ? Number(character_id) : sessionCharId;
    if (!targetCharId) {
      return res.status(400).json({ error: 'character_id requis' });
    }

    if (!sell_transaction_id || !buy_transaction_id || !quantity_to_allocate) {
      return res.status(400).json({
        error: 'sell_transaction_id, buy_transaction_id et quantity_to_allocate requis',
      });
    }

    const result = roiService.createExplicitAllocation({
      character_id: targetCharId,
      buy_character_id: buy_character_id ? Number(buy_character_id) : undefined,
      sell_transaction_id: Number(sell_transaction_id),
      buy_transaction_id: Number(buy_transaction_id),
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
roiRouter.delete('/allocations/:id', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const { id } = req.params;
    const deleted = roiService.deleteAllocation(id, sessionCharId);
    if (!deleted) {
      return res.status(404).json({ error: 'Allocation introuvable ou non autorisée' });
    }
    return res.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: errorMsg });
  }
});

// GET /api/roi/unsold-inventory - Get unallocated bought items / tied capital
roiRouter.get('/unsold-inventory', (req: Request, res: Response) => {
  try {
    const sessionCharId = getSessionCharacterId(req);
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : undefined;
    const characterId = requestedCharId || sessionCharId;

    let characterIds: number[] | undefined;
    if (typeof req.query.character_ids === 'string') {
      characterIds = req.query.character_ids.split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n));
    }

    const inventory = roiService.getUnsoldInventory(characterId, characterIds);
    return res.json({ inventory });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: errorMsg });
  }
});
