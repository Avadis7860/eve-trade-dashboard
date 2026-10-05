import { Router, type Request, type Response } from 'express';
import { OrdersService, defaultOrdersService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import type { OrderLifecycleState, CreateRestockItemDto, UpdateRestockItemDto } from './types.ts';
import { validateCharacterSessionAccess } from '../middleware/security.ts';
import { extractSessionId } from '../auth/router.ts';

export function createOrdersRouter(
  ordersService: OrdersService = defaultOrdersService,
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

  /**
   * GET /api/orders
   * Retrieves paginated, filtered order snapshots
   */
  router.get('/', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;

    const {
      state,
      isBuyOrder,
      locationId,
      typeId,
      search,
      sortBy,
      sortOrder,
      page,
      pageSize,
    } = req.query;

    const rawCharId = req.query.character_id ?? req.query.characterId;
    const targetCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);
    const access = validateCharacterSessionAccess(session, targetCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const result = ordersService.getOrders(targetCharId, {
      state: state as OrderLifecycleState | 'ALL' | 'ACTIVE_ALL',
      isBuyOrder: isBuyOrder !== undefined ? isBuyOrder === 'true' : undefined,
      locationId: locationId ? Number(locationId) : undefined,
      typeId: typeId ? Number(typeId) : undefined,
      search: search ? String(search) : undefined,
      sortBy: sortBy as 'issued' | 'lastObservedAt' | 'volumeFilled' | 'price' | 'typeName' | 'state',
      sortOrder: sortOrder as 'asc' | 'desc',
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });

    res.json(result);
  });

  /**
   * GET /api/orders/summary
   * Aggregated order metrics
   */
  router.get('/summary', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const summary = ordersService.getSummary(requestedCharId);
    res.json(summary);
  });

  /**
   * GET /api/orders/restock
   * Retrieves list of local restock items
   */
  router.get('/restock', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const items = ordersService.getRestockItems(requestedCharId);
    res.json({ items });
  });

  /**
   * POST /api/orders/restock/generate
   * Generates restock suggestions from completed / low stock orders
   */
  router.post('/restock/generate', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const rawCharId = req.body.character_id ?? req.body.characterId;
    const requestedCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, requestedCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const result = ordersService.generateRestockSuggestions(requestedCharId);
    res.json(result);
  });

  /**
   * POST /api/orders/restock
   * Creates a manual local restock item
   */
  router.post('/restock', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const dto: CreateRestockItemDto = req.body;

    const rawCharId = req.body.character_id ?? req.body.characterId;
    const targetCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);
    const access = validateCharacterSessionAccess(session, targetCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    if (!dto.typeId || !dto.targetBuyHubId || !dto.sellHubId || !dto.suggestedQuantity) {
      res.status(400).json({ error: 'Missing required restock fields (typeId, targetBuyHubId, sellHubId, suggestedQuantity)' });
      return;
    }

    const item = ordersService.createRestockItem(targetCharId, dto);
    res.status(201).json(item);
  });

  /**
   * PUT /api/orders/restock/:id
   * Updates an existing restock item (status, quantity, notes, hubs)
   */
  router.put('/restock/:id', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const itemId = req.params.id;
    const updates: UpdateRestockItemDto = req.body;

    const rawCharId = req.body.character_id ?? req.body.characterId;
    const targetCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);
    const access = validateCharacterSessionAccess(session, targetCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const updated = ordersService.updateRestockItem(targetCharId, itemId, updates);
    if (!updated) {
      res.status(404).json({ error: 'Restock item not found' });
      return;
    }

    res.json(updated);
  });

  /**
   * DELETE /api/orders/restock/:id
   * Removes a restock item from the local list
   */
  router.delete('/restock/:id', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const itemId = req.params.id;
    const rawCharId = req.query.character_id ?? req.query.characterId;
    const targetCharId = rawCharId !== undefined ? Number(rawCharId) : (session.activeCharacterId || session.characterId);

    const access = validateCharacterSessionAccess(session, targetCharId);
    if (!access.allowed) {
      res.status(403).json({ error: 'Accès refusé pour ce personnage' });
      return;
    }

    const deleted = ordersService.deleteRestockItem(targetCharId, itemId);
    if (!deleted) {
      res.status(404).json({ error: 'Restock item not found' });
      return;
    }

    res.json({ success: true });
  });

  /**
   * GET /api/orders/:id
   * Retrieves single order detail with transaction correlation
   */
  router.get('/:id', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const orderId = Number(req.params.id);

    if (isNaN(orderId)) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }

    // Check all authorized characters in session
    const authorizedCharIds = session.characters
      ? Object.keys(session.characters).map(Number)
      : [session.characterId];

    let detail = null;
    for (const charId of authorizedCharIds) {
      const found = ordersService.getOrderDetail(charId, orderId);
      if (found) {
        detail = found;
        break;
      }
    }

    if (!detail) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(detail);
  });

  return router;
}
