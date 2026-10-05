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

import { extractSessionId } from '../auth/router.ts';

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
    } = req.query;

    const rawCharId = req.query.character_id ?? req.query.characterId;
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;

    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : undefined;
    const requestedCharIds = rawCharIds !== undefined
      ? String(rawCharIds).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
      : (requestedCharId !== undefined ? [requestedCharId] : undefined);

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
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : session.characterId;

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
    const rawCharIds = req.query.character_ids ?? req.query.characterIds;
    const rawCharId = req.query.character_id ?? req.query.characterId;

    let characterIds: number[] | undefined;
    if (typeof rawCharIds === 'string') {
      characterIds = rawCharIds.split(',').map(Number).filter((n) => !isNaN(n));
    } else if (session.characters && Object.keys(session.characters).length > 1 && rawCharId === undefined) {
      characterIds = Object.keys(session.characters).map(Number);
    }
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (characterIds ? undefined : session.characterId);

    const idsToValidate = characterIds || (requestedCharId !== undefined ? [requestedCharId] : [session.characterId]);
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
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : session.characterId;

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
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : session.characterId;

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

      const charactersPayload = charIdsToSync.map((char) => ({
        characterId: char.characterId,
        accessToken: char.accessToken,
        refreshTokenFn: async () => authService.refreshCharacterTokens(session.sessionId, char.characterId),
      }));

      // 1. Parallel multi-character synchronization through the bounded Task Coordinator
      const syncResults = await syncService.syncCharacters(charactersPayload);

      const syncErrors: string[] = [];
      let lastResult = null;
      for (const resItem of syncResults) {
        if (resItem.error) {
          syncErrors.push(resItem.error);
        }
        if (resItem.result) {
          lastResult = resItem.result;
        }
      }

      // 2. Ordered Post-Processing: auto-discover hubs and run FIFO reconciliation across only these characters
      const allCharIds = charIdsToSync.map((c) => c.characterId);
      const allTx = ledgerRepository.getAllTransactions(undefined, allCharIds);
      hubsService.autoDiscoverHubsFromTransactions(allTx);

      roiService.autoReconcileFifo({ characterIds: allCharIds });

      res.json({
        success: syncErrors.length === 0 && (lastResult ? lastResult.transactions.status !== 'ERROR' : true),
        errors: syncErrors.length > 0 ? syncErrors : undefined,
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
