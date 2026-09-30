import { Router, type Request, type Response } from 'express';
import { hubsService } from './service.ts';
import { ledgerRepository } from '../ledger/repository.ts';
import { defaultSessionStore, SessionStore } from '../auth/sessionStore.ts';
import type { UserSession } from '../auth/types.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createHubsRouter(
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

  // GET /api/hubs - List all configured hubs (auto-discovering from stored transactions)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const allTx = ledgerRepository.getAllTransactions();
      if (allTx.length > 0) {
        hubsService.autoDiscoverHubsFromTransactions(allTx);
      }
      const hubs = hubsService.listHubs();
      return res.json({ hubs });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/hubs/auto-discover - Automatically discover hubs and mappings from all observed transactions
  router.post('/auto-discover', requireSession, (_req: Request, res: Response) => {
    try {
      const allTx = ledgerRepository.getAllTransactions();
      const result = hubsService.autoDiscoverHubsFromTransactions(allTx);
      const hubs = hubsService.listHubs();
      const mappings = hubsService.listMappings();
      return res.json({ success: true, ...result, hubsCount: hubs.length, mappingsCount: mappings.length });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/hubs - Create or update a custom hub
  router.post('/', requireSession, (req: Request, res: Response) => {
    try {
      const { id, name, system_name, notes } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Le nom du hub est requis' });
      }
      const hub = hubsService.createOrUpdateHub({
        id,
        name,
        system_name,
        notes,
      });
      return res.status(201).json({ hub });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // DELETE /api/hubs/:id - Delete a custom hub
  router.delete('/:id', requireSession, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = hubsService.deleteHub(id);
      if (!result.success) {
        return res.status(400).json({ error: result.reason || 'Suppression impossible' });
      }
      return res.json({ success: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/hubs/mappings - List all location-to-hub mappings
  router.get('/mappings', (_req: Request, res: Response) => {
    try {
      const mappings = hubsService.listMappings();
      return res.json({ mappings });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // POST /api/hubs/mappings - Upsert a location-to-hub mapping
  router.post('/mappings', requireSession, (req: Request, res: Response) => {
    try {
      const { location_id, location_name, hub_id, notes } = req.body;
      if (!location_id || isNaN(Number(location_id))) {
        return res.status(400).json({ error: 'location_id numérique valide requis' });
      }
      if (!hub_id || typeof hub_id !== 'string') {
        return res.status(400).json({ error: 'hub_id requis' });
      }
      const mapping = hubsService.setMapping(Number(location_id), location_name || '', hub_id, notes);
      return res.json({ mapping });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // DELETE /api/hubs/mappings/:locationId - Delete a mapping
  router.delete('/mappings/:locationId', requireSession, (req: Request, res: Response) => {
    try {
      const locationId = Number(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'location_id invalide' });
      }
      const deleted = hubsService.removeMapping(locationId);
      return res.json({ success: deleted });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  // GET /api/hubs/resolve/:locationId - Resolve a location ID to its Hub
  router.get('/resolve/:locationId', (req: Request, res: Response) => {
    try {
      const locationId = Number(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ error: 'location_id invalide' });
      }
      const resolved = hubsService.resolveLocationToHub(locationId);
      return res.json({ resolved });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: errorMsg });
    }
  });

  return router;
}

export const hubsRouter = createHubsRouter();
