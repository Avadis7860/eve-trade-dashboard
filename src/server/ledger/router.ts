import { Router, type Request, type Response } from 'express';
import { LedgerService, defaultLedgerService } from './service.ts';
import { SyncService, defaultSyncService } from '../sync/service.ts';
import { type ISyncRepository, defaultSyncRepository } from '../sync/repository.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import type { LedgerFilterType } from './types.ts';
import { roiService } from '../roi/service.ts';
import { hubsService } from '../hubs/service.ts';
import { ledgerRepository } from './repository.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createLedgerRouter(
  ledgerService: LedgerService = defaultLedgerService,
  syncService: SyncService = defaultSyncService,
  syncRepo: ISyncRepository = defaultSyncRepository,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

  /**
   * Middleware to enforce valid character session
   */
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
   * GET /api/ledger/transactions
   * Retrieves paginated, filtered transactions
   */
  router.get('/transactions', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;

    const {
      type,
      typeId,
      search,
      locationId,
      fromDate,
      toDate,
      sortBy,
      sortOrder,
      page,
      pageSize,
      character_id,
      character_ids,
    } = req.query;

    const requestedCharId = character_id ? Number(character_id) : undefined;
    const requestedCharIds = character_ids
      ? String(character_ids).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : (requestedCharId ? [requestedCharId] : undefined);

    if (requestedCharIds) {
      const access = validateCharacterSessionAccess(session, requestedCharIds);
      if (!access.allowed) {
        res.status(403).json({ error: 'Accès refusé pour ce personnage' });
        return;
      }
    }

    const targetCharId = requestedCharId || session.characterId;

    const result = ledgerService.getTransactions(targetCharId, {
      type: type as LedgerFilterType,
      typeId: typeId ? Number(typeId) : undefined,
      search: search ? String(search) : undefined,
      locationId: locationId ? Number(locationId) : undefined,
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      sortBy: sortBy as 'date' | 'totalValue' | 'unitPrice' | 'quantity' | 'typeName',
      sortOrder: sortOrder as 'asc' | 'desc',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });

    res.json(result);
  });

  /**
   * GET /api/ledger/transactions/:id
   * Retrieves single transaction detail with linked journal entries
   */
  router.get('/transactions/:id', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const txId = Number(req.params.id);

    if (isNaN(txId)) {
      res.status(400).json({ error: 'Invalid transaction ID' });
      return;
    }

    // Check all authorized characters in session
    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    let detail = null;
    for (const charId of authorizedCharIds) {
      const found = ledgerService.getTransactionDetail(charId, txId);
      if (found) {
        detail = found;
        break;
      }
    }

    if (!detail) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    res.json(detail);
  });

  /**
   * GET /api/ledger/journal
   * Retrieves paginated wallet journal entries
   */
  router.get('/journal', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : session.characterId;

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;

    const result = ledgerService.getJournalEntries(requestedCharId, page, pageSize);
    res.json(result);
  });

  /**
   * GET /api/ledger/summary
   * Returns aggregated statistics
   */
  router.get('/summary', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    let characterIds: number[] | undefined;
    if (typeof req.query.character_ids === 'string') {
      characterIds = req.query.character_ids.split(',').map(Number).filter((n) => !isNaN(n));
    } else if (session.characters && Object.keys(session.characters).length > 1 && !req.query.character_id) {
      characterIds = Object.keys(session.characters).map(Number);
    }
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : (characterIds ? undefined : session.characterId);

    const idsToValidate = characterIds || (requestedCharId ? [requestedCharId] : [session.characterId]);
    const access = validateCharacterSessionAccess(session, idsToValidate);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const summary = ledgerService.getSummary(requestedCharId, characterIds);
    res.json(summary);
  });

  /**
   * GET /api/ledger/filter-options
   * Returns distinct items and locations for filter selectors
   */
  router.get('/filter-options', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : session.characterId;

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const options = ledgerService.getFilterOptions(requestedCharId);
    res.json(options);
  });

  /**
   * GET /api/ledger/sync-status
   * Returns current sync states and freshness
   */
  router.get('/sync-status', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const requestedCharId = req.query.character_id ? Number(req.query.character_id) : session.characterId;

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const status = syncRepo.getFullStatus(requestedCharId);
    res.json(status);
  });

  /**
   * POST /api/ledger/sync
   * Triggers an on-demand sync of wallet transactions and journal for all linked characters
   */
  router.post('/sync', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;

    try {
      const allCharacters = session.characters ? Object.values(session.characters) : [];
      const charIdsToSync = allCharacters.length > 0
        ? allCharacters
        : [{ characterId: session.characterId, accessToken: session.accessToken }];

      let lastResult;
      for (const char of charIdsToSync) {
        lastResult = await syncService.syncAll(
          char.characterId,
          char.accessToken,
          async () => {
            const token = await authService.refreshCharacterTokens(session.sessionId, char.characterId);
            return token;
          }
        );
      }

      // Auto-discover hubs and locations from all observed transactions
      const allTx = ledgerRepository.getAllTransactions();
      hubsService.autoDiscoverHubsFromTransactions(allTx);

      // Automatically reconcile across all linked characters in the ecosystem
      const allCharIds = charIdsToSync.map((c) => c.characterId);
      roiService.autoReconcileFifo({ characterIds: allCharIds });

      res.json({
        success: lastResult ? lastResult.transactions.status !== 'ERROR' : true,
        results: lastResult,
        status: syncRepo.getFullStatus(session.characterId),
        syncedCharacterIds: allCharIds,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
