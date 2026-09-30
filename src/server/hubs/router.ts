import { Router, Request, Response } from 'express';
import { hubsService } from './service';
import { ledgerRepository } from '../ledger/repository';

export const hubsRouter = Router();

// GET /api/hubs - List all configured hubs (auto-discovering from stored transactions)
hubsRouter.get('/', (_req: Request, res: Response) => {
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
hubsRouter.post('/auto-discover', (_req: Request, res: Response) => {
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
hubsRouter.post('/', (req: Request, res: Response) => {
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
hubsRouter.delete('/:id', (req: Request, res: Response) => {
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
hubsRouter.get('/mappings', (_req: Request, res: Response) => {
  try {
    const mappings = hubsService.listMappings();
    return res.json({ mappings });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: errorMsg });
  }
});

// POST /api/hubs/mappings - Upsert a location-to-hub mapping
hubsRouter.post('/mappings', (req: Request, res: Response) => {
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
hubsRouter.delete('/mappings/:locationId', (req: Request, res: Response) => {
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
hubsRouter.get('/resolve/:locationId', (req: Request, res: Response) => {
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
