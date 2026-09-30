import { Router, type Request, type Response } from 'express';
import { OrdersService, defaultOrdersService } from './service.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import type { OrderLifecycleState, CreateRestockItemDto, UpdateRestockItemDto } from './types.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createOrdersRouter(
  ordersService: OrdersService = defaultOrdersService,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

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

    const result = ordersService.getOrders(session.characterId, {
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
    const summary = ordersService.getSummary(session.characterId);
    res.json(summary);
  });

  /**
   * GET /api/orders/restock
   * Retrieves list of local restock items
   */
  router.get('/restock', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const items = ordersService.getRestockItems(session.characterId);
    res.json({ items });
  });

  /**
   * POST /api/orders/restock/generate
   * Generates restock suggestions from completed / low stock orders
   */
  router.post('/restock/generate', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const result = ordersService.generateRestockSuggestions(session.characterId);
    res.json(result);
  });

  /**
   * POST /api/orders/restock
   * Creates a manual local restock item
   */
  router.post('/restock', requireSession, (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;
    const dto: CreateRestockItemDto = req.body;

    if (!dto.typeId || !dto.targetBuyHubId || !dto.sellHubId || !dto.suggestedQuantity) {
      res.status(400).json({ error: 'Missing required restock fields (typeId, targetBuyHubId, sellHubId, suggestedQuantity)' });
      return;
    }

    const item = ordersService.createRestockItem(session.characterId, dto);
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

    const updated = ordersService.updateRestockItem(session.characterId, itemId, updates);
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

    const deleted = ordersService.deleteRestockItem(session.characterId, itemId);
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

    const detail = ordersService.getOrderDetail(session.characterId, orderId);
    if (!detail) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(detail);
  });

  return router;
}
