import { Router, type Request, type Response } from 'express';
import { CapitalService, capitalService as defaultCapitalService } from './service.ts';
import { SessionStore, defaultSessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import { extractSessionId } from '../auth/router.ts';
import type { PhysicalStockClassification, WalletSyncAndCapitalSettings, WalletSyncMode } from './types.ts';

function parseWalletSettings(query: Request['query']): WalletSyncAndCapitalSettings | undefined {
  const syncMode = query.wallet_sync_mode || query.walletSyncMode;
  const rawExcludedChars = query.excluded_character_wallet_ids || query.excludedCharacterWalletIds || query.excludedCharacterIds;
  const rawIncludedCorp = query.included_corporation_wallets || query.includedCorporationWallets;
  const rawExcludedCorp = query.excluded_corporation_wallets || query.excludedCorporationWallets;

  if (!syncMode && !rawExcludedChars && !rawIncludedCorp && !rawExcludedCorp) {
    return undefined;
  }

  const walletSyncMode: WalletSyncMode =
    syncMode === 'CHARACTERS_ONLY' || syncMode === 'CORPORATION_ONLY' || syncMode === 'BOTH'
      ? (syncMode as WalletSyncMode)
      : 'BOTH';

  const excludedCharacterWalletIds = rawExcludedChars
    ? String(rawExcludedChars).split(',').map((id) => Number(id.trim())).filter((n) => !isNaN(n))
    : [];

  const includedCorporationWallets = rawIncludedCorp
    ? String(rawIncludedCorp).split(',').map((k) => k.trim()).filter(Boolean)
    : undefined;

  const excludedCorporationWallets = rawExcludedCorp
    ? String(rawExcludedCorp).split(',').map((k) => k.trim()).filter(Boolean)
    : undefined;

  return {
    walletSyncMode,
    excludedCharacterWalletIds,
    includedCorporationWallets,
    excludedCorporationWallets,
  };
}

export function createCapitalRouter(
  service: CapitalService = defaultCapitalService,
  sessionStore: SessionStore = defaultSessionStore
): Router {
  const router = Router();

  // Enforce session authentication
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

  /**
   * GET /api/capital/summary
   * Returns aggregated monetary and physical capital summary
   */
  router.get('/summary', (req: Request, res: Response) => {
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
      return;
    }

    const effectiveCharId =
      characterIdsParam && characterIdsParam.length > 0
        ? undefined
        : (characterIdParam || session.activeCharacterId || session.characterId);

    const walletSettings = parseWalletSettings(req.query);
    const summary = service.getCapitalSummary(effectiveCharId, characterIdsParam, walletSettings);
    res.json(summary);
  });

  /**
   * GET /api/capital/wallets
   * Returns granular character and corporation wallet snapshots with current inclusion settings
   */
  router.get('/wallets', (req: Request, res: Response) => {
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
      return;
    }

    const effectiveCharId =
      characterIdsParam && characterIdsParam.length > 0
        ? undefined
        : (characterIdParam || session.activeCharacterId || session.characterId);

    const walletSettings = parseWalletSettings(req.query);
    const summary = service.getCapitalSummary(effectiveCharId, characterIdsParam, walletSettings);
    res.json({
      asOf: summary.asOf,
      settings: summary.walletSettings,
      wallets: summary.walletSnapshots || [],
      liquidWalletBalanceIsk: summary.monetary.liquidWalletBalanceIsk,
      netRealCapitalIsk: summary.monetary.netRealCapitalIsk,
    });
  });

  /**
   * GET /api/capital/breakdown
   * Returns paginated and filtered physical stock positions
   */
  router.get('/breakdown', (req: Request, res: Response) => {
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
      return;
    }

    const effectiveCharId =
      characterIdsParam && characterIdsParam.length > 0
        ? undefined
        : (characterIdParam || session.activeCharacterId || session.characterId);

    const walletSettings = parseWalletSettings(req.query);
    const hubId = req.query.hub_id ? String(req.query.hub_id) : undefined;
    const typeId = req.query.type_id ? Number(req.query.type_id) : undefined;
    const classification = req.query.classification
      ? (String(req.query.classification) as PhysicalStockClassification | 'ALL')
      : undefined;
    const isDormantOnly = req.query.dormant === 'true' || req.query.is_dormant_only === 'true';
    const search = req.query.search ? String(req.query.search) : undefined;
    const allowedSortBy = ['typeName', 'totalPhysicalQuantity', 'totalCostBasisIsk', 'committedSellOrderQuantity', 'daysInactive'] as const;
    type SortByField = (typeof allowedSortBy)[number];
    const sortBy = typeof req.query.sortBy === 'string' && allowedSortBy.includes(req.query.sortBy as SortByField)
      ? (req.query.sortBy as SortByField)
      : undefined;
    const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : req.query.sortOrder === 'asc' ? 'asc' : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;

    const breakdown = service.getCapitalBreakdown({
      characterId: effectiveCharId,
      characterIds: characterIdsParam,
      hubId,
      typeId,
      classification,
      isDormantOnly,
      search,
      sortBy,
      sortOrder,
      page,
      pageSize,
      walletSettings,
    });

    res.json(breakdown);
  });

  /**
   * GET /api/capital/dormant
   * Returns dormant stock positions (>30 days inactive or remote non-hub)
   */
  router.get('/dormant', (req: Request, res: Response) => {
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
      return;
    }

    const effectiveCharId =
      characterIdsParam && characterIdsParam.length > 0
        ? undefined
        : (characterIdParam || session.activeCharacterId || session.characterId);

    const positions = service.getPositions(effectiveCharId, characterIdsParam);
    const dormantPositions = positions.filter((p) => p.isDormant);

    res.json({
      asOf: Date.now(),
      totalDormantItems: dormantPositions.length,
      items: dormantPositions,
    });
  });

  return router;
}

export const capitalRouter = createCapitalRouter();
