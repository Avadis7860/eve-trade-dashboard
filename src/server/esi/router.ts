import { Router, type Request, type Response } from 'express';
import { EsiClient, defaultEsiClient, EsiHttpError } from './client.ts';
import { EsiCache, defaultEsiCache } from './cache.ts';
import { EsiRateLimiter, defaultEsiRateLimiter } from './rateLimiter.ts';
import { AuthService } from '../auth/service.ts';
import { defaultSessionStore } from '../auth/sessionStore.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

export function createEsiRouter(
  esiClient: EsiClient = defaultEsiClient,
  cache: EsiCache = defaultEsiCache,
  rateLimiter: EsiRateLimiter = defaultEsiRateLimiter,
  authService: AuthService = new AuthService(undefined, defaultSessionStore)
): Router {
  const router = Router();

  /**
   * Status endpoint: reports rate limiter, error budget and cache statistics
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      rateLimit: rateLimiter.getStatus(),
      cacheSize: cache.size(),
    });
  });

  /**
   * Middleware to enforce authenticated session for private ESI proxy routes
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

    // Attach session to request for downstream handlers
    (req as Request & { session: typeof session }).session = session;
    next();
  };

  /**
   * Authenticated Character Orders endpoint
   */
  router.get('/character/orders', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;

    try {
      const response = await esiClient.get(`/characters/${session.characterId}/orders/`, {
        accessToken: session.accessToken,
        refreshTokenFn: async () => {
          const refreshed = await authService.refreshSessionTokens(session);
          return refreshed.accessToken;
        },
      });

      res.json(response);
    } catch (err: unknown) {
      if (err instanceof EsiHttpError) {
        res.status(err.statusCode).json({ error: err.message, meta: err.meta });
      } else {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  });

  /**
   * Authenticated Character Wallet Balance endpoint
   */
  router.get('/character/wallet/balance', requireSession, async (req: Request, res: Response) => {
    const session = (req as Request & { session: NonNullable<Awaited<ReturnType<typeof authService.getValidSession>>> }).session;

    try {
      const response = await esiClient.get<number>(`/characters/${session.characterId}/wallet/`, {
        accessToken: session.accessToken,
        refreshTokenFn: async () => {
          const refreshed = await authService.refreshSessionTokens(session);
          return refreshed.accessToken;
        },
      });

      res.json(response);
    } catch (err: unknown) {
      if (err instanceof EsiHttpError) {
        res.status(err.statusCode).json({ error: err.message, meta: err.meta });
      } else {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  });

  return router;
}
